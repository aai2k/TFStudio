/**
 * Broadband Monitoring Wizard — 6-page modal wizard.
 *
 * Replaces the old docked BBMSimulator window. A "Broadband Monitoring
 * Simulation" 6-step dialog presented as a modal in the same visual style as
 * the Filter Design Wizard:
 *
 *   Page 1  Deposition Rates       — per-material mean / RMS / correlation time
 *                                     (OU process), live rate-vs-time preview
 *   Page 2  Parameters Deviation   — per-material Re(n) syst/random dev + syst
 *                                     inhomogeneity; exclude layers from
 *                                     monitoring (+ rel. thickness error);
 *                                     shutter delay mean + RMS
 *   Page 3  Monitoring System      — quantity (T/R) + pol, AOI, scan interval,
 *                                     band (λ min/max, points); ideal per-layer
 *                                     monitoring-signal preview (layer tabs)
 *   Page 4  Signal Errors          — random noise %, drift; noisy signal preview
 *   Page 5  Deposition Simulation  — ONE computational-manufacturing run, played
 *                                     back layer-by-layer with E/A/T bars and a
 *                                     live spectrum (theory + 80/90% + actual)
 *   Page 6  Resulting Performance  — manufactured vs theory spectrum + relative
 *                                     / absolute error bars + thickness & RI tables
 *
 * The single-run experiment, OU correlated rates, shutter delay, per-material
 * deviations and exclude-layers all live in utils/monitoringSim.js
 * (`simulateRun`, `sampleOURatePath`, `makeShiftedMaterial`). Spectra go through
 * utils/depositionSpectrum.js (`frontStackSpectrum`) → thinFilmMath
 * `evaluateSpectrumTotal`, the same validated path the Process Simulator uses.
 *
 * Reference: Tikhonravov & Trubetskov, Appl. Opt. 44, 6877 (2005);
 *            Macleod, Thin-Film Optical Filters, 5th ed., Ch. 12.
 */

import { useDesign }              from '../../state/DesignContext.js';
import { getMaterialById }        from '../../utils/materials/catalogManager.js';
import { getMaterial }            from '../../utils/materials/materialDatabase.js';
import { getCurrentLocale }       from '../../constants/locales.js';
import { resolveEvalMode }        from '../../utils/physics/optimizer.js';
import { EvalModeBadge }          from '../SurfaceModeBar.js';
import {
    simulateRun, sampleOURatePath, makeShiftedMaterial, mulberry32,
}                                 from '../../utils/monitoring/monitoringSim.js';
import { systemSpectrum, splitActiveStacks, partialThicknesses } from '../../utils/monitoring/depositionSpectrum.js';

const { createElement: h, useState, useEffect, useMemo, useRef, useCallback } = React;

// Single-run experiment worker (keeps the costly thickness fit off the UI thread).
import { BBM_WORKER_URL as RUN_WORKER_URL } from '../../workerUrls.js';

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Medium can be a bare id string or { material }.
function medId(m) { return typeof m === 'string' ? m : (m?.material ?? 'Air'); }

// Long material names blow up the narrow tables / dropdowns — cull to `max`
// chars with an ellipsis (full name stays available as a title tooltip).
function cullName(name, max = 22) {
    if (!name) return '';
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
}
function matName(id) { return resolveMat(id)?.name || id; }

// ── Shared style atoms (mirrors FilterDesignWizard / ProcessSimulator) ─────────
function inputStyle(c, w) {
    return { width: w, padding: '5px 7px', fontSize: 13, backgroundColor: c.bg, color: c.text,
             border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none', boxSizing: 'border-box' };
}
function NumField({ label, value, min, max, step, onChange, c, suffix, width = 110 }) {
    return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
        label && h('span', null, label),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('input', { type: 'number', value, min, max, step: step ?? 'any',
                onChange: (e) => { const v = parseFloat(e.target.value); onChange(Number.isNaN(v) ? 0 : v); },
                style: inputStyle(c, width) }),
            suffix && h('span', { style: { fontSize: 12, color: c.textDim } }, suffix)));
}
// compact numeric cell for tables
function cellNum({ value, min, max, step, onChange, c, width = 90 }) {
    return h('input', { type: 'number', value, min, max, step: step ?? 'any',
        onChange: (e) => { const v = parseFloat(e.target.value); onChange(Number.isNaN(v) ? 0 : v); },
        style: { ...inputStyle(c, width), padding: '3px 5px', fontSize: 12 } });
}
function Radio({ checked, onChange, label, c }) {
    return h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.text, cursor: 'pointer' } },
        h('input', { type: 'radio', checked, onChange, style: { accentColor: c.accent, cursor: 'pointer' } }), label);
}

// ── Layer tab strip ("Layer 1 2 … N" selector) ────────────────────────────────
function LayerTabs({ n, current, onSelect, c, label }) {
    if (!n) return null;
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
                               padding: '6px 4px 0', borderTop: `1px solid ${c.border}` } },
        Array.from({ length: n }, (_, i) => {
            const k = i + 1, active = k === current;
            return h('button', { key: k, onClick: () => onSelect(k),
                style: { padding: '3px 9px', fontSize: 11, cursor: 'pointer',
                         border: `1px solid ${active ? c.accent : c.border}`,
                         background: active ? c.accent + '33' : c.bg,
                         color: active ? c.accent : c.text, borderRadius: 3,
                         fontWeight: active ? 600 : 400, minWidth: 26 } },
                i === 0 && label ? `${label} ${k}` : String(k));
        }));
}

// Compact inline field (label left, input right) — keeps the wizard's left
// control panels short enough to fit without scrolling.
function RowField({ label, value, min, max, step, onChange, c, suffix, width = 70 }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 24 } },
        h('span', { style: { fontSize: 11.5, color: c.textDim, lineHeight: 1.1 } }, label),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 } },
            h('input', { type: 'number', value, min, max, step: step ?? 'any',
                onChange: (e) => { const v = parseFloat(e.target.value); onChange(Number.isNaN(v) ? 0 : v); },
                style: { ...inputStyle(c, width), padding: '3px 6px', fontSize: 12 } }),
            suffix && h('span', { style: { fontSize: 11, color: c.textDim, width: 14 } }, suffix)));
}

