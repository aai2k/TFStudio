import {
    DASHES, POLARIZATIONS, QUANTITIES, SURFACE_MODES, SWEEP,
    buildAxisTargetOptions, parseAxisVar, quantitySides, takesPolarization,
} from '../../../../utils/physics/plotQuantities.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { FieldLabel, NumInput, RangeField, SelectField, valueOptions } from '../chrome/controls.js';
import { SettingRow } from '../chrome/popover.js';
import { readsMerit } from './curveEdits.js';
import { axisOptionLabel, quantityOptionLabel, sweepUnit } from './quantityLabels.js';

const { createElement: h } = React;

const FONT = 'system-ui, -apple-system, sans-serif';

// How far one arrow key moves each kind of range end.
const RANGE_NUDGE = { lambda: 10, aoi: 5, thk: 10 };

/**
 * What the curve is called and whether it is drawn: the switch, its colour, its
 * name and the control that removes it, on one line above the settings.
 */
function CurveHeader({ curve, onUpdate, onDelete, c, pe }) {
    return h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
    },
        h(Checkbox, {
            c, checked: curve.visible,
            onChange: event => onUpdate({ visible: event.target.checked }),
            title: pe.visible,
        }),
        h('input', {
            type: 'color', value: curve.color,
            onChange: event => onUpdate({ color: event.target.value }),
            title: pe.color,
            style: {
                width: 24, height: 22, padding: 0, cursor: 'pointer',
                background: 'transparent', border: `1px solid ${c.border}`, borderRadius: 4,
            },
        }),
        h('input', {
            type: 'text', value: curve.label,
            onChange: event => onUpdate({ label: event.target.value }),
            style: {
                flex: 1, minWidth: 0, height: 24, padding: '0 5px',
                backgroundColor: c.field, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 3,
                fontSize: 12, fontFamily: FONT, outline: 'none',
            },
        }),
        h('button', {
            type: 'button', onClick: onDelete, title: pe.delete,
            style: {
                width: 22, height: 22, padding: 0, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', color: c.textDim,
                border: 'none', borderRadius: 4, cursor: 'pointer',
            },
        }, tablerIcon('trash', 14)),
    );
}

/**
 * What a curve can change along it: the wavelength, the angle, or the
 * thickness of one front layer, the layers listed L1 first as the surface axes
 * list them. A curve that reads the merit function changes a layer, so
 * wavelength and angle are not offered to it.
 */
export function sweepOptions(curve, design, t) {
    return buildAxisTargetOptions(design, !readsMerit(curve))
        .map(option => ({ id: option.value, label: axisOptionLabel(option, t) }));
}

function SweepRow({ curve, design, onUpdate, c, t }) {
    return h(SettingRow, { c, label: t.plotEngine.sweep },
        h(SelectField, {
            c, width: 268, value: curve.sweep,
            onChange: sweep => onUpdate({ sweep }),
            options: sweepOptions(curve, design, t),
        }),
    );
}

function RangeRow({ curve, onUpdate, c, t }) {
    const pe = t.plotEngine;
    const nudge = RANGE_NUDGE[parseAxisVar(curve.sweep).kind];
    return h(SettingRow, { c, label: pe.range },
        h(RangeField, {
            c, width: 58, unit: sweepUnit(curve.sweep, t),
            from: { value: curve.rangeFrom, step: nudge, onChange: value => onUpdate({ rangeFrom: value }) },
            to: { value: curve.rangeTo, step: nudge, onChange: value => onUpdate({ rangeTo: value }) },
        }),
        h(FieldLabel, { c }, pe.step),
        h(NumInput, {
            c, width: 48, value: curve.rangeStep, step: nudge, positive: true,
            onChange: value => onUpdate({ rangeStep: value }),
        }),
    );
}

/**
 * The wavelength and angle the curve is read at while it sweeps something else.
 * One that is swept, or that nothing on the curve reads, is shown but disabled:
 * the merit function takes each operand's own.
 */
