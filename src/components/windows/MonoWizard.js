/**
 * Monochromatic Monitoring Wizard — 6-page modal wizard.
 *
 * The monochromatic counterpart of BBMWizard. The broadband and
 * monochromatic monitoring simulators are nearly identical experiments that
 * differ only in the cut rule, so this wizard intentionally reuses BBMWizard's
 * structure and visual style; only the Monitoring-System page and the run
 * engine differ:
 *
 *   Page 1  Deposition Rates       — per-material mean / RMS / correlation time
 *   Page 2  Parameters Deviation   — per-material index deviations, layers
 *                                     excluded from monitoring, shutter delay
 *   Page 3  Monitoring System      — measured quantity + AOI + scan interval,
 *                                     and a PER-LAYER table of monitoring
 *                                     wavelength + termination strategy
 *                                     (turning point / level / by time);
 *                                     ideal single-λ signal-vs-thickness preview
 *   Page 4  Signal Errors          — random noise + drift; noisy single-λ preview
 *   Page 5  Deposition Simulation  — ONE computational-manufacturing run, played
 *                                     back layer-by-layer with E/A/T bars + spectrum
 *   Page 6  Resulting Performance  — manufactured vs theory + error / thk / RI tables
 *
 * Engine: utils/monoSim.js `simulateRunMono` (single-wavelength turning/level/
 * time cut), which mirrors monitoringSim.simulateRun's cfg + return shape, so
 * pages 1/2/4/5/6 are shared with BBM. Spectra go through
 * depositionSpectrum.frontStackSpectrum → thinFilmMath, the validated path.
 *
 * Reference: Macleod, Thin-Film Optical Filters 5th ed., Ch. 12;
 *            Tikhonravov & Trubetskov, Appl. Opt. 44, 6877 (2005).
 */

import { useDesign }              from '../../state/DesignContext.js';
import { getMaterialById }        from '../../utils/materials/catalogManager.js';
import { getMaterial }            from '../../utils/materials/materialDatabase.js';
import { getCurrentLocale }       from '../../constants/locales.js';
import { resolveEvalMode }        from '../../utils/physics/optimizer.js';
import { EvalModeBadge }          from '../SurfaceModeBar.js';
import { Checkbox }               from '../ui/Checkbox.js';
import {
    simulateRunMono, defaultMonoTable, pickSensitiveLambda,
    mulberry32, makeShiftedMaterial,
}                                 from '../../utils/monitoring/monoSim.js';
import { systemSpectrum, splitActiveStacks } from '../../utils/monitoring/depositionSpectrum.js';

const { createElement: h, useState, useEffect, useMemo, useRef, useCallback } = React;

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}
// Medium can be a bare id string or { material }.
function medId(m) { return typeof m === 'string' ? m : (m?.material ?? 'Air'); }
function cullName(name, max = 22) {
    if (!name) return '';
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
}
function matName(id) { return resolveMat(id)?.name || id; }

// ── Shared style atoms (mirror BBMWizard / FilterDesignWizard) ─────────────────
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
function cellNum({ value, min, max, step, onChange, c, width = 90 }) {
    return h('input', { type: 'number', value, min, max, step: step ?? 'any',
        onChange: (e) => { const v = parseFloat(e.target.value); onChange(Number.isNaN(v) ? 0 : v); },
        style: { ...inputStyle(c, width), padding: '3px 5px', fontSize: 12 } });
}
function Radio({ checked, onChange, label, c }) {
    return h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.text, cursor: 'pointer' } },
        h('input', { type: 'radio', checked, onChange, style: { accentColor: c.accent, cursor: 'pointer' } }), label);
}
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
function RowField({ label, value, min, max, step, onChange, c, suffix, width = 70 }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 24 } },
        h('span', { style: { fontSize: 11.5, color: c.textDim, lineHeight: 1.1 } }, label),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 } },
            h('input', { type: 'number', value, min, max, step: step ?? 'any',
                onChange: (e) => { const v = parseFloat(e.target.value); onChange(Number.isNaN(v) ? 0 : v); },
                style: { ...inputStyle(c, width), padding: '3px 6px', fontSize: 12 } }),
            suffix && h('span', { style: { fontSize: 11, color: c.textDim, width: 14 } }, suffix)));
}

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