// Process-Simulator-style interactive timeline: play/pause, reset, speed,
// scrubbable slider with a tick at every layer boundary, and a step/time
// readout. `cumTimes` has length N+1 (cumTimes[0]=0). Pure-controlled.
function DepositionTimeline({ progress, totalTime, playing, onScrub, onPlayPause, onReset, speed, setSpeed, cumTimes, layerIdx, N, c, B }) {
    const has = totalTime > 0;
    const seg = (s, i, arr) => h('button', { key: s, onClick: () => setSpeed(s),
        style: { padding: '3px 9px', fontSize: 11, cursor: 'pointer',
                 border: `1px solid ${speed === s ? c.accent : c.border}`,
                 marginLeft: i === 0 ? 0 : -1,
                 borderRadius: i === 0 ? '4px 0 0 4px' : i === arr.length - 1 ? '0 4px 4px 0' : 0,
                 background: speed === s ? c.accent + '33' : 'transparent',
                 color: speed === s ? c.accent : c.text, fontWeight: speed === s ? 600 : 400 } }, `${s}×`);
    const btn = (onClick, txt, wide) => h('button', { onClick, disabled: !has,
        style: { padding: '4px 12px', fontSize: 12, borderRadius: 4, border: `1px solid ${c.border}`,
                 background: c.bg, color: c.text, cursor: has ? 'pointer' : 'not-allowed', opacity: has ? 1 : 0.5,
                 fontWeight: 600, minWidth: wide ? 84 : undefined } }, txt);
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 4px 0', flexShrink: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            btn(onPlayPause, playing ? B.pause : B.play, true),
            btn(onReset, B.reset),
            h('div', { style: { display: 'flex' } }, [1, 2, 5, 10, 50, 100].map(seg)),
            h('div', { style: { flex: 1 } }),
            h('div', { style: { fontSize: 11, color: c.text, fontVariantNumeric: 'tabular-nums' } }, B.layerOf(layerIdx || 0, N)),
            h('div', { style: { fontSize: 11, color: c.textDim, fontVariantNumeric: 'tabular-nums' } }, `${progress.toFixed(1)} / ${totalTime.toFixed(1)} s`)),
        h('div', { style: { position: 'relative' } },
            h('input', { type: 'range', min: 0, max: Math.max(totalTime, 0.001), step: Math.max(totalTime / 1000, 0.001),
                value: Math.min(progress, totalTime), disabled: !has,
                onChange: (e) => onScrub(parseFloat(e.target.value)),
                style: { width: '100%', accentColor: c.accent, opacity: has ? 1 : 0.4 } }),
            has && h('div', { style: { position: 'relative', height: 12, marginTop: -2, fontSize: 9, color: c.textDim, userSelect: 'none' } },
                cumTimes.map((tt, i) => {
                    const pct = totalTime > 0 ? (tt / totalTime) * 100 : 0;
                    return h('div', { key: i, style: { position: 'absolute', left: `${pct}%`, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 } },
                        h('div', { style: { width: 1, height: 4, background: c.border } }),
                        i > 0 && i % Math.ceil(N / 16 || 1) === 0 && h('span', null, i));
                }))));
}

// ── Generic Plotly line/bar chart ──────────────────────────────────────────────
function Chart({ traces, xTitle, yTitle, c, yRange = null, extra = {}, minHeight = 200 }) {
    const ref = useRef(null);
    const initRef = useRef(false);
    useEffect(() => {
        if (!ref.current || typeof Plotly === 'undefined') return;
        const layout = {
            paper_bgcolor: c.panel, plot_bgcolor: c.bg,
            font: { color: c.text, family: 'system-ui, -apple-system, sans-serif', size: 11 },
            margin: { l: 54, r: 14, t: 12, b: 42 },
            xaxis: { title: { text: xTitle, standoff: 6 }, gridcolor: c.border, color: c.text, tickfont: { size: 10 } },
            yaxis: { title: { text: yTitle, standoff: 6 }, gridcolor: c.border, color: c.text, tickfont: { size: 10 },
                     ...(yRange ? { range: yRange } : {}) },
            showlegend: false,
            hovermode: 'closest',
            ...extra,
        };
        const cfg = { responsive: true, displaylogo: false, displayModeBar: false };
        if (!initRef.current) { Plotly.newPlot(ref.current, traces, layout, cfg); initRef.current = true; }
        else { Plotly.react(ref.current, traces, layout, cfg); }
    }, [traces, xTitle, yTitle, c, yRange, extra]);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el && initRef.current) { try { Plotly.purge(el); } catch (_) {} initRef.current = false; } };
    }, []);
    return h('div', { ref, style: { width: '100%', height: '100%', minHeight } });
}

// ── Page header (title + subtitle) ─────────────────────────────────────────────
function PageHead({ title, subtitle, c }) {
    return h('div', { style: { padding: '2px 0 14px', borderBottom: `1px solid ${c.border}`, marginBottom: 14 } },
        h('div', { style: { fontSize: 18, fontWeight: 700, color: c.text } }, title),
        subtitle && h('div', { style: { fontSize: 12.5, color: c.textDim, marginTop: 3 } }, subtitle));
}

