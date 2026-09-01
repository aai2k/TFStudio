import {
    AXIS_PROPS, MAX_AXIS_STEPS, axisTarget, axisProp, composeAxisVar, defaultAxisRange,
} from '../../../../utils/physics/plotQuantities.js';
import { FieldLabel, NumInput, RangeField, SelectField } from '../chrome/controls.js';
import { SettingRow } from '../chrome/popover.js';

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

function targetLabel(option, pe) {
    if (option.value === 'wavelength') return pe.varWavelength || option.label;
    if (option.value === 'aoi') return pe.varAOI || option.label;
    return option.label;
}

function propertyLabel(option, pe) {
    if (option.value === 'thk') return pe.propThickness || option.label;
    if (option.value === 'n') return pe.propN || option.label;
    return pe.propK || option.label;
}

function compactInputNumber(value) {
    return Number.isFinite(value) ? Number(value.toFixed(4)) : value;
}

/**
 * One axis of the surface: what it sweeps, and over what.
 *
 * The variable is picked in two steps, layer first, so a hundred-layer stack
 * stays one dropdown rather than three hundred entries. The property row is
 * only shown for a layer, since wavelength and angle have nothing to choose.
 */
export function SurfaceAxisGroup({ which, spec, design, onUpdate, targetOptions, selectWidth, c, pe }) {
    const values = axisValues(spec, which);
    const target = axisTarget(values.variable);
    const property = axisProp(values.variable) || 'thk';
    const isLayer = target.startsWith('layer:');

    const setVariable = (token) => {
        onUpdate(variablePatch(which, token, defaultAxisRange(design, token)));
    };
    const setRange = (patch) => onUpdate(rangePatch(which, values, patch));

    return h('div', null,
        h(SettingRow, { c, label: which === 'x' ? (pe.xAxisVar || 'X axis') : (pe.yAxisVar || 'Y axis') },
            h(SelectField, {
                c, width: selectWidth, value: target,
                onChange: value => setVariable(composeAxisVar(value, property)),
                options: targetOptions.map(option => ({
                    id: option.value, label: targetLabel(option, pe),
                })),
            }),
        ),
        isLayer && h(SettingRow, { c, label: '' },
            h(SelectField, {
                c, width: selectWidth, value: property,
                onChange: value => setVariable(composeAxisVar(target, value)),
                options: AXIS_PROPS.map(option => ({
                    id: option.value, label: propertyLabel(option, pe),
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
                c, width: 52, value: values.steps, min: 2, max: MAX_AXIS_STEPS,
                // A grid axis is sampled a whole number of times.
                onChange: value => setRange({ steps: Math.round(value) }),
            }),
        ),
    );
}
