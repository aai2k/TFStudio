import { Checkbox } from '../../../ui/Checkbox.js';
import { DebouncedInput } from '../../../ui/DebouncedInput.js';

const { createElement: h } = React;

function tabButtonStyle(c, active) {
    return {
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
}

function NumericField({ field, labelStyle, inputStyle }) {
    return h('label', { style: labelStyle }, field.label,
        h(DebouncedInput, {
            value: String(field.value),
            onChange: value => {
                const number = parseFloat(value);
                if (!isNaN(number)) field.setValue(Math.max(field.min, Math.min(field.max, number)));
            },
            style: { ...inputStyle, width: field.width || 58, marginLeft: 6 },
        }),
    );
}

function ButtonGroup({ items, c }) {
    return items.map(item => h('button', {
        key: item.value,
        onClick: item.onClick,
        style: tabButtonStyle(c, item.active),
    }, item.label));
}

export function GDControls({ c, text, state, summary }) {
    const labelStyle = {
        color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12, width: 58,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const groups = {
        side: [
            { value: 'front', label: text.front || 'Front', active: state.side === 'front', onClick: () => state.setSide('front') },
            { value: 'back', label: text.back || 'Back', active: state.side === 'back', onClick: () => state.setSide('back') },
        ],
        quantity: [
            { value: 'phase', label: text.phase, active: state.quantity === 'phase', onClick: () => state.setQuantity('phase') },
            { value: 'gd', label: 'GD', active: state.quantity === 'gd', onClick: () => state.setQuantity('gd') },
            { value: 'gdd', label: 'GDD', active: state.quantity === 'gdd', onClick: () => state.setQuantity('gdd') },
            { value: 'tod', label: 'TOD', active: state.quantity === 'tod', onClick: () => state.setQuantity('tod') },
        ],
        target: [
            { value: 'R', label: text.reflection, active: state.target === 'R', onClick: () => state.setTarget('R') },
            { value: 'T', label: text.transmission, active: state.target === 'T', onClick: () => state.setTarget('T') },
        ],
        polarization: [
            { value: 's', label: 's', active: state.pol === 's', onClick: () => state.setPol('s') },
            { value: 'p', label: 'p', active: state.pol === 'p', onClick: () => state.setPol('p') },
        ],
    };
    const fields = [
        { label: text.lamStart, value: state.lamStart, setValue: state.setLamStart, min: 100, max: 30000 },
        { label: text.lamEnd, value: state.lamEnd, setValue: state.setLamEnd, min: 100, max: 30000 },
        { label: text.lamStep, value: state.lamStep, setValue: state.setLamStep, min: 0.05, max: 1000, width: 50 },
        { label: text.aoi, value: state.theta, setValue: state.setTheta, min: 0, max: 89, width: 46 },
    ];

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
            padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexWrap: 'wrap',
        },
    },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
            h('span', { style: { ...labelStyle, marginRight: 3 } }, (text.side || 'Side') + ':'),
            h(ButtonGroup, { items: groups.side, c }),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
            h('span', { style: { ...labelStyle, marginRight: 3 } }, text.quantity + ':'),
            h(ButtonGroup, { items: groups.quantity, c }),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
            h(ButtonGroup, { items: groups.target, c }),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
            h('span', { style: { ...labelStyle, marginRight: 3 } }, text.pol + ':'),
            h(ButtonGroup, { items: groups.polarization, c }),
        ),
        fields.map((field, index) => h(NumericField, { key: index, field, labelStyle, inputStyle })),
        h('label', { style: { ...labelStyle, display: 'flex', alignItems: 'center', gap: 4 } },
            h(Checkbox, {
                c, checked: state.showRef,
                onChange: event => state.setShowRef(event.target.checked),
            }),
            text.refLam,
        ),
        h(NumericField, {
            field: { label: '', value: state.refLam, setValue: state.setRefLam, min: 100, max: 30000, width: 56 },
            labelStyle,
            inputStyle,
        }),
        h('span', { style: { ...labelStyle, marginLeft: 'auto', color: c.text } },
            `${text.layersLabel}: ${summary.layerCount}  |  ${text.totalThk}: ${summary.totalThickness.toFixed(1)} nm`,
        ),
    );
}