function PageHead({ title, subtitle, c }) {
    return h('div', { style: { padding: '2px 0 14px', borderBottom: `1px solid ${c.border}`, marginBottom: 14 } },
        h('div', { style: { fontSize: 18, fontWeight: 700, color: c.text } }, title),
        subtitle && h('div', { style: { fontSize: 12.5, color: c.textDim, marginTop: 3 } }, subtitle));
}
function SplitPage({ left, right, c, leftWidth = 210 }) {
    return h('div', { style: { display: 'flex', gap: 16, flex: 1, minHeight: 0 } },
        h('div', { style: { width: leftWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' } }, left),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } }, right));
}

// ── Single-λ monitor signal vs deposited thickness (one layer) ─────────────────
//
// Varies layer `k`'s (1-based, storage order) thickness 0→dHi at λ = monRow.lambda
// with previous layers fully grown; returns signal (%) vs thickness, plus the
// target thickness. Optional Gaussian random noise (% of signal) for page 4.
function monoSignalVsThickness(layers, k, monRow, common, ctx, noisePct, nonce) {
    const lam = monRow?.lambda || 550;
    const dTarget = layers[k - 1]?.thickness || 0;
    const dHi = Math.max(2 * dTarget, dTarget + 50);
    const NP = 70;
    const baseThicks = layers.map(l => l.thickness || 0);
    const frontDep = layers.map(l => ({ material: resolveMat(l.material) }));
    const rng = noisePct > 0 ? mulberry32((nonce | 0) + 17) : null;
    const ds = new Array(NP), ys = new Array(NP);
    for (let s = 0; s < NP; s++) {
        const d = (s / (NP - 1)) * dHi;
        const thicks = baseThicks.map((t, idx) => {
            const dep = idx + 1;
            if (dep < k) return t;
            if (dep === k) return d;
            return 0;
        });
        // In-chamber monitor signal: the active coating on a SEMI-INFINITE
        // substrate (no back surface), independent of the front/back/total mode.
        const r = systemSpectrum({
            evalMode: 'front',
            frontStored: frontDep.map((fd, idx) => ({ material: fd.material, thickness: thicks[idx] })),
            quantity: common.char, aoi: common.aoi, polarization: common.pol,
            lambdaStart: lam, lambdaEnd: lam, lambdaStep: 1,
            incidentMat: ctx.incidentMatActive, substrateMat: ctx.subMat,
        });
        let v = r.values[0];
        if (rng) {
            let u1 = rng(); while (u1 <= 1e-12) u1 = rng();
            const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
            v = v * (1 + g * noisePct / 100);
        }
        ds[s] = d; ys[s] = v * 100;
    }
    return { d: ds, signal: ys, dTarget, lam };
}

// ══ Page 1 — Deposition Rates ═══════════════════════════════════════════════════
function PageRates({ p, set, materialIds, c, B }) {
    const sel = p.selMat && materialIds.includes(p.selMat) ? p.selMat : materialIds[0];
    useEffect(() => { if (sel && sel !== p.selMat) set('selMat', sel); }, [sel]); // eslint-disable-line
    const rate = p.rates[sel] || { meanA: 4, rmsA: 0.4, corr: 3 };
    const setRate = (key, v) => set('rates', { ...p.rates, [sel]: { ...rate, [key]: v } });

    const path = useMemo(() => {
        const rng = mulberry32((p.rateNonce | 0) + 1);
        // Inline OU path so this page is independent of monitoringSim internals.
        const a = rate.corr > 0 ? Math.exp(-1 / rate.corr) : 0;
        const t = [], rr = [];
        const g = () => { let u1 = rng(); while (u1 <= 1e-12) u1 = rng(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()); };
        let cur = rate.rmsA > 0 ? rate.meanA + g() * rate.rmsA : rate.meanA;
        for (let i = 0; i < 500; i++) {
            t.push(i); rr.push(cur);
            cur = rate.rmsA <= 0 ? rate.meanA
                : a > 0 ? rate.meanA + a * (cur - rate.meanA) + Math.sqrt(Math.max(0, 1 - a * a)) * rate.rmsA * g()
                        : rate.meanA + g() * rate.rmsA;
        }
        return { t, r: rr };
    }, [rate.meanA, rate.rmsA, rate.corr, p.rateNonce]);
    const traces = [{ x: path.t, y: path.r, type: 'scatter', mode: 'lines', line: { color: '#1f6feb', width: 1.3 } }];
    const yRange = p.rateYAt0 ? [0, Math.max(rate.meanA + 4 * Math.max(rate.rmsA, 0.1), rate.meanA * 1.4)] : null;

    return h(SplitPage, { c, leftWidth: 200,
        left: [
            h('label', { key: 'msl', style: { fontSize: 12, color: c.textDim, fontWeight: 600 } }, B.material),
            h('select', { key: 'ms', value: sel || '', onChange: (e) => set('selMat', e.target.value), style: inputStyle(c, '100%') },
                materialIds.map(id => h('option', { key: id, value: id, title: matName(id) }, cullName(matName(id), 26)))),
            h('div', { key: 'grp', style: { fontSize: 12, fontWeight: 600, color: c.text, marginTop: 4 } }, cullName(matName(sel), 24)),
            h(NumField, { key: 'mean', label: B.meanRate, value: rate.meanA, min: 0.01, max: 200, step: 0.1, c, width: 110, onChange: (v) => setRate('meanA', v) }),
            h(NumField, { key: 'rms', label: B.rms, value: rate.rmsA, min: 0, max: 100, step: 0.05, c, width: 110, onChange: (v) => setRate('rmsA', v) }),
            h(NumField, { key: 'corr', label: B.corrTime, value: rate.corr, min: 0, max: 120, step: 0.5, c, width: 110, onChange: (v) => setRate('corr', v) }),
            h('label', { key: 'y0', style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.text, cursor: 'pointer', marginTop: 4 } },
                h(Checkbox, { c, checked: p.rateYAt0, onChange: (e) => set('rateYAt0', e.target.checked) }),
                B.yAxisAt0),
            h('button', { key: 'rnd', onClick: () => set('rateNonce', (p.rateNonce | 0) + 1),
                style: { marginTop: 6, padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, B.randomize),
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
                            h(Checkbox, { c, checked: !!p.layers[i]?.exclude,
                                onChange: (e) => setLayer(i, 'exclude', e.target.checked) })),
                        h('td', { style: td }, cellNum({ value: p.layers[i]?.relThkErr ?? 0, step: 0.01, min: 0, max: 100, c, width: 80, onChange: (v) => setLayer(i, 'relThkErr', v) })))))))),
        h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 18, flexShrink: 0 } },
            h(NumField, { label: B.shutterMean, value: p.shutterMean, min: 0, max: 30, step: 0.1, c, width: 90, suffix: 's', onChange: (v) => set('shutterMean', v) }),
            h(NumField, { label: B.shutterRms, value: p.shutterRms, min: 0, max: 30, step: 0.1, c, width: 90, suffix: 's', onChange: (v) => set('shutterRms', v) })),
    );
}

