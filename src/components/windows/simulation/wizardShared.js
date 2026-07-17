/**
 * Shared building blocks for the deposition-monitoring wizards (BBMWizard,
 * MonoWizard). These are the visual atoms and small helpers the broadband and
 * monochromatic wizards have in common — style helpers, compact numeric fields,
 * the layer-tab strip, the interactive deposition timeline, and the generic
 * Plotly chart — kept in one place so both wizards stay visually identical.
 *
 * Style mirrors FilterDesignWizard / ProcessSimulator.
 */

import { getMaterialById } from '../../../utils/materials/catalogManager.js';
import { getMaterial }     from '../../../utils/materials/materialDatabase.js';
import { makeShiftedMaterial } from '../../../utils/monitoring/monitoringSim.js';
import { systemSpectrum, splitActiveStacks } from '../../../utils/monitoring/depositionSpectrum.js';

const { createElement: h, useRef, useEffect } = React;

export function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Medium can be a bare id string or { material }.
export function medId(m) { return typeof m === 'string' ? m : (m?.material ?? 'Air'); }

// Long material names blow up the narrow tables / dropdowns — cull to `max`
// chars with an ellipsis (full name stays available as a title tooltip).
export function cullName(name, max = 22) {
    if (!name) return '';
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
}
export function matName(id) { return resolveMat(id)?.name || id; }

// ── Shared style atoms ─────────────────────────────────────────────────────────
export function inputStyle(c, w) {
    return { width: w, padding: '5px 7px', fontSize: 13, backgroundColor: c.bg, color: c.text,
             border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none', boxSizing: 'border-box' };
}
export function NumField({ label, value, min, max, step, onChange, c, suffix, width = 110 }) {
    return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
        label && h('span', null, label),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('input', { type: 'number', value, min, max, step: step ?? 'any',
                onChange: (e) => { const v = parseFloat(e.target.value); onChange(Number.isNaN(v) ? 0 : v); },
                style: inputStyle(c, width) }),
            suffix && h('span', { style: { fontSize: 12, color: c.textDim } }, suffix)));
}
// compact numeric cell for tables
export function cellNum({ value, min, max, step, onChange, c, width = 90 }) {
    return h('input', { type: 'number', value, min, max, step: step ?? 'any',
        onChange: (e) => { const v = parseFloat(e.target.value); onChange(Number.isNaN(v) ? 0 : v); },
        style: { ...inputStyle(c, width), padding: '3px 5px', fontSize: 12 } });
}
export function Radio({ checked, onChange, label, c }) {
    return h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.text, cursor: 'pointer' } },
        h('input', { type: 'radio', checked, onChange, style: { accentColor: c.accent, cursor: 'pointer' } }), label);
}

