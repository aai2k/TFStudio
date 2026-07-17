import { SliderRow } from './SliderRow.js';
import { resolveMat, matLabel } from './model.js';
import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { thicknessRangeNm } from '../../../../utils/misc/variator.js';

const { createElement: h } = React;

// One slider row per layer, labelled with side prefix (F/B), material name,
// and baseline thickness. Values are baseline-relative deltas keyed by layer id.
export function LayerSliderList({ layers, side, baseById, dThk, onChange, c, v }) {
    return layers.map((l, idx) => {
        const base = baseById.get(l.id) ?? l.thickness;
        const range = thicknessRangeNm(base);
        const mat = resolveMat(l.material);
        const value = dThk[l.id] || 0;
        const prefix = side === 'front' ? 'F' : 'B';
        return h(SliderRow, {
            key: l.id,
            label: `${prefix}${idx + 1} ${matLabel(mat)} (${base.toFixed(1)} nm)`,
            value, min: range.min, max: range.max, step: 0.1,
            unit: 'nm', color: mat ? resolveColor(mat) : undefined, c,
            onChange: (val) => onChange(l.id, val),
            displayPrecision: 2,
            resetTip: v.resetRow,
        });
    });
}