// ══ Page 3 — Monitoring System (per-layer λ + strategy) ══════════════════════════
function PageMonoSystem({ p, set, layers, c, B, ctx, design }) {
    const k = Math.min(Math.max(1, p.previewLayer || 1), layers.length);
    const common = { char: p.quantity, aoi: p.aoi, pol: p.pol };
    const monRow = p.monTable[k - 1] || { lambda: design.referenceWavelength || 550, strategy: 'turning', order: 1 };

    const preview = useMemo(() =>
        (layers.length && ctx) ? monoSignalVsThickness(layers, k, monRow, common, ctx, 0, p.monNonce) : null,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [layers, k, monRow.lambda, p.quantity, p.aoi, p.pol, p.monNonce, ctx]);

    const traces = preview ? [{ x: preview.d, y: preview.signal, type: 'scatter', mode: 'lines', line: { color: '#1f6feb', width: 1.6 } }] : [];
    const shapes = preview ? [{ type: 'line', x0: preview.dTarget, x1: preview.dTarget, yref: 'paper', y0: 0, y1: 1,
        line: { color: '#2da44e', width: 1.2, dash: 'dash' } }] : [];

    const setMon = (i, key, v) => { const arr = p.monTable.map(x => ({ ...x })); arr[i] = { ...arr[i], [key]: v }; set('monTable', arr); };
    const autoAll = () => {
        const ref = design.referenceWavelength || 550;
        const arr = layers.map((l, i) => {
            const lam = pickSensitiveLambda(design, resolveMat, i, ref * 0.7, ref * 1.3, p.aoi, p.pol, p.quantity);
            return { ...(p.monTable[i] || {}), lambda: lam };
        });
        set('monTable', arr); set('monNonce', (p.monNonce | 0) + 1);
    };

    const th = { textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${c.border}`, fontWeight: 600, color: c.textDim, fontSize: 11.5, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: c.panel };
    const td = { padding: '3px 8px', borderBottom: `1px solid ${c.border}55`, fontSize: 12, color: c.text };
    const stratOpts = [['turning', B.stratTurning], ['level', B.stratLevel], ['time', B.stratTime]];

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 } },
        // Controls row
        h('div', { style: { display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap', flexShrink: 0 } },
            h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
                h('span', null, B.quantity),
                h('select', { value: p.quantity + p.pol, onChange: (e) => { const v = e.target.value; set('quantity', v[0]); set('pol', v.slice(1)); }, style: { ...inputStyle(c, 110), padding: '4px 6px' } },
                    [['Tavg', B.qTavg], ['Ts', B.qTs], ['Tp', B.qTp], ['Ravg', B.qRavg], ['Rs', B.qRs], ['Rp', B.qRp]].map(([v, l]) => h('option', { key: v, value: v }, l)))),
            h(NumField, { label: B.incidence, value: p.aoi, min: 0, max: 89, step: 1, c, width: 80, onChange: (v) => set('aoi', v) }),
            h(NumField, { label: B.scanInterval, value: p.scanInterval, min: 0.05, max: 60, step: 0.1, c, width: 90, onChange: (v) => set('scanInterval', v) }),
            h(NumField, { label: B.confirmScans, value: p.confirmScans, min: 1, max: 10, step: 1, c, width: 70, onChange: (v) => set('confirmScans', Math.max(1, Math.round(v))) }),
            h('button', { onClick: autoAll, title: B.autoLambdaHint,
                style: { padding: '7px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, B.autoLambda)),
        // Preview chart
        h('div', { style: { height: 200, flexShrink: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { flex: 1, minHeight: 0 } },
                h(Chart, { traces, xTitle: B.thicknessAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, extra: { shapes }, minHeight: 0 })),
            h(LayerTabs, { n: layers.length, current: k, onSelect: (kk) => set('previewLayer', kk), c, label: B.layerWord })),
        // Per-layer monitor table
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { fontSize: 12.5, fontWeight: 600, color: c.text, marginBottom: 6 } }, B.monAlgoTitle),
            h('div', { style: { border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'auto', flex: 1 } },
                h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                    h('thead', null, h('tr', null, [B.colNum, B.colMaterial, B.colLambda, B.colStrategy, B.colOrder].map((x, i) => h('th', { key: i, style: th }, x)))),
                    h('tbody', null, layers.map((l, i) => {
                        const m = p.monTable[i] || { lambda: design.referenceWavelength || 550, strategy: 'turning', order: 1 };
                        const active = i === k - 1;
                        return h('tr', { key: i, onClick: () => set('previewLayer', i + 1),
                            style: { cursor: 'pointer', background: active ? c.accent + '18' : 'transparent' } },
                            h('td', { style: td }, i + 1),
                            h('td', { style: { ...td, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: matName(l.material) }, cullName(matName(l.material), 18)),
                            h('td', { style: td }, cellNum({ value: m.lambda ?? 550, step: 1, min: 100, max: 20000, c, width: 78, onChange: (v) => setMon(i, 'lambda', v) })),
                            h('td', { style: td },
                                h('select', { value: m.strategy || 'turning', onChange: (e) => setMon(i, 'strategy', e.target.value), style: { ...inputStyle(c, 120), padding: '3px 5px', fontSize: 12 } },
                                    stratOpts.map(([v, lbl]) => h('option', { key: v, value: v }, lbl)))),
                            h('td', { style: td }, m.strategy === 'turning'
                                ? cellNum({ value: m.order ?? 1, step: 1, min: 1, max: 12, c, width: 54, onChange: (v) => setMon(i, 'order', Math.max(1, Math.round(v))) })
                                : h('span', { style: { color: c.textDim } }, '—')));
                    }))))),
    );
}

// ══ Page 4 — Signal Errors ═══════════════════════════════════════════════════════
function PageSignalErrors({ p, set, layers, c, B, ctx, design }) {
    const k = Math.min(Math.max(1, p.previewLayer || 1), layers.length);
    const common = { char: p.quantity, aoi: p.aoi, pol: p.pol };
    const monRow = p.monTable[k - 1] || { lambda: design.referenceWavelength || 550, strategy: 'turning', order: 1 };
    const preview = useMemo(() =>
        (layers.length && ctx) ? monoSignalVsThickness(layers, k, monRow, common, ctx, p.randomPct, p.sigNonce) : null,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [layers, k, monRow.lambda, p.quantity, p.aoi, p.pol, p.randomPct, p.sigNonce, ctx]);
    const traces = preview ? [{ x: preview.d, y: preview.signal, type: 'scatter', mode: 'lines', line: { color: '#e5484d', width: 1.3 } }] : [];
    const shapes = preview ? [{ type: 'line', x0: preview.dTarget, x1: preview.dTarget, yref: 'paper', y0: 0, y1: 1,
        line: { color: '#2da44e', width: 1.2, dash: 'dash' } }] : [];

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
            h('button', { key: 'upd', onClick: () => set('sigNonce', (p.sigNonce | 0) + 1),
                style: { marginTop: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.text } }, B.update),
        ],
        right: h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { flex: 1, minHeight: 0 } },
                h(Chart, { traces, xTitle: B.thicknessAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, yRange: p.yFixed ? [0, 100] : null, extra: { shapes } })),
            h(LayerTabs, { n: layers.length, current: k, onSelect: (kk) => set('previewLayer', kk), c, label: B.layerWord })),
    });
}

// ══ Page 5 — Deposition Simulation (main-thread mono run) ════════════════════════
function PageSimulation({ p, set, layers, c, B, ctx, run, setRun, buildCfg }) {
    const N = layers.length;
    const [progress, setProgress] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [busy, setBusy] = useState(false);
    const rafRef = useRef(null);
    const seedRef = useRef(0);

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

    useEffect(() => {
        if (!playing || totalTime <= 0) return;
        let last = null;
        const tick = (now) => {
            if (last == null) last = now;
            const dt = Math.min((now - last) / 1000, 0.25); last = now;
            setProgress(pr => { const np = pr + dt * p.timeMult; if (np >= totalTime) { setPlaying(false); return totalTime; } return np; });
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [playing, totalTime, p.timeMult]);
    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

    const start = useCallback(() => {
        setBusy(true); setPlaying(false);
        const cfg = buildCfg(true);
        const seed = (cfg._seed ^ Math.imul(++seedRef.current, 0x9E3779B1)) >>> 0;
        // Single-λ run is cheap; defer so the busy state paints, then run on the
        // main thread (no worker needed for one experiment).
        setTimeout(() => {
            try {
                const res = simulateRunMono(ctx.simDesign, resolveMat, { ...cfg, rng: mulberry32(seed) });
                setRun(res); setProgress(0); setPlaying(true);
            } finally { setBusy(false); }
        }, 20);
    }, [ctx, buildCfg, setRun]);

    const playPause = useCallback(() => {
        if (totalTime <= 0) return;
        setProgress(pr => (pr >= totalTime - 1e-9 ? 0 : pr));
        setPlaying(pl => !pl);
    }, [totalTime]);
    const reset = useCallback(() => { setPlaying(false); setProgress(0); }, []);
    const scrub = useCallback((v) => { setPlaying(false); setProgress(v); }, []);
    const jumpLayer = useCallback((kk) => { setPlaying(false); setProgress(Math.max(0, cumTimes[kk] - (cumTimes[kk] - cumTimes[kk - 1]) * 0.02)); }, [cumTimes]);

    // Resulting-performance spectra follow the OE evaluation mode (front semi-
    // infinite / total with the real back coating / back); in total mode the
    // opposite coating is present at nominal thickness.
    const lamStep = Math.max(0.8, (p.lamMax - p.lamMin) / 160);
    const baseThicks = layers.map(l => l.thickness || 0);
    const partial = (k, frc) => baseThicks.map((d, i) => { const dep = i + 1; if (dep < k) return d; if (dep === k) return d * frc; return 0; });
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
            const thk = partial(layerIdx, f);
            return perfSpec(layers.map((l, i) => ({ material: resolveMat(l.material), thickness: thk[i] })));
        };
        return { end: mk(1), f80: mk(0.8), f90: mk(0.9) };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run, layerIdx, p.quantity, p.aoi, p.pol, p.lamMin, p.lamMax]);

    const actualCurve = useMemo(() => {
        if (!run || layerIdx < 1) return null;
        const thk = run.asBuiltFront.map((d, i) => { const dep = i + 1; if (dep < layerIdx) return d; if (dep === layerIdx) return d * frac; return 0; });
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

    const cur = layerIdx >= 1 ? layerIdx - 1 : 0;
    const tT = run ? (run.targetFront[cur] || 0) : 0;
    const tA = run ? (run.asBuiltFront[cur] || 0) * frac : 0;
    const tE = run ? (run.estimatedFront?.[cur] || 0) : 0;
    const barTraces = [{ type: 'bar', x: [B.barE, B.barA, B.barT], y: [tE, tA, tT], marker: { color: ['#e5484d', '#19b3c4', '#2da44e'] } }];

    return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        h(SplitPage, { c, leftWidth: 184,
            left: [
                busy
                    ? h('div', { key: 'busy', style: { fontSize: 12, color: c.textDim } }, B.computing)
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
            { x: spectra.theory.lambda, y: spectra.theory.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: c.text === '#cccccc' ? '#dddddd' : '#222', width: 2 } },
            { x: spectra.manuf.lambda, y: spectra.manuf.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: '#e5484d', width: 1.6 } },
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
    } else {
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
            h(Radio, { checked: p.yFixed, onChange: () => set('yFixed', true), label: B.fixed, c })),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { display: 'flex', alignItems: 'flex-end', borderBottom: `1px solid ${c.border}`, marginBottom: 8 } },
                tabBtn('spectral', B.spectralPerf), tabBtn('relerr', B.relErrors), tabBtn('abserr', B.absErrors), tabBtn('thick', B.thicknesses), tabBtn('ri', B.refIndices)),
            h('div', { style: { flex: 1, minHeight: 0 } }, body)));
}

// ══ Wizard shell ════════════════════════════════════════════════════════════════
export function MonoWizard({ c, t, onClose }) {
    const B = t.monoSim;
    const { design } = useDesign();
    const [step, setStep] = useState(1);
    const [run, setRun] = useState(null);

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

    // Active stack in storage order, index-aligned to simulateRunMono arrays.
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
        // medium in back mode) — drives the in-chamber MONITOR signal (the active
        // coating on a semi-infinite substrate, no back surface).
        incidentMatActive: resolveMat(medId(simDesign.incidentMedium)),
        // The opposite, static coating in ITS storage order (front: top→substrate,
        // back: substrate→exit), resolved at nominal thickness.
        otherStored: (activeSide === 'back' ? (design.frontLayers || []) : (design.backLayers || []))
            .map(l => ({ material: resolveMat(l.material), thickness: l.thickness })),
    } : null, [design, simDesign, evalMode, activeSide]);

    const [p, setP] = useState(() => ({
        rates: {}, matDev: {}, layers: [], monTable: [],
        selMat: null, rateNonce: 0, rateYAt0: true,
        shutterMean: 0, shutterRms: 0,
        quantity: 'T', pol: 'avg', aoi: 0, scanInterval: 1.0, confirmScans: 2,
        lamMin: 400, lamMax: 800,                 // display band (spectrum pages)
        previewLayer: 1, monNonce: 0, sigNonce: 0,
        randomPct: 0.3, drift: 0, driftMeanTime: 5, driftRms: 1, yFixed: true,
        timeMult: 10, resultTab: 'spectral', seed: 0x300FCAFE,
    }));
    const set = useCallback((key, val) => setP(prev => ({ ...prev, [key]: val })), []);

    // Seed per-material rate/deviation state, per-layer exclude state and the
    // per-layer monitor table from the design once it's known.
    useEffect(() => {
        if (!design) return;
        // Initial display band from the design's spectrum range when available.
        const ds = Number.isFinite(design.spectrumLambdaStart) ? design.spectrumLambdaStart : null;
        const de = Number.isFinite(design.spectrumLambdaEnd) ? design.spectrumLambdaEnd : null;
        setP(prev => {
            const rates = { ...prev.rates }, matDev = { ...prev.matDev };
            for (const id of materialIds) {
                if (!rates[id]) rates[id] = { meanA: 4, rmsA: 0.4, corr: 3 };
                if (!matDev[id]) matDev[id] = { reNSyst: 0, reNRand: 0, systInh: 0 };
            }
            const lyr = layers.map((l, i) => prev.layers[i] || { exclude: false, relThkErr: 0 });
            let monTable = prev.monTable;
            if (!monTable || monTable.length !== layers.length) {
                // Default to the design reference wavelength + turning where the
                // layer is ~quarter-wave (classic single-λ monitoring). The
                // "Auto λ" button re-picks the most-sensitive λ per layer.
                monTable = defaultMonoTable(simDesign, resolveMat, {
                    autoPickLambda: false, theta: prev.aoi, pol: prev.pol, char: prev.quantity,
                });
            }
            return {
                ...prev, rates, matDev, layers: lyr, monTable,
                selMat: prev.selMat || materialIds[0] || null,
                lamMin: prev._bandInit ? prev.lamMin : (ds ?? prev.lamMin),
                lamMax: prev._bandInit ? prev.lamMax : (de ?? prev.lamMax),
                _bandInit: true,
            };
        });
    }, [materialIds, layers, design, simDesign]);

    useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onClose]);

    const buildCfg = useCallback(() => {
        const rates = new Map();
        for (const id of materialIds) {
            const r = p.rates[id] || { meanA: 4, rmsA: 0.4, corr: 3 };
            rates.set(id, { mean: r.meanA / 10, sigma: r.rmsA / 10, corrTime: r.corr });   // Å/s → nm/s
        }
        const matDev = new Map();
        for (const id of materialIds) {
            const d = p.matDev[id] || {};
            matDev.set(id, { reNSyst: d.reNSyst || 0, reNRand: d.reNRand || 0, systInh: d.systInh || 0 });
        }
        const excludeLayers = new Set();
        const relThkErrByLayer = [];
        p.layers.forEach((l, i) => { if (l?.exclude) excludeLayers.add(i); relThkErrByLayer[i] = l?.relThkErr || 0; });
        const monTable = (p.monTable || []).map(m => ({
            lambda: m.lambda, strategy: m.strategy || 'turning', order: m.order || 1, sigmaRelPct: m.sigmaRelPct || 0,
        }));
        return {
            _seed: p.seed >>> 0,
            rates, matDev, perMaterial: true,
            shutterDelayMeanS: p.shutterMean, shutterDelayRmsS: p.shutterRms,
            excludeLayers, relThkErrByLayer,
            monTable,
            mon: { char: p.quantity, theta: p.aoi, polarization: p.pol, scanIntervalSec: p.scanInterval, confirmScans: Math.max(1, p.confirmScans | 0) },
            sig: { randomPct: p.randomPct, driftPctPer1000s: p.drift },
            recordTrajectory: true,
        };
    }, [p, materialIds]);

    if (!design) return modalFrame(c, B, step, setStep, onClose,
        h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim } }, B.noDesign), design, t);
    if (!layers.length) return modalFrame(c, B, step, setStep, onClose,
        h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim } }, B.noLayers), design, t);

    const body =
        step === 1 ? h(PageRates,        { p, set, materialIds, c, B }) :
        step === 2 ? h(PageDeviations,   { p, set, materialIds, layers, c, B }) :
        step === 3 ? h(PageMonoSystem,   { p, set, layers, c, B, ctx, design }) :
        step === 4 ? h(PageSignalErrors, { p, set, layers, c, B, ctx, design }) :
        step === 5 ? h(PageSimulation,   { p, set, layers, c, B, ctx, run, setRun, buildCfg }) :
                     h(PageResults,      { p, set, layers, c, B, ctx, run });

    const titles = [B.p1Title, B.p2Title, B.p3Title, B.p4Title, B.p5Title, B.p6Title];
    const subs   = [B.p1Sub, B.p2Sub, B.p3Sub, B.p4Sub, B.p5Sub, B.p6Sub];

    return modalFrame(c, B, step, setStep, onClose,
        h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
            h(PageHead, { title: titles[step - 1], subtitle: subs[step - 1], c }),
            body), design, t);
}

function modalFrame(c, B, step, setStep, onClose, body, design, t) {
    return h('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } },
        h('div', { style: { background: c.panel, borderRadius: 8, padding: 20, width: 880, maxWidth: '96vw', height: 640, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.45)', border: `1px solid ${c.border}` } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                    h('div', { style: { fontSize: 13, color: c.textDim } }, `${B.title} — ${B.pageLabel(step)}`),
                    design && h(EvalModeBadge, { design, c, t })),
                h('button', { onClick: onClose, style: { background: 'transparent', color: c.textDim, border: 'none', cursor: 'pointer', fontSize: 18 } }, '×')),
            h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, body),
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${c.border}`, marginTop: 12 } },
                h('button', { onClick: () => window.electronAPI?.openHelp?.({ anchor: 'simulation/mono-simulator', locale: getCurrentLocale() }), title: B.help,
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