// Two-pane page layout: left controls (fixed width) + right chart (fills).
function SplitPage({ left, right, c, leftWidth = 210 }) {
    return h('div', { style: { display: 'flex', gap: 16, flex: 1, minHeight: 0 } },
        h('div', { style: { width: leftWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' } }, left),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } }, right));
}

// ══ Page 1 — Deposition Rates ═══════════════════════════════════════════════════
function PageRates({ p, set, materialIds, c, B }) {
    const sel = p.selMat && materialIds.includes(p.selMat) ? p.selMat : materialIds[0];
    useEffect(() => { if (sel && sel !== p.selMat) set('selMat', sel); }, [sel]); // eslint-disable-line
    const rate = p.rates[sel] || { meanA: 4, rmsA: 0.4, corr: 3 };
    const setRate = (key, v) => set('rates', { ...p.rates, [sel]: { ...rate, [key]: v } });

    // Live OU rate path preview (re-seeded by the "Randomize" nonce).
    const path = useMemo(() => {
        const rng = mulberry32((p.rateNonce | 0) + 1);
        return sampleOURatePath(rate.meanA, rate.rmsA, rate.corr, 1, 500, rng);
    }, [rate.meanA, rate.rmsA, rate.corr, p.rateNonce]);
    const traces = [{ x: path.t, y: path.r, type: 'scatter', mode: 'lines', line: { color: '#1f6feb', width: 1.3 } }];
    const yRange = p.rateYAt0 ? [0, Math.max(rate.meanA + 4 * Math.max(rate.rmsA, 0.1), rate.meanA * 1.4)] : null;

    return h(SplitPage, { c, leftWidth: 200,
        left: [
            h('label', { key: 'msl', style: { fontSize: 12, color: c.textDim, fontWeight: 600 } }, B.material),
            h('select', { key: 'ms', value: sel || '', onChange: (e) => set('selMat', e.target.value), style: inputStyle(c, '100%') },
                materialIds.map(id => h('option', { key: id, value: id, title: matName(id) }, cullName(matName(id), 26)))),
            h('div', { key: 'grp', style: { fontSize: 12, fontWeight: 600, color: c.text, marginTop: 4 } },
                cullName(matName(sel), 24)),
            h(NumField, { key: 'mean', label: B.meanRate, value: rate.meanA, min: 0.01, max: 200, step: 0.1, c, width: 110, onChange: (v) => setRate('meanA', v) }),
            h(NumField, { key: 'rms', label: B.rms, value: rate.rmsA, min: 0, max: 100, step: 0.05, c, width: 110, onChange: (v) => setRate('rmsA', v) }),
            h(NumField, { key: 'corr', label: B.corrTime, value: rate.corr, min: 0, max: 120, step: 0.5, c, width: 110, onChange: (v) => setRate('corr', v) }),
            h('label', { key: 'y0', style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.text, cursor: 'pointer', marginTop: 4 } },
                h('input', { type: 'checkbox', checked: p.rateYAt0, onChange: (e) => set('rateYAt0', e.target.checked), style: { accentColor: c.accent } }),
                B.yAxisAt0),
            h('button', { key: 'rnd', onClick: () => set('rateNonce', (p.rateNonce | 0) + 1),
                style: { marginTop: 6, padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 4,
                         border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, B.randomize),
        ],
        right: h('div', { style: { flex: 1, minHeight: 0 } },
            h(Chart, { traces, xTitle: B.timeAxis, yTitle: B.rateAxis, c, yRange })),
    });
}

// ══ Page 2 — Parameters Deviation ════════════════════════════════════════════════
function PageDeviations({ p, set, materialIds, layers, c, B }) {
    const th = { textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${c.border}`, fontWeight: 600, color: c.textDim, fontSize: 11.5, whiteSpace: 'nowrap' };
    const td = { padding: '3px 8px', borderBottom: `1px solid ${c.border}55`, fontSize: 12, color: c.text };

    const setDev = (id, key, v) => set('matDev', { ...p.matDev, [id]: { ...(p.matDev[id] || {}), [key]: v } });
    const setLayer = (i, key, v) => { const arr = p.layers.map(x => ({ ...x })); arr[i] = { ...arr[i], [key]: v }; set('layers', arr); };

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 } },
        // Table 1 — systematic & random deviations (per material)
        h('div', null,
            h('div', { style: { fontSize: 12.5, fontWeight: 600, color: c.text, marginBottom: 6 } }, B.systRandTitle),
            h('div', { style: { border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'auto', maxHeight: 150 } },
                h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                    h('thead', null, h('tr', { style: { background: c.panel } },
                        [B.colNum, B.colMaterial, B.colReNSyst, B.colReNRand, B.colSystInh].map((x, i) => h('th', { key: i, style: th }, x)))),
                    h('tbody', null, materialIds.map((id, i) => {
                        const dv = p.matDev[id] || {};
                        return h('tr', { key: id },
                            h('td', { style: td }, i + 1),
                            h('td', { style: { ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: matName(id) }, cullName(matName(id), 30)),
                            h('td', { style: td }, cellNum({ value: dv.reNSyst ?? 0, step: 0.001, min: -1, max: 1, c, width: 80, onChange: (v) => setDev(id, 'reNSyst', v) })),
                            h('td', { style: td }, cellNum({ value: dv.reNRand ?? 0, step: 0.001, min: 0, max: 1, c, width: 80, onChange: (v) => setDev(id, 'reNRand', v) })),
                            h('td', { style: td }, cellNum({ value: dv.systInh ?? 0, step: 0.01, min: -50, max: 50, c, width: 70, onChange: (v) => setDev(id, 'systInh', v) })));
                    })))),
        ),
        // Table 2 — exclude design layers from monitoring (per layer)
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { fontSize: 12.5, fontWeight: 600, color: c.text, marginBottom: 6 } }, B.excludeTitle),
            h('div', { style: { border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'auto', flex: 1 } },
                h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                    h('thead', null, h('tr', { style: { background: c.panel, position: 'sticky', top: 0 } },
                        [B.colNum, B.colMaterial, B.colPhysThk, B.colExclude, B.colRelThkErr].map((x, i) => h('th', { key: i, style: th }, x)))),
                    h('tbody', null, layers.map((l, i) => h('tr', { key: i },
                        h('td', { style: td }, i + 1),
                        h('td', { style: { ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: matName(l.material) }, cullName(matName(l.material), 22)),
                        h('td', { style: td }, (l.thickness || 0).toFixed(2)),
                        h('td', { style: { ...td, textAlign: 'center' } },
                            h('input', { type: 'checkbox', checked: !!p.layers[i]?.exclude,
                                onChange: (e) => setLayer(i, 'exclude', e.target.checked), style: { accentColor: c.accent, cursor: 'pointer' } })),
                        h('td', { style: td }, cellNum({ value: p.layers[i]?.relThkErr ?? 0, step: 0.01, min: 0, max: 100,
                            c, width: 80, onChange: (v) => setLayer(i, 'relThkErr', v) })))))))),
        // shutter delay row
        h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 18, flexShrink: 0 } },
            h(NumField, { label: B.shutterMean, value: p.shutterMean, min: 0, max: 30, step: 0.1, c, width: 90, suffix: 's', onChange: (v) => set('shutterMean', v) }),
            h(NumField, { label: B.shutterRms, value: p.shutterRms, min: 0, max: 30, step: 0.1, c, width: 90, suffix: 's', onChange: (v) => set('shutterRms', v) })),
    );
}

// ══ Page 3 — Monitoring System ═══════════════════════════════════════════════════
function PageMonSystem({ p, set, layers, c, B, ctx }) {
    const k = Math.min(Math.max(1, p.previewLayer || 1), layers.length);
    const nonce = p.monNonce | 0;
    const preview = useMemo(() => {
        if (!layers.length || !ctx) return null;
        const baseThicks = layers.map(l => l.thickness || 0);
        const thk = partialThicknesses(baseThicks, k, 1);
        // In-chamber monitor signal: the growing active coating on a SEMI-INFINITE
        // substrate (no back surface) — this is what the spectrophotometer sees,
        // independent of the front/back/total evaluation mode.
        return systemSpectrum({
            evalMode: 'front',
            frontStored: layers.map((l, i) => ({ material: resolveMat(l.material), thickness: thk[i] })),
            quantity: p.quantity, aoi: p.aoi, polarization: p.pol,
            lambdaStart: p.lamMin, lambdaEnd: p.lamMax, lambdaStep: Math.max(0.5, (p.lamMax - p.lamMin) / 200),
            incidentMat: ctx.incidentMatActive, substrateMat: ctx.subMat,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layers, k, p.quantity, p.aoi, p.pol, p.lamMin, p.lamMax, nonce, ctx]);
    const traces = preview ? [{ x: preview.lambda, y: preview.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: '#1f6feb', width: 1.6 } }] : [];

    return h(SplitPage, { c, leftWidth: 210,
        left: [
            h('select', { key: 'q', value: p.quantity + p.pol, onChange: (e) => { const v = e.target.value; set('quantity', v[0]); set('pol', v.slice(1)); }, style: { ...inputStyle(c, '100%'), padding: '4px 6px' } },
                [['Tavg', B.qTavg], ['Ts', B.qTs], ['Tp', B.qTp], ['Ravg', B.qRavg], ['Rs', B.qRs], ['Rp', B.qRp]].map(([v, l]) => h('option', { key: v, value: v }, l))),
            h(RowField, { key: 'aoi', label: B.incidence, value: p.aoi, min: 0, max: 89, step: 1, c, onChange: (v) => set('aoi', v) }),
            h(RowField, { key: 'si', label: B.scanInterval, value: p.scanInterval, min: 0.05, max: 60, step: 0.1, c, onChange: (v) => set('scanInterval', v) }),
            h('div', { key: 'bl', style: { fontSize: 12, fontWeight: 600, color: c.text, marginTop: 2 } }, B.band),
            h(RowField, { key: 'lo', label: B.lamMin, value: p.lamMin, min: 100, max: 20000, step: 10, c, onChange: (v) => set('lamMin', v) }),
            h(RowField, { key: 'hi', label: B.lamMax, value: p.lamMax, min: 100, max: 20000, step: 10, c, onChange: (v) => set('lamMax', v) }),
            h(RowField, { key: 'pts', label: B.points, value: p.points, min: 3, max: 4000, step: 1, c, onChange: (v) => set('points', Math.round(v)) }),
            h('button', { key: 'upd', onClick: () => set('monNonce', nonce + 1),
                style: { marginTop: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, B.update),
        ],
        right: h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { flex: 1, minHeight: 0 } },
                h(Chart, { traces, xTitle: B.wavelengthAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c })),
            h(LayerTabs, { n: layers.length, current: k, onSelect: (kk) => set('previewLayer', kk), c, label: B.layerWord })),
    });
}

// ══ Page 4 — Signal Errors ═══════════════════════════════════════════════════════
function PageSignalErrors({ p, set, layers, c, B, ctx }) {
    const k = Math.min(Math.max(1, p.previewLayer || 1), layers.length);
    const nonce = p.sigNonce | 0;
    const preview = useMemo(() => {
        if (!layers.length || !ctx) return null;
        const baseThicks = layers.map(l => l.thickness || 0);
        const thk = partialThicknesses(baseThicks, k, 1);
        // Semi-infinite active coating — the in-chamber monitor signal (see Page 3).
        const clean = systemSpectrum({
            evalMode: 'front',
            frontStored: layers.map((l, i) => ({ material: resolveMat(l.material), thickness: thk[i] })),
            quantity: p.quantity, aoi: p.aoi, polarization: p.pol,
            lambdaStart: p.lamMin, lambdaEnd: p.lamMax, lambdaStep: Math.max(0.5, (p.lamMax - p.lamMin) / 200),
            incidentMat: ctx.incidentMatActive, substrateMat: ctx.subMat,
        });
        // Apply random noise (% of signal) for the preview.
        const rng = mulberry32(nonce + 7);
        const std = p.randomPct / 100;
        const noisy = clean.values.map(v => {
            // Box–Muller
            let u1 = rng(); while (u1 <= 1e-12) u1 = rng();
            const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
            return v * (1 + (std > 0 ? g * std : 0));
        });
        return { lambda: clean.lambda, values: noisy };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layers, k, p.quantity, p.aoi, p.pol, p.lamMin, p.lamMax, p.randomPct, nonce, ctx]);
    const traces = preview ? [{ x: preview.lambda, y: preview.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: '#e5484d', width: 1.3 } }] : [];

    return h(SplitPage, { c, leftWidth: 210,
        left: [
            h(RowField, { key: 're', label: B.randomErrors, value: p.randomPct, min: 0, max: 20, step: 0.05, c, onChange: (v) => set('randomPct', v) }),
            h('div', { key: 'fl', style: { fontSize: 12, fontWeight: 600, color: c.text, marginTop: 2 } }, B.fluctuations),
            h(RowField, { key: 'dr', label: B.drift, value: p.drift, min: 0, max: 50, step: 0.05, c, onChange: (v) => set('drift', v) }),
            h(RowField, { key: 'mt', label: B.meanTime, value: p.driftMeanTime, min: 0, max: 1000, step: 0.5, c, onChange: (v) => set('driftMeanTime', v) }),
            h(RowField, { key: 'drms', label: B.rmsTime, value: p.driftRms, min: 0, max: 1000, step: 0.5, c, onChange: (v) => set('driftRms', v) }),
            h('div', { key: 'yl', style: { fontSize: 12, fontWeight: 600, color: c.text, marginTop: 4 } }, B.yAxisScale),
            h(Radio, { key: 'ya', checked: !p.yFixed, onChange: () => set('yFixed', false), label: B.auto, c }),
            h(Radio, { key: 'yf', checked: p.yFixed, onChange: () => set('yFixed', true), label: B.fixed, c }),
            h('button', { key: 'upd', onClick: () => set('sigNonce', nonce + 1),
                style: { marginTop: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, B.update),
        ],
        right: h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { flex: 1, minHeight: 0 } },
                h(Chart, { traces, xTitle: B.wavelengthAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, yRange: p.yFixed ? [0, 100] : null })),
            h(LayerTabs, { n: layers.length, current: k, onSelect: (kk) => set('previewLayer', kk), c, label: B.layerWord })),
    });
}

// ══ Page 5 — Deposition Simulation ═══════════════════════════════════════════════
// Reuses the Process-Simulator interaction model: run the experiment ONCE, then
// scrub/play the captured trajectory on an interactive timeline (slider + ticks
// + play/pause + speed). The chart shows the theoretical guide curves
// (end / 80 % / 90 %) and the actual as-built curve at the scrub position.
function PageSimulation({ p, set, layers, c, B, ctx, run, setRun, buildCfg, presampleMaterials }) {
    const N = layers.length;
    const [progress, setProgress] = useState(0);   // cumulative time (s)
    const [playing, setPlaying] = useState(false);
    const [busy, setBusy] = useState(false);
    const [compProg, setCompProg] = useState(0);   // compute progress 0..1 (Start)
    const rafRef = useRef(null);
    const workerRef = useRef(null);
    const seedRef = useRef(0);   // bumped each Start → a fresh realization per run

    // Tear down any in-flight run worker on unmount.
    useEffect(() => () => { if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; } }, []);

    // Per-layer cumulative cut times (built from a completed run).
    const cumTimes = useMemo(() => {
        if (!run) return [0];
        const out = [0];
        for (const ct of run.cutTimes) out.push(out[out.length - 1] + ct);
        return out;
    }, [run]);
    const totalTime = cumTimes[cumTimes.length - 1] || 0;

    const { layerIdx, frac } = useMemo(() => {
        if (!run || N === 0) return { layerIdx: 0, frac: 0 };
        for (let i = 0; i < N; i++) {
            if (progress < cumTimes[i + 1] - 1e-9) {
                const span = cumTimes[i + 1] - cumTimes[i];
                return { layerIdx: i + 1, frac: span > 0 ? (progress - cumTimes[i]) / span : 1 };
            }
        }
        return { layerIdx: N, frac: 1 };
    }, [progress, cumTimes, N, run]);

    // Playback loop — WALL-CLOCK-LOCKED. The deposition clock advances by the
    // real elapsed time × the speed multiplier, so `1×` is true real time
    // (1 simulated second per real second), `10×` is ten times real time, etc.
    // The previous code pegged a whole run to ~6 s regardless of the real
    // deposition time, which made the `×` labels meaningless (a 600 s run at
    // "1×" actually ran ~100× real time). `dt` is clamped so a tab-away / GC
    // pause can't make the clock leap forward.
    useEffect(() => {
        if (!playing || totalTime <= 0) return;
        let last = null;
        const tick = (now) => {
            if (last == null) last = now;
            const dt = Math.min((now - last) / 1000, 0.25); last = now;
            setProgress(pr => {
                const np = pr + dt * p.timeMult;   // sim-seconds = real-seconds × speed
                if (np >= totalTime) { setPlaying(false); return totalTime; }
                return np;
            });
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [playing, totalTime, p.timeMult]);
    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

    const start = useCallback(() => {
        if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
        setBusy(true); setPlaying(false); setCompProg(0);
        const cfg = buildCfg(true);
        const seed = (cfg._seed ^ Math.imul(++seedRef.current, 0x9E3779B1)) >>> 0;
        const finishRun = (res) => { setRun(res); setProgress(0); setBusy(false); setCompProg(1); setPlaying(true); };

        // Run the (costly) fit off the UI thread; the worker streams per-layer
        // progress and returns the trajectory. Fall back to a deferred
        // main-thread run if Workers are unavailable.
        let worker = null;
        try { worker = new Worker(RUN_WORKER_URL, { type: 'module' }); } catch (_) { worker = null; }
        if (worker) {
            workerRef.current = worker;
            // Serialisable cfg: drop the rng function + internal seed marker.
            const wcfg = { ...cfg }; delete wcfg.rng; delete wcfg._seed;
            const wdesign = {
                substrate: { material: ctx.design.substrate?.material ?? 'BK7', thickness: ctx.design.substrate?.thickness ?? 1 },
                incidentMedium: ctx.simDesign.incidentMedium, exitMedium: ctx.design.exitMedium,
                frontLayers: layers.map(l => ({ material: l.material, thickness: l.thickness })),
            };
            worker.onmessage = (ev) => {
                const m = ev.data;
                if (m.type === 'progress') { setCompProg(m.n ? m.i / m.n : 0); }
                else if (m.type === 'done') { worker.terminate(); if (workerRef.current === worker) workerRef.current = null; finishRun(m.run); }
                else if (m.type === 'error') { worker.terminate(); if (workerRef.current === worker) workerRef.current = null; setBusy(false); }
            };
            worker.onerror = () => { worker.terminate(); workerRef.current = null; setBusy(false); };
            worker.postMessage({ cmd: 'bbm-run', design: wdesign, cfg: wcfg, materials: presampleMaterials(), seed });
        } else {
            setTimeout(() => {
                const c2 = { ...cfg, rng: mulberry32(seed) };
                finishRun(simulateRun(ctx.simDesign, resolveMat, c2));
            }, 20);
        }
    }, [ctx, buildCfg, setRun, layers, presampleMaterials]);

    const playPause = useCallback(() => {
        if (totalTime <= 0) return;
        setProgress(pr => (pr >= totalTime - 1e-9 ? 0 : pr));
        setPlaying(pl => !pl);
    }, [totalTime]);
    const reset = useCallback(() => { setPlaying(false); setProgress(0); }, []);
    const scrub = useCallback((v) => { setPlaying(false); setProgress(v); }, []);
    const jumpLayer = useCallback((k) => { setPlaying(false); setProgress(Math.max(0, cumTimes[k] - (cumTimes[k] - cumTimes[k - 1]) * 0.02)); }, [cumTimes]);

    // Theory guide curves (per current layer) + actual as-built curve (per frac).
    // Resulting-performance spectra follow the OE evaluation mode (front semi-
    // infinite / total with the real back coating / back); in total mode the
    // opposite coating is present at nominal thickness.
    const lamStep = Math.max(0.8, (p.lamMax - p.lamMin) / 160);
    const baseThicks = layers.map(l => l.thickness || 0);
    const perfSpec = (activeStored) => {
        const { frontStored, backStored } = splitActiveStacks(ctx.activeSide, activeStored, ctx.otherStored);
        return systemSpectrum({
            evalMode: ctx.evalMode, frontStored, backStored,
            quantity: p.quantity, aoi: p.aoi, polarization: p.pol,
            lambdaStart: p.lamMin, lambdaEnd: p.lamMax, lambdaStep: lamStep,
            incidentMat: ctx.incMat, substrateMat: ctx.subMat, exitMat: ctx.exitMat, substrateThk: ctx.subThk,
        });
    };

    const theoryCurves = useMemo(() => {
        if (!run || layerIdx < 1) return null;
        const mk = (f) => {
            const thk = partialThicknesses(baseThicks, layerIdx, f);
            return perfSpec(layers.map((l, i) => ({ material: resolveMat(l.material), thickness: thk[i] })));
        };
        return { end: mk(1), f80: mk(0.8), f90: mk(0.9) };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run, layerIdx, p.quantity, p.aoi, p.pol, p.lamMin, p.lamMax]);

    const actualCurve = useMemo(() => {
        if (!run || layerIdx < 1) return null;
        const thk = run.asBuiltFront.map((d, i) => {
            const dep = i + 1;
            if (dep < layerIdx) return d;
            if (dep === layerIdx) return d * frac;
            return 0;
        });
        return perfSpec(layers.map((l, i) => ({
            material: makeShiftedMaterial(resolveMat(l.material), run.matDeltas[i]?.dn || 0, run.matDeltas[i]?.dk || 0),
            thickness: thk[i],
        })));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run, layerIdx, frac, p.quantity, p.aoi, p.pol, p.lamMin, p.lamMax]);

    const traces = [];
    if (theoryCurves) {
        traces.push({ x: theoryCurves.f80.lambda, y: theoryCurves.f80.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: '#d9a400', width: 1 } });
        traces.push({ x: theoryCurves.f90.lambda, y: theoryCurves.f90.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: '#1f6feb', width: 1 } });
        traces.push({ x: theoryCurves.end.lambda, y: theoryCurves.end.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: '#2da44e', width: 2 } });
    }
    if (actualCurve) traces.push({ x: actualCurve.lambda, y: actualCurve.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: '#e5484d', width: 2 } });

    // E/A/T bars for the current layer.
    const cur = layerIdx >= 1 ? layerIdx - 1 : 0;
    const tT = run ? (run.targetFront[cur] || 0) : 0;
    const tA = run ? (run.asBuiltFront[cur] || 0) * frac : 0;
    const tE = run ? (run.estimatedFront?.[cur] || 0) : 0;
    const barTraces = [{ type: 'bar', x: [B.barE, B.barA, B.barT], y: [tE, tA, tT], marker: { color: ['#e5484d', '#19b3c4', '#2da44e'] } }];

    return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        h(SplitPage, { c, leftWidth: 184,
            left: [
                busy
                    ? h('div', { key: 'busy', style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                        h('div', { style: { fontSize: 12, color: c.textDim } }, `${B.computing} ${Math.round(compProg * 100)}%`),
                        h('div', { style: { height: 7, background: c.border, borderRadius: 4, overflow: 'hidden' } },
                            h('div', { style: { height: '100%', width: `${Math.max(3, compProg * 100)}%`, background: c.accent, transition: 'width 80ms linear' } })))
                    : h('button', { key: 'start', onClick: start, style: { padding: '7px', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.accent}`, background: c.accent + '22', color: c.accent } }, run ? B.restart : B.start),
                h('div', { key: 'barlbl', style: { fontSize: 11, color: c.textDim, marginTop: 6 } }, B.eatLegend),
                h('div', { key: 'bars', style: { height: 150, flexShrink: 0 } },
                    h(Chart, { traces: barTraces, xTitle: '', yTitle: 'nm', c, minHeight: 0, extra: { margin: { l: 38, r: 8, t: 6, b: 24 } } })),
                h('div', { key: 'ysl', style: { fontSize: 12, fontWeight: 600, color: c.text, marginTop: 2 } }, B.yAxisScale),
                h(Radio, { key: 'ya', checked: !p.yFixed, onChange: () => set('yFixed', false), label: B.auto, c }),
                h(Radio, { key: 'yf', checked: p.yFixed, onChange: () => set('yFixed', true), label: B.fixed, c }),
            ],
            right: h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
                h('div', { style: { flex: 1, minHeight: 0 } },
                    run ? h(Chart, { traces, xTitle: B.wavelengthAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, yRange: p.yFixed ? [0, 100] : null })
                        : h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim, fontStyle: 'italic' } }, B.pressStart)),
                run && h(LayerTabs, { n: N, current: layerIdx || 1, onSelect: jumpLayer, c, label: B.layerWord }),
                run && h(DepositionTimeline, { progress, totalTime, playing, onScrub: scrub, onPlayPause: playPause, onReset: reset,
                    speed: p.timeMult, setSpeed: (s) => set('timeMult', s), cumTimes, layerIdx, N, c, B })),
        }),
    );
}

