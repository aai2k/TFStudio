/**
 * Filter Design Wizard — six-step narrow band-pass / WDM designer.
 *
 * Reworked from the old WDM wizard onto the new engine (`filterDesign.js` +
 * `filterDesignBuild.js`), with the pipeline:
 *   1 Materials    — H/L (+optional substrate/incident), oblique incidence
 *   2 Parameters   — λ₀, Δλ@89.13 %, Δλ@0.1 %, shape factor + prototype plot
 *   3 Cavities     — recommended count (Chebyshev) + override
 *   4 Prototype    — (m,k) equivalent family table + embedded preview
 *   5 Integer Search — Global Integer Search (Web Worker) + candidate list
 *   6 Adjust       — No-AR / 1-layer / 2-layer "V" coat + air preview → Finish
 *
 * The first five steps design in the EMBEDDED case (incident index = substrate
 * index); step 6 introduces the real incident medium with an AR coating. This
 * is what makes the generated design near-final immediately.
 *
 * Reference: example LEC25D9-1.
 */

import { getMaterialById } from '../../utils/materials/catalogManager.js';
import { getMaterial } from '../../utils/materials/materialDatabase.js';
import {
    materialIndexFn, qwThickness, buildPrototypeLayers, embeddedT, spectrumT,
    recommendCavities, buildPrototypeFamily, idealFilterCurve,
    oddUp, coupledMirrors, couplingOrder,
} from '../../utils/filter/filterDesign.js';

// Thelen coupling order δ (Eq. 10) from the chosen materials.
function couplingD(p) {
    const nH = materialIndexFn(p.matH, getMaterialById)(p.lambda0_nm)[0];
    const nL = materialIndexFn(p.matL, getMaterialById)(p.lambda0_nm)[0];
    const nS = materialIndexFn(p.substrateMaterial, getMaterialById)(p.lambda0_nm)[0];
    return couplingOrder(nH, nL, nS);
}
import {
    buildFilterDesignObject, presampleForSearch,
} from '../../utils/filter/filterDesignBuild.js';
import { MaterialPicker } from '../ui/MaterialPicker.js';
import { getCurrentLocale } from '../../constants/locales.js';

const { createElement: h, useState, useMemo, useEffect, useRef, useCallback } = React;

import { FILTER_WORKER_URL as WORKER_URL } from '../../workerUrls.js';

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS = {
    matH: 'builtin:Nb2O5', matL: 'builtin:SiO2',
    substrateMaterial: 'builtin:BK7', substrateThicknessMm: 1.0,
    incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    lambda0_nm: 600,
    passHalf_nm: 1.5,          // Δλ @ passLevel
    stopHalf_nm: 4.5,          // Δλ @ stopLevel
    passLevel: 89.13,          // % (0.5 dB)
    stopLevel: 0.1,            // % (30 dB)
    cavities: null,            // null → auto
    spacerKind: 'L',
    aoi: 0, pol: 'avg', oblique: false,
    // prototype selection (step 4)
    seedMirror: null, seedSpacer: null,
    // integer-search options (step 5)
    symMirrors: false, symCavities: false, restarts: 14,
    // chosen candidate + AR (step 5/6)
    selected: null,            // { mirrors, spacers, mf, layers, thicknessNm }
    arMode: 'vcoat',
    name: 'Filter Design',
};

function shapeFactor(p) { return p.passHalf_nm > 0 ? p.stopHalf_nm / p.passHalf_nm : 0; }

function resolveMat(id) { return getMaterialById(id) || getMaterial(id) || getMaterial('Air'); }

// ── Field helpers ─────────────────────────────────────────────────────────────
function fieldLabel(c) { return { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim }; }
function inputStyle(c, w) { return { width: w, padding: '6px 8px', fontSize: 13, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none' }; }

function NumField({ label, value, min, max, step, onChange, c, suffix, width = 110, hint }) {
    return h('label', { style: fieldLabel(c) },
        h('span', {}, label),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('input', { type: 'number', value, min, max, step: step ?? 'any',
                onChange: (e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(v); },
                style: inputStyle(c, width) }),
            suffix && h('span', { style: { fontSize: 12, color: c.textDim } }, suffix)),
        hint && h('span', { style: { fontSize: 10.5, color: c.textDim, opacity: 0.85 } }, hint));
}
function IntField({ label, value, min, max, onChange, c, hint }) {
    return h('label', { style: fieldLabel(c) },
        h('span', {}, label),
        h('input', { type: 'number', value, min, max, step: 1,
            onChange: (e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) onChange(v); },
            style: inputStyle(c, 90) }),
        hint && h('span', { style: { fontSize: 10.5, color: c.textDim, opacity: 0.85 } }, hint));
}
function CheckField({ label, value, onChange, c, hint }) {
    return h('label', { style: { ...fieldLabel(c), cursor: 'pointer' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('input', { type: 'checkbox', checked: !!value, onChange: (e) => onChange(e.target.checked) }),
            h('span', {}, label)),
        hint && h('span', { style: { fontSize: 10.5, color: c.textDim, opacity: 0.85 } }, hint));
}
function StepHeader({ step, title, c }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0 12px', borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
        h('div', { style: { fontSize: 11, color: c.textDim, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 } }, `Step ${step} of 6`),
        h('div', { style: { fontSize: 16, fontWeight: 600, color: c.text } }, title));
}