function FixedRow({ curve, onUpdate, c, t }) {
    const pe = t.plotEngine;
    const { kind } = parseAxisVar(curve.sweep);
    const reads = [curve.x.quantity, curve.y.quantity].some(quantity => quantity !== SWEEP && quantity !== 'MF');
    const unitStyle = { color: c.textDim, fontSize: 11 };
    return h(SettingRow, { c, label: pe.fixed },
        h(FieldLabel, { c }, 'λ'),
        h(NumInput, {
            c, width: 58, value: curve.lambdaFixed_nm, step: 10, positive: true,
            disabled: !reads || kind === 'lambda',
            onChange: value => onUpdate({ lambdaFixed_nm: value }),
        }),
        h('span', { style: unitStyle }, t.units.nm),
        h(FieldLabel, { c }, pe.aoiShort),
        h(NumInput, {
            c, width: 48, value: curve.aoiFixed_deg, step: 5, min: 0, max: 89,
            disabled: !reads || kind === 'aoi',
            onChange: value => onUpdate({ aoiFixed_deg: value }),
        }),
        h('span', { style: unitStyle }, '°'),
    );
}

// The quantities an axis can read. The merit function needs a layer to sweep,
// so a design with no front layers is not offered it.
function quantityOptions(curve, design, t) {
    const hasFront = (design?.frontLayers || []).length > 0;
    return [SWEEP, ...QUANTITIES.filter(quantity => quantity !== 'MF' || hasFront)]
        .map(quantity => ({ id: quantity, label: quantityOptionLabel(quantity, curve.sweep, design, t) }));
}

/**
 * One axis: the quantity it reads, and the polarization and side it is read in.
 * A choice the quantity does not take is shown but disabled.
 */
function AxisRow({ which, curve, design, onUpdate, c, t }) {
    const pe = t.plotEngine;
    const axis = curve[which];
    const sides = quantitySides(axis.quantity);
    const setAxis = patch => onUpdate({ [which]: { ...axis, ...patch } });
    return h(SettingRow, { c, label: which === 'x' ? pe.axisX : pe.axisY },
        h(SelectField, {
            c, width: 112, value: axis.quantity,
            onChange: quantity => setAxis({ quantity }),
            options: quantityOptions(curve, design, t),
        }),
        h(SelectField, {
            c, width: 58, value: axis.polarization, disabled: !takesPolarization(axis.quantity),
            onChange: polarization => setAxis({ polarization }),
            options: valueOptions(POLARIZATIONS, v => (v === 'avg' ? pe.polAvg : v)),
        }),
        h(SelectField, {
            c, width: 70, value: axis.side, disabled: sides.length === 0,
            onChange: side => setAxis({ side }),
            options: valueOptions(sides.length ? sides : SURFACE_MODES, v => pe.surfaceModes[v]),
        }),
    );
}

export function CurveRow({ curve, design, errorKey, onUpdate, onDelete, c, t }) {
    const pe = t.plotEngine;
    return h('div', {
        style: {
            padding: '6px 0',
            borderBottom: `1px solid ${c.border}`,
            opacity: curve.visible ? 1 : 0.55,
        },
    },
        h(CurveHeader, { curve, onUpdate, onDelete, c, pe }),
        h(SweepRow, { curve, design, onUpdate, c, t }),
        h(RangeRow, { curve, onUpdate, c, t }),
        h(FixedRow, { curve, onUpdate, c, t }),
        h(AxisRow, { which: 'x', curve, design, onUpdate, c, t }),
        h(AxisRow, { which: 'y', curve, design, onUpdate, c, t }),
        h(SettingRow, { c, label: pe.dash },
            h(SelectField, {
                c, width: 100, value: curve.dash,
                onChange: value => onUpdate({ dash: value }),
                options: valueOptions(DASHES, v => pe.dashes[v]),
            }),
            h(FieldLabel, { c }, pe.width),
            h(NumInput, {
                c, width: 48, value: curve.width, step: 0.5, min: 0.5, max: 5,
                onChange: value => onUpdate({ width: value }),
            }),
        ),
        errorKey && h('div', {
            role: 'alert',
            style: { fontSize: 10, color: c.error, lineHeight: 1.4, paddingTop: 2 },
        }, pe[errorKey] || pe.errCannotCompute),
    );
}