// ══ Page 6 — Resulting Performance ═══════════════════════════════════════════════
function PageResults({ p, set, layers, c, B, ctx, run }) {
    const tab = p.resultTab || 'spectral';
    const lamStep = Math.max(0.5, (p.lamMax - p.lamMin) / 300);

    const spectra = useMemo(() => {
        if (!run || !ctx) return null;
        const baseThicks = layers.map(l => l.thickness || 0);
        const perf = (activeStored) => {
            const { frontStored, backStored } = splitActiveStacks(ctx.activeSide, activeStored, ctx.otherStored);
            return systemSpectrum({
                evalMode: ctx.evalMode, frontStored, backStored,
                quantity: p.quantity, aoi: p.aoi, polarization: p.pol,
                lambdaStart: p.lamMin, lambdaEnd: p.lamMax, lambdaStep: lamStep,
                incidentMat: ctx.incMat, substrateMat: ctx.subMat, exitMat: ctx.exitMat, substrateThk: ctx.subThk,
            });
        };
        const theory = perf(layers.map((l, i) => ({ material: resolveMat(l.material), thickness: baseThicks[i] })));
        const manuf  = perf(layers.map((l, i) => ({
            material: makeShiftedMaterial(resolveMat(l.material), run.matDeltas[i]?.dn || 0, run.matDeltas[i]?.dk || 0),
            thickness: run.asBuiltFront[i],
        })));
        return { theory, manuf };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run, ctx, p.quantity, p.aoi, p.pol, p.lamMin, p.lamMax]);

    if (!run) return h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim, fontStyle: 'italic' } }, B.runFirst);

    const refLam = ctx.design.referenceWavelength || (p.lamMin + p.lamMax) / 2;
    const rows = layers.map((l, i) => {
        const theor = run.targetFront[i] || 0, dep = run.asBuiltFront[i] || 0;
        const abs = dep - theor, rel = theor > 0 ? abs / theor * 100 : 0;
        const n0 = resolveMat(l.material).getNK(refLam)[0];
        const dn = run.matDeltas[i]?.dn || 0, inh = run.matDeltas[i]?.inh || 0;
        return { i, name: matName(l.material), theor, dep, abs, rel, nTheor: n0, nDep: n0 + dn, dn, inh };
    });

    const th = { textAlign: 'left', padding: '5px 9px', borderBottom: `1px solid ${c.border}`, fontWeight: 600, color: c.textDim, fontSize: 11.5, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: c.panel };
    const td = { padding: '3px 9px', borderBottom: `1px solid ${c.border}55`, fontSize: 12, color: c.text, whiteSpace: 'nowrap' };
    const errColor = (v) => Math.abs(v) > 0.2 ? '#e5484d' : c.text;

    const tabBtn = (id, label) => h('button', { key: id, onClick: () => set('resultTab', id),
        style: { padding: '6px 14px', fontSize: 12, cursor: 'pointer', background: tab === id ? c.bg : 'transparent',
                 color: tab === id ? c.accent : c.text, fontWeight: tab === id ? 600 : 400,
                 border: 'none', borderBottom: `2px solid ${tab === id ? c.accent : 'transparent'}`, borderRadius: '3px 3px 0 0' } }, label);

    let body;
    if (tab === 'spectral') {
        const tr = spectra ? [
            { x: spectra.theory.lambda, y: spectra.theory.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: c.text === '#cccccc' ? '#dddddd' : '#222', width: 2 }, name: 'theory' },
            { x: spectra.manuf.lambda, y: spectra.manuf.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: '#e5484d', width: 1.6 }, name: 'manufactured' },
        ] : [];
        body = h(Chart, { traces: tr, xTitle: B.wavelengthAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, yRange: p.yFixed ? [0, 100] : null });
    } else if (tab === 'relerr' || tab === 'abserr') {
        const isRel = tab === 'relerr';
        const y = rows.map(r => isRel ? r.rel : r.abs);
        const tr = [{ type: 'bar', x: rows.map(r => r.i + 1), y, marker: { color: y.map(v => v >= 0 ? '#e5484d' : '#1f6feb') } }];
        body = h(Chart, { traces: tr, xTitle: B.layerWord, yTitle: isRel ? B.deltaPct : B.deltaNm, c });
    } else if (tab === 'thick') {
        body = h('div', { style: { overflow: 'auto', height: '100%', border: `1px solid ${c.border}`, borderRadius: 4 } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                h('thead', null, h('tr', null, [B.tblLayerNum, B.tblName, B.tblTheor, B.tblDep, B.tblRelErr, B.tblAbsErr].map((x, i) => h('th', { key: i, style: th }, x)))),
                h('tbody', null, rows.map(r => h('tr', { key: r.i },
                    h('td', { style: td }, r.i + 1),
                    h('td', { style: { ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }, title: r.name }, cullName(r.name, 22)),
                    h('td', { style: td }, r.theor.toFixed(4)),
                    h('td', { style: td }, r.dep.toFixed(4)),
                    h('td', { style: { ...td, color: errColor(r.rel) } }, r.rel.toFixed(4)),
                    h('td', { style: { ...td, color: errColor(r.abs) } }, r.abs.toFixed(4)))))));
    } else { // refractive indices
        body = h('div', { style: { overflow: 'auto', height: '100%', border: `1px solid ${c.border}`, borderRadius: 4 } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                h('thead', null, h('tr', null, [B.riLayer, B.riTheor, B.riDep, B.riDeltaN, B.riInh].map((x, i) => h('th', { key: i, style: th }, x)))),
                h('tbody', null, rows.map(r => h('tr', { key: r.i },
                    h('td', { style: { ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }, title: r.name }, cullName(r.name, 18)),
                    h('td', { style: td }, r.nTheor.toFixed(4)),
                    h('td', { style: td }, r.nDep.toFixed(4)),
                    h('td', { style: { ...td, color: errColor(r.dn * 100) } }, r.dn.toFixed(4)),
                    h('td', { style: td }, r.inh.toFixed(3)))))));
    }

    return h('div', { style: { display: 'flex', gap: 16, flex: 1, minHeight: 0 } },
        h('div', { style: { width: 130, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 } },
            h('div', { style: { fontSize: 12, fontWeight: 600, color: c.text } }, B.yAxisScale),
            h(Radio, { checked: !p.yFixed, onChange: () => set('yFixed', false), label: B.auto, c }),
            h(Radio, { checked: p.yFixed, onChange: () => set('yFixed', true), label: B.fixed, c }),
            h('button', { disabled: true, title: B.deferredHint,
                style: { marginTop: 8, padding: '7px', fontSize: 12, borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.textDim, cursor: 'not-allowed', opacity: 0.5 } }, B.generateReport),
            h('button', { disabled: true, title: B.deferredHint,
                style: { padding: '7px', fontSize: 12, borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.textDim, cursor: 'not-allowed', opacity: 0.5 } }, B.load)),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { display: 'flex', alignItems: 'flex-end', borderBottom: `1px solid ${c.border}`, marginBottom: 8 } },
                tabBtn('spectral', B.spectralPerf), tabBtn('relerr', B.relErrors), tabBtn('abserr', B.absErrors), tabBtn('thick', B.thicknesses), tabBtn('ri', B.refIndices)),
            h('div', { style: { flex: 1, minHeight: 0 } }, body)));
}