// ── Spectrum plot (embedded / air / analytic) ─────────────────────────────────
// layers: engine layers; mode 'embedded'|'air'. analyticT: optional λ→T fraction
// (bypasses TMM — used for the step-2 ideal-target schematic). levelLines: [{y,color,x0,x1}]
function SpectrumPlot({ layersFn, analyticT = null, p, mode = 'embedded', c, height = 280, levelLines = [], windowNm = null }) {
    const divRef = useRef(null);
    const data = useMemo(() => {
        try {
            // focus on the passband + skirts (not the whole QW-mirror HR zone)
            const win = windowNm || Math.max(p.stopHalf_nm * 1.5, p.passHalf_nm * 2.5, 5);
            const lo = p.lambda0_nm - win, hi = p.lambda0_nm + win;
            const lams = new Set();
            const coarse = Math.max((hi - lo) / 500, 0.02);
            for (let l = lo; l <= hi; l += coarse) lams.add(Math.round(l * 1e4) / 1e4);
            const fineW = Math.max(p.passHalf_nm * 4, 1), fs = Math.max(fineW / 300, 0.003);
            for (let l = p.lambda0_nm - fineW; l <= p.lambda0_nm + fineW; l += fs) lams.add(Math.round(l * 1e4) / 1e4);
            const xs = [...lams].sort((a, b) => a - b);
            if (analyticT) {
                return { xs, T: xs.map(x => analyticT(x) * 100) };
            }
            const layers = layersFn();
            if (!layers || !layers.length) return { empty: true };
            const nSub = materialIndexFn(p.substrateMaterial, getMaterialById);
            const nInc = mode === 'embedded' ? nSub : materialIndexFn(p.incidentMedium, getMaterialById);
            const T = xs.map(x => (mode === 'embedded' ? embeddedT(layers, x, nSub) : spectrumT(layers, x, nInc, nSub)) * 100);
            return { xs, T };
        } catch (err) { return { error: err.message }; }
    }, [layersFn, analyticT, p.lambda0_nm, p.passHalf_nm, p.stopHalf_nm, p.substrateMaterial, p.incidentMedium, mode, windowNm]);

    useEffect(() => {
        if (!divRef.current || !window.Plotly || data.error || data.empty) return;
        const traces = [{ x: data.xs, y: data.T, type: 'scatter', mode: 'lines', name: 'T', line: { color: '#4fc3f7', width: 1.7 } }];
        const shapes = [
            { type: 'line', xref: 'x', yref: 'paper', x0: p.lambda0_nm, x1: p.lambda0_nm, y0: 0, y1: 1, line: { color: c.textDim, width: 1, dash: 'dot' } },
            ...levelLines.map(L => ({ type: 'line', xref: 'x', yref: 'y', x0: L.x0, x1: L.x1, y0: L.y, y1: L.y, line: { color: L.color, width: 2 } })),
        ];
        const layout = {
            margin: { l: 46, r: 12, t: 8, b: 36 },
            xaxis: { title: { text: 'λ (nm)', font: { size: 11, color: c.textDim } }, color: c.text, gridcolor: c.border, tickfont: { size: 10 } },
            yaxis: { title: { text: 'T (%)', font: { size: 11, color: c.textDim } }, color: c.text, gridcolor: c.border, tickfont: { size: 10 }, range: [-2, 105] },
            paper_bgcolor: c.panel, plot_bgcolor: c.bg, font: { color: c.text, size: 11 }, shapes, showlegend: false,
        };
        window.Plotly.react(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
    }, [data, c, levelLines]);

    // Purge the Plotly graph on unmount (leak per docking tab switch).
    useEffect(() => () => {
        if (divRef.current && window.Plotly) window.Plotly.purge(divRef.current);
    }, []);

    if (data.error) return h('div', { style: { color: c.warning || '#ef5350', fontSize: 12, padding: 10 } }, data.error);
    return h('div', { ref: divRef, style: { width: '100%', height } });
}

// ── Stack visualization bar (layer bar) ───────────────────────────────────────
// layers: engine layers [{tag, d, arMat}] — width ∝ thickness, colour by index/role.
function StackBar({ layers, c, height = 26 }) {
    if (!layers || !layers.length) return null;
    const total = layers.reduce((s, l) => s + (l.d || 0), 0) || 1;
    const colorFor = (l) => {
        if (l.tag === 'ar') return l.arMat === 'H' ? '#7e57c2' : '#b39ddb';   // V-coat highlighted (purple)
        if (l.tag === 'spacer') return l.spacerKind === 'H' ? '#37474f' : '#90a4ae';
        if (l.tag === 'H') return '#455a64';   // high index = dark gray
        return '#cfd8dc';                       // low index = light gray
    };
    return h('div', {
        style: { display: 'flex', width: '100%', height, border: `1px solid ${c.border}`, borderRadius: 3, overflow: 'hidden' },
    }, layers.map((l, i) => h('div', {
        key: i,
        title: `${l.tag}${l.order ? ` order ${l.order}` : ''}  ${(l.d || 0).toFixed(1)} nm`,
        style: { width: `${100 * (l.d || 0) / total}%`, backgroundColor: colorFor(l), borderRight: i < layers.length - 1 ? '0.5px solid rgba(255,255,255,0.15)' : 'none' },
    })));
}

// ── Step 1: Materials ─────────────────────────────────────────────────────────
function StepMaterials({ p, set, c, t }) {
    const T = t.filterDesign;
    const matH = getMaterialById(p.matH), matL = getMaterialById(p.matL);
    const kH = matH?.getNK ? matH.getNK(p.lambda0_nm)[1] : 0;
    const kL = matL?.getNK ? matL.getNK(p.lambda0_nm)[1] : 0;
    const lossy = (kH > 1e-5) || (kL > 1e-5);
    const subMat = getMaterialById(p.substrateMaterial);
    const nSub = subMat?.getNK ? subMat.getNK(p.lambda0_nm)[0] : null;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(StepHeader, { step: 1, title: T.step1.title, c }),
        h('div', { style: { fontSize: 12, color: c.textDim, display: 'flex', gap: 20 } },
            h('span', {}, `${T.step1.substrate}: ${nSub ? `n=${nSub.toFixed(3)}` : '—'}`),
            h('span', {}, `${T.step1.incident}: ${p.incidentMedium.split(':').pop()}`)),
        h('p', { style: { margin: 0, fontSize: 12, color: c.textDim } }, T.step1.intro),
        h('div', { style: { display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center', maxWidth: 480 } },
            h('label', { style: { fontSize: 12, color: c.textDim } }, `${T.step1.matH} (H)`),
            h(MaterialPicker, { value: p.matH, onChange: (v) => set('matH', v), c, t }),
            h('label', { style: { fontSize: 12, color: c.textDim } }, `${T.step1.matL} (L)`),
            h(MaterialPicker, { value: p.matL, onChange: (v) => set('matL', v), c, t }),
            h('label', { style: { fontSize: 12, color: c.textDim } }, T.step1.substrate),
            h(MaterialPicker, { value: p.substrateMaterial, onChange: (v) => set('substrateMaterial', v), c, t }),
            h('label', { style: { fontSize: 12, color: c.textDim } }, T.step1.incident),
            h(MaterialPicker, { value: p.incidentMedium, onChange: (v) => set('incidentMedium', v), c, t })),
        h('div', { style: { display: 'flex', gap: 16, alignItems: 'flex-end', marginTop: 4 } },
            h(CheckField, { label: T.step1.oblique, value: p.oblique, c, onChange: (v) => set('oblique', v) }),
            p.oblique && h(NumField, { label: T.step1.angle, value: p.aoi, min: 0, max: 89, step: 0.5, suffix: '°', c, width: 80, onChange: (v) => set('aoi', v) }),
            p.oblique && h('label', { style: fieldLabel(c) }, h('span', {}, T.step1.pol),
                h('select', { value: p.pol, onChange: (e) => set('pol', e.target.value), style: inputStyle(c, 90) },
                    [['avg', 'avg'], ['s', 's'], ['p', 'p']].map(([v, l]) => h('option', { key: v, value: v }, l))))),
        lossy && h('div', { style: { marginTop: 4, padding: '8px 12px', borderRadius: 4, backgroundColor: 'rgba(239,152,0,0.15)', border: `1px solid ${c.warning || '#ef9800'}`, fontSize: 12, color: c.text } },
            T.step1.lossyWarn));
}

// ── Step 2: Filter parameters ─────────────────────────────────────────────────
function StepParams({ p, set, c, t }) {
    const T = t.filterDesign;
    const sf = shapeFactor(p);
    // The step-2 preview is the IDEAL TARGET schematic (a smooth bell
    // through the two spec points), NOT a real multilayer response.
    const curve = useMemo(() => idealFilterCurve({
        lambda0_nm: p.lambda0_nm, halfPass: p.passHalf_nm, halfStop: p.stopHalf_nm,
        passLevel: p.passLevel / 100, stopLevel: p.stopLevel / 100,
    }), [p.lambda0_nm, p.passHalf_nm, p.stopHalf_nm, p.passLevel, p.stopLevel]);
    const analyticT = useCallback((lam) => curve(lam), [curve]);
    const levelLines = [
        { y: p.passLevel, color: '#43a047', x0: p.lambda0_nm - p.passHalf_nm, x1: p.lambda0_nm + p.passHalf_nm },
        { y: p.stopLevel, color: '#e53935', x0: p.lambda0_nm - p.stopHalf_nm, x1: p.lambda0_nm + p.stopHalf_nm },
    ];
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(StepHeader, { step: 2, title: T.step2.title, c }),
        h('div', { style: { display: 'flex', gap: 18 } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 200 } },
                h(NumField, { label: T.step2.lambda0, value: p.lambda0_nm, min: 100, max: 5000, step: 0.1, suffix: 'nm', c, onChange: (v) => set('lambda0_nm', v) }),
                h(NumField, { label: `Δλ @ T=${p.passLevel}%`, value: p.passHalf_nm, min: 0.05, max: 250, step: 0.05, suffix: 'nm', c, onChange: (v) => set('passHalf_nm', v) }),
                h(NumField, { label: `Δλ @ T=${p.stopLevel}%`, value: p.stopHalf_nm, min: 0.05, max: 1000, step: 0.05, suffix: 'nm', c, onChange: (v) => set('stopHalf_nm', v) }),
                h(NumField, { label: T.step2.shapeFactor, value: sf, min: 1, max: 50, step: 0.1, c, onChange: (v) => { if (v > 0) set('stopHalf_nm', +(p.passHalf_nm * v).toFixed(4)); } }),
                h('div', { style: { display: 'flex', gap: 10 } },
                    h(NumField, { label: T.step2.passLevel, value: p.passLevel, min: 1, max: 99.9, step: 0.01, suffix: '%', c, width: 80, onChange: (v) => set('passLevel', v) }),
                    h(NumField, { label: T.step2.stopLevel, value: p.stopLevel, min: 0.001, max: 50, step: 0.01, suffix: '%', c, width: 80, onChange: (v) => set('stopLevel', v) }))),
            h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' } },
                h('div', { style: { fontSize: 11, color: c.textDim, marginBottom: 2 } }, T.step2.previewHint),
                h(SpectrumPlot, { analyticT, p, c, height: 300, levelLines }))));
}

