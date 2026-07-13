import { DebouncedInput } from '../../../ui/DebouncedInput.js';

const { createElement: h } = React;

export function numField(value, onNum, style, { fallback = 0, int = false } = {}) {
    return h(DebouncedInput, {
        value: String(value),
        onChange: valueString => {
            const trimmed = String(valueString).trim();
            const parsed = trimmed === ''
                ? fallback
                : (int ? parseInt(valueString, 10) : parseFloat(valueString));
            onNum(Number.isFinite(parsed) ? parsed : fallback);
        },
        style,
    });
}

export function buildControlStyles(c) {
    const labelStyle = { color: c.textDim, fontSize: 11, whiteSpace: 'nowrap' };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 11, width: 64,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const segBtnStyle = active => ({
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        whiteSpace: 'nowrap',
    });
    const sectionTitle = {
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: 0.4, color: c.textDim, margin: '6px 8px 4px',
    };
    return { labelStyle, inputStyle, segBtnStyle, sectionTitle };
}