// ── Layer tab strip ("Layer 1 2 … N" selector) ────────────────────────────────
export function LayerTabs({ n, current, onSelect, c, label }) {
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
export function RowField({ label, value, min, max, step, onChange, c, suffix, width = 70 }) {
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
// Speed-selector segment button ("1× 2× 5× …"); `i`/`arr` round the group ends.
function timelineSpeedBtn({ s, i, arr, speed, setSpeed, c }) {
    return h('button', { key: s, onClick: () => setSpeed(s),
        style: { padding: '3px 9px', fontSize: 11, cursor: 'pointer',
                 border: `1px solid ${speed === s ? c.accent : c.border}`,
                 marginLeft: i === 0 ? 0 : -1,
                 borderRadius: i === 0 ? '4px 0 0 4px' : i === arr.length - 1 ? '0 4px 4px 0' : 0,
                 background: speed === s ? c.accent + '33' : 'transparent',
                 color: speed === s ? c.accent : c.text, fontWeight: speed === s ? 600 : 400 } }, `${s}×`);
}
// Play / reset control button; disabled (and dimmed) until a run exists.
function timelineCtrlBtn(onClick, txt, wide, has, c) {
    return h('button', { onClick, disabled: !has,
        style: { padding: '4px 12px', fontSize: 12, borderRadius: 4, border: `1px solid ${c.border}`,
                 background: c.bg, color: c.text, cursor: has ? 'pointer' : 'not-allowed', opacity: has ? 1 : 0.5,
                 fontWeight: 600, minWidth: wide ? 84 : undefined } }, txt);
}

export function DepositionTimeline({ progress, totalTime, playing, onScrub, onPlayPause, onReset, speed, setSpeed, cumTimes, layerIdx, N, c, B }) {
    const has = totalTime > 0;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 4px 0', flexShrink: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            timelineCtrlBtn(onPlayPause, playing ? B.pause : B.play, true, has, c),
            timelineCtrlBtn(onReset, B.reset, false, has, c),
            h('div', { style: { display: 'flex' } }, [1, 2, 5, 10, 50, 100].map((s, i, arr) => timelineSpeedBtn({ s, i, arr, speed, setSpeed, c }))),
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
                    const tickEvery = Math.ceil(N / 16 || 1);
                    const showLabel = i > 0 && i % tickEvery === 0;
                    return h('div', { key: i, style: { position: 'absolute', left: `${pct}%`, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 } },
                        h('div', { style: { width: 1, height: 4, background: c.border } }),
                        showLabel && h('span', null, i));
                }))));
}

// ── Generic Plotly line/bar chart ──────────────────────────────────────────────
export function Chart({ traces, xTitle, yTitle, c, yRange = null, extra = {}, minHeight = 200 }) {
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

// Theory vs manufactured spectra for the wizard results page: `theory` is the
// nominal design, `manuf` the as-built stack (per-layer thickness + index shift
// captured in the run). Returns null until a run exists. Shared by BBM/Mono,
// whose deposition model and cut rule differ only in the run, not this readout.
export function computeWizardResultSpectra({ run, ctx, layers, quantity, aoi, pol, lamMin, lamMax }) {
    if (!run || !ctx) return null;
    const lamStep = Math.max(0.5, (lamMax - lamMin) / 300);
    const baseThicks = layers.map(l => l.thickness || 0);
    const perf = (activeStored) => {
        const { frontStored, backStored } = splitActiveStacks(ctx.activeSide, activeStored, ctx.otherStored);
        return systemSpectrum({
            evalMode: ctx.evalMode, frontStored, backStored,
            quantity, aoi, polarization: pol,
            lambdaStart: lamMin, lambdaEnd: lamMax, lambdaStep: lamStep,
            incidentMat: ctx.incMat, substrateMat: ctx.subMat, exitMat: ctx.exitMat, substrateThk: ctx.subThk,
        });
    };
    const theory = perf(layers.map((l, i) => ({ material: resolveMat(l.material), thickness: baseThicks[i] })));
    const manuf  = perf(layers.map((l, i) => ({
        material: makeShiftedMaterial(resolveMat(l.material), run.matDeltas[i]?.dn || 0, run.matDeltas[i]?.dk || 0),
        thickness: run.asBuiltFront[i],
    })));
    return { theory, manuf };
}

// ── Page header (title + subtitle) ─────────────────────────────────────────────
export function PageHead({ title, subtitle, c }) {
    return h('div', { style: { padding: '2px 0 14px', borderBottom: `1px solid ${c.border}`, marginBottom: 14 } },
        h('div', { style: { fontSize: 18, fontWeight: 700, color: c.text } }, title),
        subtitle && h('div', { style: { fontSize: 12.5, color: c.textDim, marginTop: 3 } }, subtitle));
}

// Two-pane page layout: left controls (fixed width) + right chart (fills).
export function SplitPage({ left, right, c, leftWidth = 210 }) {
    return h('div', { style: { display: 'flex', gap: 16, flex: 1, minHeight: 0 } },
        h('div', { style: { width: leftWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' } }, left),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } }, right));
}
