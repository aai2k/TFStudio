import {
    X_AXES, Y_CHANNELS, POLARIZATIONS, SURFACE_MODES, DASHES,
} from '../../../../utils/physics/plotQuantities.js';
import { Checkbox } from '../../../ui/Checkbox.js';

const { createElement: h } = React;

export function CurveRow({ curve, onUpdate, onDelete, c, t }) {
    const pe = (t && t.plotEngine) || {};
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const selStyle = { ...inputStyle, width: 'auto' };
    const numStyle = { ...inputStyle, width: 64 };
    const fieldRow = { display: 'grid', gridTemplateColumns: '70px 1fr', gap: 6, alignItems: 'center', marginBottom: 3 };
    const lbl = { color: c.textDim, fontSize: 10 };

    return h('div', {
        style: {
            padding: '8px',
            borderBottom: `1px solid ${c.border}`,
            background: curve.visible ? c.panel : c.bg,
            opacity: curve.visible ? 1 : 0.55,
        },
    },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } },
        h(Checkbox, {
            c, checked: curve.visible,
            onChange: (e) => onUpdate({ visible: e.target.checked }),
            title: pe.visible || 'Visible',
        }),
        h('input', {
            type: 'color', value: curve.color,
            onChange: (e) => onUpdate({ color: e.target.value }),
            title: pe.color || 'Color',
            style: { width: 22, height: 18, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 },
        }),
        h('input', {
            type: 'text', value: curve.label,
            onChange: (e) => onUpdate({ label: e.target.value }),
            style: { ...inputStyle, flex: 1 },
        }),
        h('button', {
            onClick: onDelete,
            title: pe.delete || 'Delete curve',
            style: {
                width: 22, height: 18, padding: 0,
                background: 'transparent', color: c.textDim,
                border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1,
            },
        }, '×'),
    ),
    h('div', { style: fieldRow },
        h('span', { style: lbl }, pe.xAxis || 'X axis'),
        h('select', {
            value: curve.xAxis,
            onChange: (e) => onUpdate({ xAxis: e.target.value }),
            style: selStyle,
        }, X_AXES.map(v => h('option', { key: v, value: v }, v === 'aoi' ? 'AOI' : (pe.xWavelength || 'wavelength')))),
    ),
    h('div', { style: fieldRow },
        h('span', { style: lbl }, pe.range || 'Range'),
        h('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
            h('input', {
                type: 'number', value: curve.rangeFrom, step: curve.xAxis === 'aoi' ? 5 : 10, style: numStyle,
                onChange: (e) => onUpdate({ rangeFrom: parseFloat(e.target.value) || 0 }),
            }),
            h('span', null, '–'),
            h('input', {
                type: 'number', value: curve.rangeTo, step: curve.xAxis === 'aoi' ? 5 : 10, style: numStyle,
                onChange: (e) => onUpdate({ rangeTo: parseFloat(e.target.value) || 0 }),
            }),
            h('span', { style: { color: c.textDim, fontSize: 10 } }, curve.xAxis === 'aoi' ? '°' : 'nm'),
        ),
    ),
    h('div', { style: fieldRow },
        h('span', { style: lbl }, pe.step || 'Step'),
        h('input', {
            type: 'number', value: curve.rangeStep, step: 1, min: 0.1, style: numStyle,
            onChange: (e) => { const v = parseFloat(e.target.value); onUpdate({ rangeStep: v > 0 ? v : 1 }); },
        }),
    ),
    curve.xAxis === 'wavelength' && h('div', { style: fieldRow },
        h('span', { style: lbl }, pe.fixedAOI || 'AOI fixed'),
        h('input', {
            type: 'number', value: curve.aoiFixed_deg, step: 5, min: 0, max: 89, style: numStyle,
            onChange: (e) => onUpdate({ aoiFixed_deg: parseFloat(e.target.value) || 0 }),
        }),
    ),
    curve.xAxis === 'aoi' && h('div', { style: fieldRow },
        h('span', { style: lbl }, pe.fixedLambda || 'λ fixed'),
        h('input', {
            type: 'number', value: curve.lambdaFixed_nm, step: 10, min: 100, style: numStyle,
            onChange: (e) => onUpdate({ lambdaFixed_nm: parseFloat(e.target.value) || 550 }),
        }),
    ),
    h('div', { style: { ...fieldRow, gridTemplateColumns: '70px 1fr 1fr' } },
        h('span', { style: lbl }, pe.channel || 'Y'),
        h('select', { value: curve.yChannel, onChange: (e) => onUpdate({ yChannel: e.target.value }), style: selStyle },
            Y_CHANNELS.map(v => h('option', { key: v, value: v }, v))),
        h('select', { value: curve.polarization, onChange: (e) => onUpdate({ polarization: e.target.value }), style: selStyle },
            POLARIZATIONS.map(v => h('option', { key: v, value: v }, v))),
    ),
    h('div', { style: fieldRow },
        h('span', { style: lbl }, pe.surface || 'Surface'),
        h('select', { value: curve.surfaceMode, onChange: (e) => onUpdate({ surfaceMode: e.target.value }), style: selStyle },
            SURFACE_MODES.map(v => h('option', { key: v, value: v }, v))),
    ),
    h('div', { style: fieldRow },
        h('span', { style: lbl }, pe.dash || 'Dash'),
        h('div', { style: { display: 'flex', gap: 4 } },
            h('select', { value: curve.dash, onChange: (e) => onUpdate({ dash: e.target.value }), style: selStyle },
                DASHES.map(v => h('option', { key: v, value: v }, v))),
            h('input', {
                type: 'number', value: curve.width, step: 0.5, min: 0.5, max: 5,
                style: { ...numStyle, width: 40 },
                onChange: (e) => onUpdate({ width: parseFloat(e.target.value) || 2 }),
            }),
        ),
    ));
}
