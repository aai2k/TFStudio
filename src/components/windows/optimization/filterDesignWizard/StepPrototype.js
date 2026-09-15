import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import {
    materialIndexFn, buildPrototypeLayers, buildPrototypeFamily,
    recommendCavities, coupledMirrors, MIRROR_BOUNDS, ORDER_BOUNDS,
} from '../../../../utils/filter/filterDesign.js';
import { couplingD, prototypeCandidate, safeCall, shapeFactor, targetPointsOf } from './model.js';
import { AxisToggle, IntField, StepHeader } from './ui.js';
import { SpectrumPlot } from './SpectrumPlot.js';
import { StackBar } from './StackBar.js';

const { createElement: h, useMemo, useCallback, useEffect } = React;

// (m,k) equivalent-mirror family for the current passband width — the
// prototype table populating step 4. One table, computed once; the spacer-
// material radio only chooses which of its rows are offered.
function computePrototypeFamily({ p, N }) {
    try {
        const nH = materialIndexFn(p.matH, getMaterialById), nL = materialIndexFn(p.matL, getMaterialById), nSub = materialIndexFn(p.substrateMaterial, getMaterialById);
        return buildPrototypeFamily({
            nH, nL, nSub, lambda0_nm: p.lambda0_nm, cavities: N,
            targetFWHM: 2 * p.passHalf_nm, passLevel: p.passLevel / 100,
        });
    } catch (e) { return []; }
}

// An odd m leaves the spacers on L, an even m on H, because the spacer sits one
// position past the outer mirror and materials follow position parity. A table
// short enough to hold only one parity is offered whole rather than empty,
// since an empty table gives the user nothing to pick and no way to tell why.
function rowsForFilter(fam, spacerFilter) {
    const wanted = spacerFilter === 'H' ? 0 : spacerFilter === 'L' ? 1 : null;
    if (wanted === null) return fam;
    const kept = fam.filter(r => r.notationM % 2 === wanted);
    return kept.length ? kept : fam;
}

// Typed m and k are held to the range the integer search can carry, so the
// preview can never show a prototype the search would quietly clamp away.
const clampTo = ({ min, max }, v) => Math.max(min, Math.min(max, v));

function buildPrototypeStackLayers({ p, mSel, s, N, d }) {
    const nH = materialIndexFn(p.matH, getMaterialById), nL = materialIndexFn(p.matL, getMaterialById);
    return buildPrototypeLayers({ nH, nL, lambda0_nm: p.lambda0_nm, mirrors: coupledMirrors(N, mSel, d), spacers: new Array(N).fill(s) });
}

// The (m,k) table: click a row to seed the search with it. A specification no
// prototype in the search's range can meet leaves it empty, which says so
// rather than showing a bare set of column headers.
function renderFamilyTable({ rows, mSel, s, pick, c, T }) {
    if (!rows.length) return h('div', { style: { fontSize: 11.5, color: c.textDim, padding: '8px 0' } }, T.step4.noRows);
    return h('div', { style: { maxHeight: 200, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12, color: c.text } },
            h('thead', {}, h('tr', { style: { backgroundColor: c.hover, position: 'sticky', top: 0 } },
                ['m', 'k'].map((col, i) => h('th', { key: i, style: { textAlign: 'left', padding: '5px 10px', borderBottom: `1px solid ${c.border}`, fontWeight: 600 } }, col)))),
            h('tbody', {}, rows.map((r, i) => {
                const sel = r.notationM === mSel && r.spacerOrder === s;
                return h('tr', { key: i, onClick: () => pick(r.notationM, r.spacerOrder),
                    style: { cursor: 'pointer', backgroundColor: sel ? c.accent + '33' : 'transparent' } },
                    h('td', { style: { padding: '4px 10px' } }, r.notationM),
                    h('td', { style: { padding: '4px 10px' } }, r.spacerOrder));
            }))));
}

