import {
    AXIS_PROPS, axisTarget, axisProp, composeAxisVar, defaultAxisRange,
} from '../../../../utils/physics/plotQuantities.js';

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

export function SurfaceAxisGroup({ which, spec, design, onUpdate, targetOptions, styles, c, pe }) {
    const values = axisValues(spec, which);
    const target = axisTarget(values.variable);
    const property = axisProp(values.variable) || 'thk';
    const isLayer = target.startsWith('layer:');

    const setVariable = (token) => {
        onUpdate(variablePatch(which, token, defaultAxisRange(design, token)));
    };
    const setRange = (patch) => onUpdate(rangePatch(which, values, patch));

    return h('div', { style: { marginBottom: 8 } },
        h('div', { style: styles.lbl }, which === 'x' ? (pe.xAxisVar || 'X axis') : (pe.yAxisVar || 'Y axis')),
        h('select', {
            value: target,
            onChange: (e) => setVariable(composeAxisVar(e.target.value, property)),
            style: styles.selStyle,
        }, targetOptions.map(option => h('option', { key: option.value, value: option.value }, targetLabel(option, pe)))),
        isLayer && h('select', {
            value: property,
            onChange: (e) => setVariable(composeAxisVar(target, e.target.value)),
            style: { ...styles.selStyle, marginTop: 4 },
        }, AXIS_PROPS.map(option => h('option', { key: option.value, value: option.value }, propertyLabel(option, pe)))),
        h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 } },
            h('input', {
                type: 'number', value: values.from, style: styles.numStyle,
                onChange: (e) => setRange({ from: parseFloat(e.target.value) || 0 }),
            }),
            h('span', { style: { color: c.textDim } }, '–'),
            h('input', {
                type: 'number', value: values.to, style: styles.numStyle,
                onChange: (e) => setRange({ to: parseFloat(e.target.value) || 0 }),
            }),
            h('span', { style: { color: c.textDim, fontSize: 10, marginLeft: 4 } }, pe.steps || 'steps'),
            h('input', {
                type: 'number', value: values.steps, min: 2, max: 400,
                style: { ...styles.numStyle, width: 46 },
                onChange: (e) => setRange({ steps: parseInt(e.target.value, 10) || 2 }),
            }),
        ),
    );
}
