import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import {
    materialIndexFn, buildPrototypeLayers, buildPrototypeFamily,
    recommendCavities, coupledMirrors,
} from '../../../../utils/filter/filterDesign.js';
import { couplingD, safeCall, shapeFactor } from './model.js';
import { IntField, StepHeader } from './ui.js';
import { SpectrumPlot } from './SpectrumPlot.js';
import { StackBar } from './StackBar.js';

const { createElement: h, useMemo, useCallback, useEffect } = React;

// (m,k) equivalent-mirror family for the current passband width — the
// prototype table populating step 4.
function computePrototypeFamily({ p, eff, N }) {
    try {
        const nH = materialIndexFn(p.matH, getMaterialById), nL = materialIndexFn(p.matL, getMaterialById), nSub = materialIndexFn(p.substrateMaterial, getMaterialById);
        // target passband full width (the equivalence is at this width)
        return buildPrototypeFamily({ nH, nL, nSub, lambda0_nm: p.lambda0_nm, spacerKind: eff, cavities: N, targetFWHM: 2 * p.passHalf_nm });
    } catch (e) { return []; }
}

// p.seedMirror holds the mirror order m (display); the BUILT outer mirror is
// oddUp(m) and the prototype is a coupled-cavity stack (inner mirrors 2× outer).
function buildPrototypeStackLayers({ p, eff, mSel, s, N, d }) {
    const nH = materialIndexFn(p.matH, getMaterialById), nL = materialIndexFn(p.matL, getMaterialById);
    return buildPrototypeLayers({ nH, nL, lambda0_nm: p.lambda0_nm, mirrors: coupledMirrors(N, mSel, d), spacers: new Array(N).fill(s), spacerKind: eff });
}

// ── Step 4: Prototype family ──────────────────────────────────────────────────
export function StepPrototype({ p, set, c, t }) {
    const T = t.filterDesign;
    const sf = shapeFactor(p);
    const N = p.cavities ?? recommendCavities({ shapeFactor: sf, Tpass: p.passLevel / 100, Tstop: p.stopLevel / 100 }).recommended;
    const eff = p.spacerKind === 'H' ? 'H' : 'L';   // 'any' previews as L (search tries both)
    const fam = useMemo(() => computePrototypeFamily({ p, eff, N }),
        [p.matH, p.matL, p.substrateMaterial, p.lambda0_nm, eff, N, p.passHalf_nm]);

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

    const mSel = p.seedMirror || 8, s = p.seedSpacer || 1;
    const d = couplingD(p);
    const layersFn = useCallback(() => buildPrototypeStackLayers({ p, eff, mSel, s, N, d }),
        [p.matH, p.matL, p.lambda0_nm, eff, mSel, s, N, d]);
    const stackLayers = useMemo(() => safeCall(layersFn, []), [layersFn]);
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