// ── Step 4: Prototype family ──────────────────────────────────────────────────
export function StepPrototype({ p, set, c, t }) {
    const T = t.filterDesign;
    const sf = shapeFactor(p);
    const N = p.cavities ?? recommendCavities({ shapeFactor: sf, Tpass: p.passLevel / 100, Tstop: p.stopLevel / 100 }).recommended;
    const fam = useMemo(() => computePrototypeFamily({ p, N }),
        [p.matH, p.matL, p.substrateMaterial, p.lambda0_nm, N, p.passHalf_nm, p.passLevel]);
    const rows = useMemo(() => rowsForFilter(fam, p.spacerFilter), [fam, p.spacerFilter]);

    // Picking a row is what selects the design: from here on the wizard has
    // something to build, so Finish works with or without the integer search.
    const pick = useCallback((m, k) => {
        set('seedMirror', m); set('seedSpacer', k);
        set('selected', prototypeCandidate(p, N, m, k));
    }, [p, N, set]);

    // Reset the (m,k) pick to the strongest-mirror row whenever the FAMILY or
    // the row filter changes: new materials / λ₀ / passband width / cavity
    // count, and on first open. Keyed on a family SIGNATURE (not rows.length,
    // which doesn't change between two same-size families) so a stale (m,k)
    // from a PREVIOUSLY generated filter never lingers in the step-4 preview.
    // A manual m/k pick within the SAME family is preserved.
    const famKey = `${p.matH}|${p.matL}|${p.substrateMaterial}|${p.lambda0_nm}|${N}|${p.passHalf_nm}|${p.passLevel}|${p.spacerFilter}`;
    useEffect(() => {
        if (rows.length) pick(rows[0].notationM, rows[0].spacerOrder);
    }, [famKey]); // eslint-disable-line

    const mSel = p.seedMirror || 8, s = p.seedSpacer || 1;
    const d = couplingD(p);
    const layersFn = useCallback(() => buildPrototypeStackLayers({ p, mSel, s, N, d }),
        [p.matH, p.matL, p.lambda0_nm, mSel, s, N, d]);
    const stackLayers = useMemo(() => safeCall(layersFn, []), [layersFn]);
    const nLayers = stackLayers.length;
    const thNm = stackLayers.reduce((a, l) => a + l.d, 0);
    const targetPoints = useMemo(() => targetPointsOf(p),
        [p.lambda0_nm, p.passHalf_nm, p.stopHalf_nm, p.passLevel]); // eslint-disable-line

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(StepHeader, { step: 4, title: T.step4.title, c }),
        h('div', { style: { display: 'flex', gap: 16 } },
            // left: table + m/k fields + spacer material
            h('div', { style: { width: 250 } },
                h('div', { style: { fontSize: 12, fontWeight: 600, color: c.text, marginBottom: 6 } }, T.step4.tableHeader),
                renderFamilyTable({ rows, mSel, s, pick, c, T }),
                // m / k direct input fields (step-4 controls)
                h('div', { style: { display: 'flex', gap: 10, marginTop: 10 } },
                    h(IntField, { label: T.step4.extMirror, value: mSel, min: MIRROR_BOUNDS.min, max: MIRROR_BOUNDS.max, c,
                        onChange: (v) => pick(clampTo(MIRROR_BOUNDS, v), s) }),
                    h(IntField, { label: T.step4.spacerOrder, value: s, min: ORDER_BOUNDS.min, max: ORDER_BOUNDS.max, c,
                        onChange: (v) => pick(mSel, clampTo(ORDER_BOUNDS, v)) })),
                h('div', { style: { marginTop: 10, fontSize: 12, color: c.textDim } }, T.step4.spacerMat),
                h('div', { style: { display: 'flex', gap: 12, marginTop: 4 } },
                    [['any', T.step4.spacerAny], ['H', 'H'], ['L', 'L']].map(([v, l]) => h('label', { key: v, style: { display: 'flex', gap: 5, alignItems: 'center', fontSize: 12, color: c.text, cursor: 'pointer' } },
                        h('input', { type: 'radio', checked: p.spacerFilter === v, onChange: () => set('spacerFilter', v) }), l)))),
            // right: preview + stack bar
            h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' } },
                h(AxisToggle, { value: p.logAxis, onChange: (v) => set('logAxis', v), c, t }),
                h(SpectrumPlot, { layersFn, p, mode: 'embedded', c, height: 240, logAxis: p.logAxis,
                    targetPoints, lambdaAxis: t.spectralAxis.lambdaShort }),
                h(StackBar, { layers: stackLayers, c, height: 24 }),
                h('div', { style: { fontSize: 12, color: c.textDim, marginTop: 4 } }, `N = ${nLayers}    Th = ${thNm.toFixed(1)} nm    (embedded preview)`))));
}