// ── Step 3: Number of cavities ────────────────────────────────────────────────
function StepCavities({ p, set, c, t }) {
    const T = t.filterDesign;
    const sf = shapeFactor(p);
    const rec = recommendCavities({ shapeFactor: sf, Tpass: p.passLevel / 100, Tstop: p.stopLevel / 100 });
    const N = p.cavities ?? rec.recommended;
    useEffect(() => { if (p.cavities == null) set('cavities', rec.recommended); }, []); // eslint-disable-line
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h(StepHeader, { step: 3, title: T.step3.title, c }),
        h('p', { style: { margin: 0, fontSize: 13, color: c.text } }, T.step3.recommend(Math.max(1, rec.recommended - 1))),
        h(IntField, { label: T.step3.cavities, value: N, min: 1, max: 10, c, onChange: (v) => set('cavities', v) }),
        h('p', { style: { margin: 0, fontSize: 11, color: c.textDim } }, T.step3.hint(sf.toFixed(2), rec.q.toFixed(2))));
}

// ── Step 4: Prototype family ──────────────────────────────────────────────────
function StepPrototype({ p, set, c, t }) {
    const T = t.filterDesign;
    const sf = shapeFactor(p);
    const N = p.cavities ?? recommendCavities({ shapeFactor: sf, Tpass: p.passLevel / 100, Tstop: p.stopLevel / 100 }).recommended;
    const eff = p.spacerKind === 'H' ? 'H' : 'L';   // 'any' previews as L (search tries both)
    const fam = useMemo(() => {
        try {
            const nH = materialIndexFn(p.matH, getMaterialById), nL = materialIndexFn(p.matL, getMaterialById), nSub = materialIndexFn(p.substrateMaterial, getMaterialById);
            // target passband full width (the equivalence is at this width)
            return buildPrototypeFamily({ nH, nL, nSub, lambda0_nm: p.lambda0_nm, spacerKind: eff, cavities: N, targetFWHM: 2 * p.passHalf_nm });
        } catch (e) { return []; }
    }, [p.matH, p.matL, p.substrateMaterial, p.lambda0_nm, eff, N, p.passHalf_nm]);

    // Reset the (m,k) pick to the recommended Thelen row (m largest, k=1 — bottom
    // row) whenever the FAMILY changes: new materials / λ₀ / passband
    // width / cavity count / spacer kind, and on first open. Keyed on a family
    // SIGNATURE (not fam.length, which doesn't change between two same-size
    // families) so a stale (m,k) from a PREVIOUSLY generated filter never lingers
    // in the step-4 preview. A manual m/k pick within the SAME family is preserved
    // (famKey unchanged → effect doesn't refire).
    const famKey = `${p.matH}|${p.matL}|${p.substrateMaterial}|${p.lambda0_nm}|${eff}|${N}|${p.passHalf_nm}`;
    useEffect(() => {
        if (fam.length) { set('seedMirror', fam[0].notationM); set('seedSpacer', fam[0].spacerOrder); }
    }, [famKey]); // eslint-disable-line

    // p.seedMirror holds the mirror order m (display); the BUILT outer mirror is
    // oddUp(m) and the prototype is a coupled-cavity stack (inner mirrors 2× outer).
    const mSel = p.seedMirror || 8, s = p.seedSpacer || 1;
    const d = couplingD(p);
    const layersFn = useCallback(() => {
        const nH = materialIndexFn(p.matH, getMaterialById), nL = materialIndexFn(p.matL, getMaterialById);
        return buildPrototypeLayers({ nH, nL, lambda0_nm: p.lambda0_nm, mirrors: coupledMirrors(N, mSel, d), spacers: new Array(N).fill(s), spacerKind: eff });
    }, [p.matH, p.matL, p.lambda0_nm, eff, mSel, s, N, d]);
    const stackLayers = useMemo(() => { try { return layersFn(); } catch { return []; } }, [layersFn]);
    const nLayers = stackLayers.length;
    const thNm = stackLayers.reduce((a, l) => a + l.d, 0);

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(StepHeader, { step: 4, title: T.step4.title, c }),
        h('div', { style: { display: 'flex', gap: 16 } },
            // left: table + m/k fields + spacer material
            h('div', { style: { width: 250 } },
                h('div', { style: { fontSize: 12, fontWeight: 600, color: c.text, marginBottom: 6 } }, T.step4.tableHeader),
                h('div', { style: { maxHeight: 200, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
                    h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12, color: c.text } },
                        h('thead', {}, h('tr', { style: { backgroundColor: c.hover, position: 'sticky', top: 0 } },
                            ['m', 'k', T.step4.colWidth].map((col, i) => h('th', { key: i, style: { textAlign: 'left', padding: '5px 10px', borderBottom: `1px solid ${c.border}`, fontWeight: 600 } }, col)))),
                        h('tbody', {}, fam.map((r, i) => {
                            const sel = r.notationM === mSel && r.spacerOrder === s;
                            return h('tr', { key: i, onClick: () => { set('seedMirror', r.notationM); set('seedSpacer', r.spacerOrder); },
                                style: { cursor: 'pointer', backgroundColor: sel ? c.accent + '33' : 'transparent' } },
                                h('td', { style: { padding: '4px 10px' } }, r.notationM),
                                h('td', { style: { padding: '4px 10px' } }, r.spacerOrder),
                                h('td', { style: { padding: '4px 10px', color: c.textDim } }, r.width ? r.width.toFixed(2) + ' nm' : '—')); })))),
                // m / k direct input fields (step-4 controls)
                h('div', { style: { display: 'flex', gap: 10, marginTop: 10 } },
                    h(IntField, { label: T.step4.extMirror, value: mSel, min: 1, max: 40, c, onChange: (v) => set('seedMirror', Math.max(1, v)) }),
                    h(IntField, { label: T.step4.spacerOrder, value: s, min: 1, max: 200, c, onChange: (v) => set('seedSpacer', Math.max(1, v)) })),
                h('div', { style: { marginTop: 10, fontSize: 12, color: c.textDim } }, T.step4.spacerMat),
                h('div', { style: { display: 'flex', gap: 12, marginTop: 4 } },
                    [['any', T.step4.spacerAny], ['H', 'H'], ['L', 'L']].map(([v, l]) => h('label', { key: v, style: { display: 'flex', gap: 5, alignItems: 'center', fontSize: 12, color: c.text, cursor: 'pointer' } },
                        h('input', { type: 'radio', checked: p.spacerKind === v, onChange: () => set('spacerKind', v) }), l)))),
            // right: preview + stack bar
            h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' } },
                h(SpectrumPlot, { layersFn, p, mode: 'embedded', c, height: 240 }),
                h(StackBar, { layers: stackLayers, c, height: 24 }),
                h('div', { style: { fontSize: 12, color: c.textDim, marginTop: 4 } }, `N = ${nLayers}    Th = ${thNm.toFixed(1)} nm    (embedded preview)`))));
}