// ══ Wizard shell ════════════════════════════════════════════════════════════════
export function BBMWizard({ c, t, onClose }) {
    const B = t.bbmSim;
    const { design } = useDesign();
    const [step, setStep] = useState(1);
    const [run, setRun] = useState(null);   // captured single-experiment trajectory

    // Which coating this run deposits + how the resulting spectrum is scored —
    // mirrors the Optical Evaluation plot (resolveEvalMode). back_only deposits
    // the BACK stack, simulated as a front coating grown from the exit side:
    // reversed storage order + the exit medium as the incident medium.
    const evalMode   = resolveEvalMode(design);
    const activeSide = (design?.surfaceMode === 'back_only') ? 'back' : 'front';
    const simDesign  = useMemo(() => {
        if (!design) return null;
        if (activeSide === 'back') {
            return { ...design,
                frontLayers: [...(design.backLayers || [])].reverse(),
                incidentMedium: design.exitMedium };
        }
        return design;
    }, [design, activeSide]);

    // Active stack in storage order, index-aligned to simulateRun arrays.
    const layers = useMemo(() => (simDesign?.frontLayers || []).map(l => ({ ...l })), [simDesign]);
    const materialIds = useMemo(() => {
        const s = []; const seen = new Set();
        for (const l of layers) if (!seen.has(l.material)) { seen.add(l.material); s.push(l.material); }
        return s;
    }, [layers]);

    const ctx = useMemo(() => design ? {
        design, simDesign, evalMode, activeSide,
        incMat: resolveMat(medId(design.incidentMedium)),
        subMat: resolveMat(design.substrate?.material),
        exitMat: resolveMat(design.exitMedium),
        subThk: design.substrate?.thickness || 1.0,
        // Incident medium of the coating actually being deposited (the exit
        // medium in back mode) — drives the in-chamber MONITOR signal, which is
        // the active coating on a semi-infinite substrate (no back surface).
        incidentMatActive: resolveMat(medId(simDesign.incidentMedium)),
        // The opposite, static coating in ITS storage order (front: top→substrate,
        // back: substrate→exit), resolved at nominal thickness.
        otherStored: (activeSide === 'back' ? (design.frontLayers || []) : (design.backLayers || []))
            .map(l => ({ material: resolveMat(l.material), thickness: l.thickness })),
    } : null, [design, simDesign, evalMode, activeSide]);

    const [p, setP] = useState(() => ({
        rates: {}, matDev: {}, layers: [],
        selMat: null, rateNonce: 0, rateYAt0: true,
        shutterMean: 0, shutterRms: 0,
        // scanInterval/points kept modest: the monitoring fit runs a TMM sweep
        // per scan per golden-section step, so 30 pts @ 3 s scans makes a full
        // run finish in ~1 s instead of stalling for many seconds.
        quantity: 'T', pol: 'avg', aoi: 0, scanInterval: 3.0, lamMin: 400, lamMax: 800, points: 30,
        previewLayer: 1, monNonce: 0, sigNonce: 0,
        randomPct: 0.3, drift: 0, driftMeanTime: 5, driftRms: 1, yFixed: true,
        timeMult: 10, resultTab: 'spectral', seed: 0xBBADCAFE,
    }));
    const set = useCallback((key, val) => setP(prev => ({ ...prev, [key]: val })), []);

    // Seed per-material + per-layer state from the design once it's known.
    useEffect(() => {
        setP(prev => {
            const rates = { ...prev.rates }, matDev = { ...prev.matDev };
            for (const id of materialIds) {
                if (!rates[id]) rates[id] = { meanA: 4, rmsA: 0.4, corr: 3 };
                if (!matDev[id]) matDev[id] = { reNSyst: 0, reNRand: 0, systInh: 0 };
            }
            const lyr = layers.map((l, i) => prev.layers[i] || { exclude: false, relThkErr: 0 });
            return { ...prev, rates, matDev, layers: lyr, selMat: prev.selMat || materialIds[0] || null };
        });
    }, [materialIds, layers]);

    useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onClose]);

    // Build the simulateRun cfg from the wizard params (Å→nm: rate/10).
    const buildCfg = useCallback((recordTrajectory) => {
        const rates = new Map();
        for (const id of materialIds) {
            const r = p.rates[id] || { meanA: 4, rmsA: 0.4, corr: 3 };
            rates.set(id, { mean: r.meanA / 10, sigma: r.rmsA / 10, corrTime: r.corr });
        }
        const matDev = new Map();
        for (const id of materialIds) {
            const d = p.matDev[id] || {};
            matDev.set(id, { reNSyst: d.reNSyst || 0, reNRand: d.reNRand || 0, systInh: d.systInh || 0 });
        }
        const excludeLayers = new Set();
        const relThkErrByLayer = [];
        p.layers.forEach((l, i) => { if (l?.exclude) excludeLayers.add(i); relThkErrByLayer[i] = l?.relThkErr || 0; });
        return {
            _seed: p.seed >>> 0,
            rng: mulberry32(p.seed),
            rates, matDev, perMaterial: true,
            shutterDelayMeanS: p.shutterMean, shutterDelayRmsS: p.shutterRms,
            excludeLayers, relThkErrByLayer,
            mon: { char: p.quantity, theta: p.aoi, polarization: p.pol,
                   lambdaStart: p.lamMin, lambdaEnd: p.lamMax, nPoints: p.points, scanIntervalSec: p.scanInterval, confirmScans: 2 },
            sig: { randomPct: p.randomPct, driftPctPer1000s: p.drift },
            // Cheaper fit for the live single run (Monte-Carlo path is untouched).
            fitStartFrac: 0.82, fitMaxIter: 8,
            recordTrajectory,
        };
    }, [p, materialIds]);

    // Pre-sample every referenced material's [n,k] on the monitor scan λ grid so
    // the run can execute in a Web Worker (Approach A). simulateRun only samples
    // on this grid, so the worker result matches the main-thread path.
    const presampleMaterials = useCallback(() => {
        const nP = Math.max(3, p.points | 0);
        const step = (p.lamMax - p.lamMin) / (nP - 1);
        const scanL = []; for (let i = 0; i < nP; i++) scanL.push(p.lamMin + i * step);
        // Incident medium of the active run (the exit medium in back mode).
        const incId = medId(simDesign.incidentMedium);
        const subId = design.substrate?.material ?? 'BK7';
        const ids = new Set([incId, subId]); for (const id of materialIds) ids.add(id);
        const materials = {};
        for (const id of ids) {
            const m = resolveMat(id); const n = [], k = [];
            for (const lam of scanL) { const nk = m.getNK(lam); n.push(nk[0]); k.push(nk[1]); }
            materials[id] = { lambdas: scanL.slice(), n, k };
        }
        return materials;
    }, [design, simDesign, materialIds, p.points, p.lamMin, p.lamMax]);

    if (!design) return modalFrame(c, B, step, setStep, onClose, run,
        h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim } }, B.noDesign), design, t);
    if (!layers.length) return modalFrame(c, B, step, setStep, onClose, run,
        h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim } }, B.noLayers), design, t);

    const body =
        step === 1 ? h(PageRates,        { p, set, materialIds, c, B }) :
        step === 2 ? h(PageDeviations,   { p, set, materialIds, layers, c, B }) :
        step === 3 ? h(PageMonSystem,    { p, set, layers, c, B, ctx }) :
        step === 4 ? h(PageSignalErrors, { p, set, layers, c, B, ctx }) :
        step === 5 ? h(PageSimulation,   { p, set, layers, c, B, ctx, run, setRun, buildCfg, presampleMaterials }) :
                     h(PageResults,      { p, set, layers, c, B, ctx, run });

    const titles = [B.p1Title, B.p2Title, B.p3Title, B.p4Title, B.p5Title, B.p6Title];
    const subs   = [B.p1Sub, B.p2Sub, B.p3Sub, B.p4Sub, B.p5Sub, B.p6Sub];

    return modalFrame(c, B, step, setStep, onClose, run,
        h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
            h(PageHead, { title: titles[step - 1], subtitle: subs[step - 1], c }),
            body), design, t);
}

