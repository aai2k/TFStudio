import {
    X_AXES, Y_CHANNELS, POLARIZATIONS, SURFACE_MODES, DASHES,
} from '../../../../utils/physics/plotQuantities.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { FieldLabel, NumInput, RangeField, SelectField, valueOptions } from '../chrome/controls.js';
import { SettingRow } from '../chrome/popover.js';

const { createElement: h } = React;

const FONT = 'system-ui, -apple-system, sans-serif';
const SELECT_WIDTH = 110;

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
            title: pe.visible || 'Visible',
        }),
        h('input', {
            type: 'color', value: curve.color,
            onChange: event => onUpdate({ color: event.target.value }),
            title: pe.color || 'Color',
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
            type: 'button', onClick: onDelete, title: pe.delete || 'Delete curve',
            style: {
                width: 22, height: 22, padding: 0, flexShrink: 0,
                background: 'transparent', color: c.textDim,
                border: 'none', borderRadius: 4, cursor: 'pointer',
                fontSize: 15, lineHeight: 1, fontFamily: FONT,
            },
        }, '×'),
    );
}

export function CurveRow({ curve, onUpdate, onDelete, c, t }) {
    const pe = (t && t.plotEngine) || {};
    const overAngle = curve.xAxis === 'aoi';
    const rangeStep = overAngle ? 5 : 10;

    return h('div', {
        style: {
            padding: '6px 0',
            borderBottom: `1px solid ${c.border}`,
            opacity: curve.visible ? 1 : 0.55,
        },
    },
        h(CurveHeader, { curve, onUpdate, onDelete, c, pe }),
        h(SettingRow, { c, label: pe.xAxis || 'X axis' },
            h(SelectField, {
                c, width: SELECT_WIDTH, value: curve.xAxis,
                onChange: value => onUpdate({ xAxis: value }),
                options: valueOptions(X_AXES, v => (v === 'aoi' ? 'AOI' : (pe.xWavelength || 'wavelength'))),
            }),
        ),
        h(SettingRow, { c, label: pe.range || 'Range' },
            h(RangeField, {
                c, width: 58, unit: overAngle ? '°' : 'nm',
                from: {
                    value: curve.rangeFrom, step: rangeStep,
                    onChange: value => onUpdate({ rangeFrom: value }),
                },
                to: {
                    value: curve.rangeTo, step: rangeStep,
                    onChange: value => onUpdate({ rangeTo: value }),
                },
            }),
        ),
        h(SettingRow, { c, label: pe.step || 'Step' },
            h(NumInput, {
                c, width: 58, value: curve.rangeStep, step: 1, min: 0.1,
                onChange: value => onUpdate({ rangeStep: value }),
            }),
        ),
        // The parameter the curve is not swept over is held at one value.
        !overAngle && h(SettingRow, { c, label: pe.fixedAOI || 'AOI fixed' },
            h(NumInput, {
                c, width: 58, value: curve.aoiFixed_deg, step: 5, min: 0, max: 89,
                onChange: value => onUpdate({ aoiFixed_deg: value }),
            }),
        ),
        overAngle && h(SettingRow, { c, label: pe.fixedLambda || 'λ fixed' },
            h(NumInput, {
                c, width: 58, value: curve.lambdaFixed_nm, step: 10, min: 100,
                onChange: value => onUpdate({ lambdaFixed_nm: value }),
            }),
        ),
        h(SettingRow, { c, label: pe.channel || 'Y' },
            h(SelectField, {
                c, width: 58, value: curve.yChannel,
                onChange: value => onUpdate({ yChannel: value }),
                options: valueOptions(Y_CHANNELS),
            }),
            h(SelectField, {
                c, width: 66, value: curve.polarization,
                onChange: value => onUpdate({ polarization: value }),
                options: valueOptions(POLARIZATIONS),
            }),
        ),
        h(SettingRow, { c, label: pe.surface || 'Surface' },
            h(SelectField, {
                c, width: SELECT_WIDTH, value: curve.surfaceMode,
                onChange: value => onUpdate({ surfaceMode: value }),
                options: valueOptions(SURFACE_MODES),
            }),
        ),
        h(SettingRow, { c, label: pe.dash || 'Dash' },
            h(SelectField, {
                c, width: SELECT_WIDTH, value: curve.dash,
                onChange: value => onUpdate({ dash: value }),
                options: valueOptions(DASHES),
            }),
            h(FieldLabel, { c }, pe.width || 'Width'),
            h(NumInput, {
                c, width: 48, value: curve.width, step: 0.5, min: 0.5, max: 5,
                onChange: value => onUpdate({ width: value }),
            }),
        ),
    );
}
