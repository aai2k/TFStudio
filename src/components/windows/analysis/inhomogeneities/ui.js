import { DebouncedInput } from '../../../ui/DebouncedInput.js';

const { createElement: h } = React;

export function numField(value, onNum, style, { fallback = 0, int = false } = {}) {
    return h(DebouncedInput, {
        value: String(value),
        onChange: valueText => {
            const text = String(valueText).trim();
            const valueNumber = text === ''
                ? fallback
                : (int ? parseInt(valueText, 10) : parseFloat(valueText));
            onNum(Number.isFinite(valueNumber) ? valueNumber : fallback);
        },
        style,
    });
}

export function placeholder(c, message) {
    return h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, message);
}

export function controlStyles(c) {
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    return {
        inputStyle,
        labelStyle: { color: c.textDim, fontSize: 11, whiteSpace: 'nowrap' },
        segBtnStyle: active => ({
            padding: '2px 10px',
            background: active ? c.accent : (c.inputBg || c.hover),
            color: active ? '#fff' : c.text,
            border: `1px solid ${active ? c.accent : c.border}`,
            borderRadius: 3, cursor: 'pointer', fontSize: 12,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            whiteSpace: 'nowrap',
        }),
    };
}
