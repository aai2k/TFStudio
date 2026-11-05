import { defaultAxisRange } from '../../../../utils/physics/plotQuantities.js';
import { FieldLabel, NumInput, RangeField, SelectField } from '../chrome/controls.js';
import { SettingRow } from '../chrome/popover.js';
import { axisOptionLabel } from './quantityLabels.js';

const { createElement: h } = React;

function axisValues(spec, which) {
    if (which === 'x') {
        return { variable: spec.xVar, from: spec.xFrom, to: spec.xTo, steps: spec.xSteps };
    }
    return { variable: spec.yVar, from: spec.yFrom, to: spec.yTo, steps: spec.ySteps };
}

function variablePatch(which, token, range) {
    return which === 'x'
        ? { xVar: token, xFrom: range.from, xTo: range.to }
        : { yVar: token, yFrom: range.from, yTo: range.to };
}

function rangePatch(which, values, patch) {
    return which === 'x'
        ? { xFrom: patch.from ?? values.from, xTo: patch.to ?? values.to, xSteps: patch.steps ?? values.steps }
        : { yFrom: patch.from ?? values.from, yTo: patch.to ?? values.to, ySteps: patch.steps ?? values.steps };
}

function compactInputNumber(value) {
    return Number.isFinite(value) ? Number(value.toFixed(4)) : value;
}

/**
 * One axis of the surface: what it sweeps, and over what. A layer stands for
 * its thickness, so a hundred-layer stack is a hundred entries.
 */
export function SurfaceAxisGroup({ which, spec, design, onUpdate, targetOptions, selectWidth, c, t }) {
    const pe = t.plotEngine;
    const values = axisValues(spec, which);

    const setVariable = (token) => {
        onUpdate(variablePatch(which, token, defaultAxisRange(design, token)));
    };
    const setRange = (patch) => onUpdate(rangePatch(which, values, patch));

    return h('div', null,
        h(SettingRow, { c, label: which === 'x' ? (pe.xAxisVar || 'X axis') : (pe.yAxisVar || 'Y axis') },
            h(SelectField, {
                c, width: selectWidth, value: values.variable,
                onChange: setVariable,
                options: targetOptions.map(option => ({
                    id: option.value, label: axisOptionLabel(option, t),
                })),
            }),
        ),
        h(SettingRow, { c, label: pe.range || 'Range' },
            h(RangeField, {
                c, width: 58,
                from: {
                    value: compactInputNumber(values.from),
                    onChange: value => setRange({ from: value }),
                },
                to: {
                    value: compactInputNumber(values.to),
                    onChange: value => setRange({ to: value }),
                },
            }),
            h(FieldLabel, { c }, pe.steps || 'steps'),
            h(NumInput, {
                c, width: 52, value: values.steps, min: 2,
                // A grid axis is sampled a whole number of times.
                onChange: value => setRange({ steps: Math.round(value) }),
            }),
        ),
    );
}