// ── Step 5: Global Integer Search ─────────────────────────────────────────────
function StepSearch({ p, set, c, t }) {
    const T = t.filterDesign;
    const sf = shapeFactor(p);
    const N = p.cavities ?? recommendCavities({ shapeFactor: sf, Tpass: p.passLevel / 100, Tstop: p.stopLevel / 100 }).recommended;
    const [running, setRunning] = useState(false);
    const [candidates, setCandidates] = useState([]);
    const [status, setStatus] = useState('');
    const workerRef = useRef(null);

    const stop = useCallback(() => {
        if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
        setRunning(false);
    }, []);
    useEffect(() => () => stop(), [stop]); // cleanup on unmount

    // The coupled seed prototype (the step-4 design) — also the search seed.
    const seedMirrorsVec = useMemo(() => coupledMirrors(N, p.seedMirror || 8, couplingD(p)),
        [N, p.seedMirror, p.matH, p.matL, p.substrateMaterial, p.lambda0_nm]); // eslint-disable-line
    const seedSpacerVal = p.seedSpacer || 1;
    // Signature of every design-defining input. When it changes, drop stale
    // candidates + selection so step 5 never shows a plot from a PREVIOUS filter.
    const seedKey = `${N}|${seedMirrorsVec.join(',')}|${seedSpacerVal}|${p.spacerKind}|${p.matH}|${p.matL}|${p.substrateMaterial}|${p.lambda0_nm}|${p.passHalf_nm}|${p.stopHalf_nm}`;
    useEffect(() => {
        stop();
        setCandidates([]); setStatus('');
        if (p.selected != null) set('selected', null);
    }, [seedKey]); // eslint-disable-line

    const start = useCallback(() => {
        stop();
        setCandidates([]); setStatus(T.step5.running); setRunning(true);
        if (p.selected != null) set('selected', null);   // fresh run clears stale pick
        let worker;
        try { worker = new Worker(WORKER_URL, { type: 'module' }); }
        catch (e) { setStatus('Worker failed: ' + e.message); setRunning(false); return; }
        workerRef.current = worker;
        const win = Math.max(p.stopHalf_nm * 3, p.stopHalf_nm + 6 * p.passHalf_nm);
        const tables = presampleForSearch({ matH: p.matH, matL: p.matL, substrateMaterial: p.substrateMaterial, lamLo: p.lambda0_nm - win, lamHi: p.lambda0_nm + win, step: 0.05 });
        worker.onmessage = (e) => {
            const m = e.data;
            if (m.type === 'tick') { setCandidates(m.candidates); setStatus(T.step5.found(m.candidates.length)); }
            else if (m.type === 'result') { setCandidates(m.candidates); setStatus(T.step5.done(m.candidates.length)); setRunning(false); if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; } if (m.candidates[0]) set('selected', m.candidates[0]); }
            else if (m.type === 'error') { setStatus('Error: ' + m.message); setRunning(false); }
        };
        worker.onerror = (ev) => { setStatus('Error: ' + (ev.message || 'worker')); setRunning(false); };
        worker.postMessage({
            lambda0: p.lambda0_nm,
            targetParams: { lambda0_nm: p.lambda0_nm, halfPass: p.passHalf_nm, halfStop: p.stopHalf_nm },
            tables,
            search: {
                cavities: N,
                // seed the search from the coupled-cavity prototype (Thelen Eq. 10
                // inner mirrors) — a good flat-top start, not a uniform stack.
                seedMirrors: seedMirrorsVec,
                seedMirror: oddUp(p.seedMirror || 8), seedSpacer: seedSpacerVal,
                spacerKind: p.spacerKind === 'H' ? 'H' : 'L',
                symMirrors: p.symMirrors, symCavities: p.symCavities, restarts: p.restarts,
            },
        });
    }, [p, N, stop, set, T]);

    const selKey = p.selected ? p.selected.mirrors.join(',') + '|' + p.selected.spacers.join(',') : null;
    // Preview the selected candidate; before any search, show the SEED prototype
    // (the step-4 design) — never a stale plot from a previous filter.
    const selLayersFn = useCallback(() => {
        const nH = materialIndexFn(p.matH, getMaterialById), nL = materialIndexFn(p.matL, getMaterialById);
        const mirrors = p.selected ? p.selected.mirrors : seedMirrorsVec;
        const spacers = p.selected ? p.selected.spacers : new Array(N).fill(seedSpacerVal);
        return buildPrototypeLayers({ nH, nL, lambda0_nm: p.lambda0_nm, mirrors, spacers, spacerKind: p.spacerKind === 'H' ? 'H' : 'L' });
    }, [p.selected, seedMirrorsVec, seedSpacerVal, N, p.matH, p.matL, p.lambda0_nm, p.spacerKind]);

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(StepHeader, { step: 5, title: T.step5.title, c }),
        h('div', { style: { display: 'flex', gap: 16 } },
            // left controls
            h('div', { style: { width: 210, display: 'flex', flexDirection: 'column', gap: 10 } },
                h('button', { onClick: running ? stop : start,
                    style: { padding: '10px', fontSize: 14, fontWeight: 600, backgroundColor: running ? (c.warning || '#ef6c00') : c.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' } },
                    running ? T.step5.stop : T.step5.start),
                h('div', { style: { fontSize: 11, color: c.textDim, minHeight: 16 } }, status),
                h(CheckField, { label: T.step5.symMirrors, value: p.symMirrors, c, onChange: (v) => set('symMirrors', v) }),
                h(CheckField, { label: T.step5.symCavities, value: p.symCavities, c, onChange: (v) => set('symCavities', v) }),
                h(IntField, { label: T.step5.restarts, value: p.restarts, min: 1, max: 60, c, onChange: (v) => set('restarts', v) })),
            // candidate table
            h('div', { style: { width: 250 } },
                h('div', { style: { maxHeight: 260, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
                    h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5, color: c.text } },
                        h('thead', {}, h('tr', { style: { backgroundColor: c.hover, position: 'sticky', top: 0 } },
                            ['MF', 'N', 'Th'].map((col, i) => h('th', { key: i, style: { textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${c.border}`, fontWeight: 600 } }, col)))),
                        h('tbody', {}, candidates.map((cd, i) => {
                            const key = cd.mirrors.join(',') + '|' + cd.spacers.join(',');
                            const sel = key === selKey;
                            return h('tr', { key: i, onClick: () => set('selected', cd), style: { cursor: 'pointer', backgroundColor: sel ? c.accent + '33' : 'transparent' } },
                                h('td', { style: { padding: '3px 8px' } }, cd.mf.toFixed(5),
                                    cd.isSeed && h('span', { style: { marginLeft: 5, fontSize: 9.5, color: c.accent, fontWeight: 600 } }, T.step5.seedTag || 'seed')),
                                h('td', { style: { padding: '3px 8px', color: c.textDim } }, cd.layers),
                                h('td', { style: { padding: '3px 8px', color: c.textDim } }, cd.thicknessNm.toFixed(0)));
                        })))),
                !candidates.length && h('div', { style: { fontSize: 11, color: c.textDim, marginTop: 6 } }, T.step5.empty)),
            // preview
            h('div', { style: { flex: 1 } },
                h(SpectrumPlot, { layersFn: selLayersFn, p, mode: 'embedded', c, height: 260 }),
                p.selected && h('div', { style: { fontSize: 11.5, color: c.textDim, marginTop: 4 } },
                    `[${p.selected.mirrors.join(' ')}] / [${p.selected.spacers.join(' ')}]  MF=${p.selected.mf.toFixed(5)}  N=${p.selected.layers}`))));
}

// ── Step 6: Adjust to incident medium ─────────────────────────────────────────
function StepAdjust({ p, set, c, t }) {
    const T = t.filterDesign;
    const layersFn = useCallback(() => {
        if (!p.selected) return [];
        try {
            const design = buildFilterDesignObject({
                name: p.name, matH: p.matH, matL: p.matL, substrateMaterial: p.substrateMaterial,
                incidentMedium: p.incidentMedium, exitMedium: p.exitMedium, lambda0_nm: p.lambda0_nm,
                candidate: p.selected, spacerKind: p.spacerKind, arMode: p.arMode,
                halfPass: p.passHalf_nm, halfStop: p.stopHalf_nm, aoi: p.aoi, pol: p.pol,
            });
            // map frontLayers back to engine-style for the air plot
            return design.frontLayers.map(l => ({ nk: materialIndexFn(l.material, getMaterialById), d: l.thickness }));
        } catch (e) { return []; }
    }, [p.selected, p.arMode, p.matH, p.matL, p.substrateMaterial, p.incidentMedium, p.lambda0_nm, p.spacerKind]);
    const nLayers = useMemo(() => { try { return layersFn().length; } catch { return 0; } }, [layersFn]);

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(StepHeader, { step: 6, title: T.step6.title, c }),
        !p.selected && h('div', { style: { fontSize: 12, color: c.warning || '#ef9800' } }, T.step6.noSelection),
        h('div', { style: { display: 'flex', gap: 16 } },
            h('div', { style: { width: 200, display: 'flex', flexDirection: 'column', gap: 8 } },
                h('div', { style: { fontSize: 12, fontWeight: 600, color: c.text } }, T.step6.arHeader),
                [['none', T.step6.arNone], ['1layer', T.step6.ar1], ['vcoat', T.step6.arV]].map(([v, l]) =>
                    h('label', { key: v, style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: c.text, cursor: 'pointer' } },
                        h('input', { type: 'radio', checked: p.arMode === v, onChange: () => set('arMode', v) }), l)),
                h('label', { style: fieldLabel(c) }, h('span', {}, T.step6.name),
                    h('input', { type: 'text', value: p.name, onChange: (e) => set('name', e.target.value), style: inputStyle(c, '100%') }))),
            h('div', { style: { flex: 1 } },
                h(SpectrumPlot, { layersFn, p, mode: 'air', c, height: 280 }),
                h('div', { style: { fontSize: 12, color: c.textDim, marginTop: 4 } }, `N = ${nLayers}  (final, in ${p.incidentMedium.split(':').pop()})`))));
}

// ── Wizard shell ──────────────────────────────────────────────────────────────
export function FilterDesignWizard({ onClose, onGenerate, folderName, c, t }) {
    const T = t.filterDesign;
    const [p, setParams] = useState(() => ({ ...DEFAULTS }));
    const [step, setStep] = useState(1);
    const set = useCallback((key, value) => setParams(prev => ({ ...prev, [key]: value })), []);

    useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onClose]);

    const matH = getMaterialById(p.matH), matL = getMaterialById(p.matL);
    const lossless = !((matH?.getNK ? matH.getNK(p.lambda0_nm)[1] : 0) > 1e-5 || (matL?.getNK ? matL.getNK(p.lambda0_nm)[1] : 0) > 1e-5);
    const canFinish = !!folderName && p.selected != null;

    const finish = useCallback(() => {
        if (!canFinish) return;
        try {
            const design = buildFilterDesignObject({
                name: p.name, matH: p.matH, matL: p.matL, substrateMaterial: p.substrateMaterial,
                substrateThicknessMm: p.substrateThicknessMm, incidentMedium: p.incidentMedium, exitMedium: p.exitMedium,
                lambda0_nm: p.lambda0_nm, candidate: p.selected, spacerKind: p.spacerKind, arMode: p.arMode,
                halfPass: p.passHalf_nm, halfStop: p.stopHalf_nm, aoi: p.aoi, pol: p.pol,
            });
            onGenerate(design); onClose();
        } catch (err) { alert(T.generateError(err.message)); } // eslint-disable-line no-alert
    }, [p, canFinish, onGenerate, onClose, T]);

    const body =
        step === 1 ? h(StepMaterials, { p, set, c, t }) :
        step === 2 ? h(StepParams, { p, set, c, t }) :
        step === 3 ? h(StepCavities, { p, set, c, t }) :
        step === 4 ? h(StepPrototype, { p, set, c, t }) :
        step === 5 ? h(StepSearch, { p, set, c, t }) :
                     h(StepAdjust, { p, set, c, t });

    const nextDisabled = (step === 1 && !lossless);

    return h('div', { style: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } },
        h('div', { style: { backgroundColor: c.panel, borderRadius: 8, padding: 22, width: 860, maxWidth: '96vw', maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.4)', border: `1px solid ${c.border}` } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
                h('h2', { style: { margin: 0, fontSize: 17, fontWeight: 700, color: c.text } }, T.title),
                h('button', { onClick: onClose, style: { background: 'transparent', color: c.textDim, border: 'none', cursor: 'pointer', fontSize: 18 } }, '×')),
            h('div', { style: { flex: 1, overflowY: 'auto', minHeight: 400 } }, body),
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${c.border}`, marginTop: 12 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
                    h('button', { onClick: () => window.electronAPI?.openHelp?.({ anchor: 'synthesis/wdm-wizard', locale: getCurrentLocale() }), title: T.help,
                        style: { padding: '8px 16px', fontSize: 13, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' } }, T.help),
                    h('div', { style: { display: 'flex', gap: 6 } }, [1, 2, 3, 4, 5, 6].map(s => h('div', { key: s, style: { width: 8, height: 8, borderRadius: '50%', backgroundColor: s === step ? c.accent : s < step ? c.accent + '88' : c.border } })))),
                !folderName && h('span', { style: { fontSize: 11, color: c.warning || '#ef9800' } }, T.noFolder),
                h('div', { style: { display: 'flex', gap: 8 } },
                    h('button', { onClick: () => setStep(s => Math.max(1, s - 1)), disabled: step === 1, style: { padding: '8px 16px', fontSize: 13, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: step === 1 ? 'default' : 'pointer', opacity: step === 1 ? 0.4 : 1 } }, T.back),
                    step < 6 && h('button', { onClick: () => setStep(s => Math.min(6, s + 1)), disabled: nextDisabled, style: { padding: '8px 20px', fontSize: 13, fontWeight: 600, backgroundColor: nextDisabled ? c.border : c.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: nextDisabled ? 'not-allowed' : 'pointer' } }, T.next),
                    step === 6 && h('button', { onClick: finish, disabled: !canFinish, style: { padding: '8px 22px', fontSize: 13, fontWeight: 600, backgroundColor: canFinish ? c.accent : c.border, color: '#fff', border: 'none', borderRadius: 4, cursor: canFinish ? 'pointer' : 'not-allowed' } }, T.finish)))));
}
