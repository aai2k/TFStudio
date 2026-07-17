import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { materialIndexFn } from '../../../../utils/filter/filterDesign.js';
import { buildFilterDesignObject } from '../../../../utils/filter/filterDesignBuild.js';
import { safeCall } from './model.js';
import { StepHeader, fieldLabel, inputStyle } from './ui.js';
import { SpectrumPlot } from './SpectrumPlot.js';

const { createElement: h, useMemo, useCallback } = React;

function buildAdjustLayers(p) {
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
}

// ── Step 6: Adjust to incident medium ─────────────────────────────────────────
export function StepAdjust({ p, set, c, t }) {
    const T = t.filterDesign;
    const layersFn = useCallback(() => buildAdjustLayers(p),
        [p.selected, p.arMode, p.matH, p.matL, p.substrateMaterial, p.incidentMedium, p.lambda0_nm, p.spacerKind]);
    const nLayers = useMemo(() => safeCall(() => layersFn().length, 0), [layersFn]);

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