// Modal frame: header (page X of 6), scrollable body, footer (Help/Back/Next/Cancel).
function modalFrame(c, B, step, setStep, onClose, run, body, design, t) {
    return h('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } },
        h('div', { style: { background: c.panel, borderRadius: 8, padding: 20, width: 880, maxWidth: '96vw', height: 640, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.45)', border: `1px solid ${c.border}` } },
            // Header
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                    h('div', { style: { fontSize: 13, color: c.textDim } }, `${B.title} — ${B.pageLabel(step)}`),
                    design && h(EvalModeBadge, { design, c, t })),
                h('button', { onClick: onClose, style: { background: 'transparent', color: c.textDim, border: 'none', cursor: 'pointer', fontSize: 18 } }, '×')),
            // Body
            h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, body),
            // Footer
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${c.border}`, marginTop: 12 } },
                h('button', { onClick: () => window.electronAPI?.openHelp?.({ anchor: 'simulation/bbm-simulator', locale: getCurrentLocale() }), title: B.help,
                    style: { padding: '8px 16px', fontSize: 13, background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' } }, B.help),
                h('div', { style: { display: 'flex', gap: 6 } }, [1, 2, 3, 4, 5, 6].map(s => h('div', { key: s, style: { width: 8, height: 8, borderRadius: '50%', background: s === step ? c.accent : s < step ? c.accent + '88' : c.border } }))),
                h('div', { style: { display: 'flex', gap: 8 } },
                    h('button', { onClick: () => setStep(s => Math.max(1, s - 1)), disabled: step === 1,
                        style: { padding: '8px 16px', fontSize: 13, background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: step === 1 ? 'default' : 'pointer', opacity: step === 1 ? 0.4 : 1 } }, B.back),
                    step < 6 && h('button', { onClick: () => setStep(s => Math.min(6, s + 1)),
                        style: { padding: '8px 20px', fontSize: 13, fontWeight: 600, background: c.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' } }, B.next),
                    step === 6 && h('button', { onClick: onClose,
                        style: { padding: '8px 22px', fontSize: 13, fontWeight: 600, background: c.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' } }, B.finish),
                    h('button', { onClick: onClose,
                        style: { padding: '8px 16px', fontSize: 13, background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' } }, B.cancel)))));
}
