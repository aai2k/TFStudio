import { SliderRow } from './SliderRow.js';
import { resolveMat, matLabel } from './model.js';
import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { thicknessRangeNm } from '../../../../utils/misc/variator.js';
import { displayLayerLabel } from '../../analysis/layerSensitivity/viewModel.js';

const { createElement: h } = React;

// One slider row per layer, labelled with side prefix (F/B) and the number the
// Design Editor gives the layer, material name, and baseline thickness. Values
// are baseline-relative deltas keyed by layer id.
export function LayerSliderList({ design, layers, side, baseById, dThk, onChange, c, v, units }) {
    const frontCount = design.frontLayers?.length || 0;
    return layers.map((l, idx) => {
        const base = baseById.get(l.id) ?? l.thickness;
        const range = thicknessRangeNm(base);
        const mat = resolveMat(design, l.material);
        const value = dThk[l.id] || 0;
        return h(SliderRow, {
            key: l.id,
            label: `${displayLayerLabel({ side, layerIndex: idx }, frontCount)} ${matLabel(mat)} (${base.toFixed(1)} ${units.nm})`,
            value, min: range.min, max: range.max, step: 0.1,
            unit: units.nm, color: mat ? resolveColor(mat) : undefined, c,
            onChange: (val) => onChange(l.id, val),
            displayPrecision: 2,
            resetTip: v.resetRow,
        });
    });
}
