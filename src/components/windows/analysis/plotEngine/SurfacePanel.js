import {
    POLARIZATIONS, Z_QUANTITIES, COLORSCALES, axisSampleCount,
    buildAxisTargetOptions, parseAxisVar, quantitySides, takesPolarization,
} from '../../../../utils/physics/plotQuantities.js';
import { NumInput, SelectField, valueOptions } from '../chrome/controls.js';
import { SettingDivider, SettingRow } from '../chrome/popover.js';
import { SurfaceAxisGroup } from './SurfaceAxisGroup.js';
import { surfaceErrorText } from './charts/surfaceOption.js';
import { quantitySymbol } from './quantityLabels.js';

const { createElement: h } = React;

// Width the panel gives a dropdown. The axis pickers carry the longest values a
// user can choose (a layer tag is a number and a material name), so they set it
// and the rest match.
const SELECT_WIDTH = 168;

function panelNote(c) {
    return { fontSize: 10, color: c.textDim, lineHeight: 1.45, padding: '2px 0 4px' };
}

// Ψ and Δ take both polarizations at once, so their polarization is disabled;
// the sides offered are the ones the quantity is read on.
function QuantitySection({ spec, onUpdate, optical, isMF, c, t }) {
    const pe = t.plotEngine;
    return h('div', null,
        h(SettingRow, { c, label: pe.quantity || 'Quantity' },
            h(SelectField, {
                c, width: SELECT_WIDTH, value: spec.z,
                onChange: value => onUpdate({ z: value }),
                options: valueOptions(Z_QUANTITIES, v => (v === 'MF' ? pe.zMF : quantitySymbol(v, t))),
            }),
        ),
        optical && h(SettingRow, { c, label: pe.polarization || 'Polarization' },
            h(SelectField, {
                c, width: SELECT_WIDTH, value: spec.polarization,
                disabled: !takesPolarization(spec.z),
                onChange: value => onUpdate({ polarization: value }),
                options: valueOptions(POLARIZATIONS, v => (v === 'avg' && pe.polAvg) || v),
            }),
        ),
        optical && h(SettingRow, { c, label: pe.surface || 'Surface' },
            h(SelectField, {
                c, width: SELECT_WIDTH, value: spec.surfaceMode,
                onChange: value => onUpdate({ surfaceMode: value }),
                options: valueOptions(quantitySides(spec.z), v => pe.surfaceModes?.[v] || v),
            }),
        ),
        isMF && h('div', { style: panelNote(c) }, pe.mfHint),
    );
}

function FixedParameters({ spec, onUpdate, needFixedLambda, needFixedAOI, c, pe }) {
    if (!needFixedLambda && !needFixedAOI) return null;
    return h('div', null,
        h(SettingDivider, { c }),
        needFixedLambda && h(SettingRow, { c, label: pe.fixedLambda || 'λ (nm)' },
            h(NumInput, {
                c, width: 72, value: spec.fixedLambda_nm, step: 10, positive: true,
                onChange: value => onUpdate({ fixedLambda_nm: value }),
            }),
        ),
        needFixedAOI && h(SettingRow, { c, label: pe.fixedAOI || 'AOI (°)' },
            h(NumInput, {
                c, width: 72, value: spec.fixedAOI_deg, step: 5, min: 0, max: 89,
                onChange: value => onUpdate({ fixedAOI_deg: value }),
            }),
        ),
    );
}

function Appearance({ spec, onUpdate, c, pe }) {
    return h('div', null,
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: pe.colorscale || 'Colors' },
            h(SelectField, {
                c, width: SELECT_WIDTH, value: spec.colorscale,
                onChange: value => onUpdate({ colorscale: value }),
                options: valueOptions(COLORSCALES),
            }),
        ),
    );
}

function gridLabel(spec, pe) {
    const nx = axisSampleCount(spec.xSteps);
    const ny = axisSampleCount(spec.ySteps);
    return (pe.gridSize || 'Grid') + `: ${nx} × ${ny} = ${nx * ny} ${pe.points || 'points'}`;
}

/**
 * Under a rule: the grid Compute will evaluate, and the reason it could not if
 * the last attempt failed.
 */
function GridFooter({ spec, result, c, pe }) {
    return h('div', {
        style: {
            marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        },
    },
        h('div', { style: { fontSize: 10, color: c.textDim, textAlign: 'center' } },
            gridLabel(spec, pe)),
        result && !result.ok && h('div', {
            role: 'alert',
            style: { fontSize: 10, color: c.error, textAlign: 'center', lineHeight: 1.4 },
        }, surfaceErrorText(result, pe)),
    );
}

export function SurfacePanel({ spec, onUpdate, design, result, c, t }) {
    const pe = (t && t.plotEngine) || {};
    const isMF = spec.z === 'MF';
    const optical = !isMF;
    const targetOptions = buildAxisTargetOptions(design, optical);
    const xKind = parseAxisVar(spec.xVar).kind;
    const yKind = parseAxisVar(spec.yVar).kind;
    const needFixedLambda = optical && xKind !== 'lambda' && yKind !== 'lambda';
    const needFixedAOI = optical && xKind !== 'aoi' && yKind !== 'aoi';
    const axis = { spec, design, onUpdate, targetOptions, selectWidth: SELECT_WIDTH, c, t };

    return h('div', null,
        h(QuantitySection, { spec, onUpdate, optical, isMF, c, t }),
        h(SettingDivider, { c }),
        h(SurfaceAxisGroup, { ...axis, which: 'x' }),
        h(SurfaceAxisGroup, { ...axis, which: 'y' }),
        h(FixedParameters, { spec, onUpdate, needFixedLambda, needFixedAOI, c, pe }),
        h(Appearance, { spec, onUpdate, c, pe }),
        h(GridFooter, { spec, result, c, pe }),
    );
}
