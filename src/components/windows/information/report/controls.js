/**
 * Controls the Report window needs beyond the shared analysis set: a text
 * field, a comma-separated angle list, a color field and a multi-line text.
 * Sized like the shared inputs so a panel mixes them freely.
 */

import { parseNumberStrict } from '../../../../utils/misc/numberParsing.js';

const { createElement: h, useState, useEffect } = React;

const FONT = 'system-ui, -apple-system, sans-serif';

function fieldStyle(c, width, extra = {}) {
    return {
        width, height: 24, backgroundColor: c.field, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        fontSize: 12, fontFamily: FONT, padding: '0 5px', outline: 'none',
        boxSizing: 'border-box', ...extra,
    };
}

/** Single-line text, committed on every keystroke. */
export function TextField({ value, onChange, c, width = 180, placeholder, title }) {
    return h('input', {
        type: 'text', value: value ?? '', placeholder, title,
        onChange: event => onChange(event.target.value),
        style: fieldStyle(c, width),
    });
}

/** Several lines of text, for the notes block. */
export function TextArea({ value, onChange, c, width = 260, rows = 5, placeholder }) {
    return h('textarea', {
        value: value ?? '', placeholder, rows,
        onChange: event => onChange(event.target.value),
        style: { ...fieldStyle(c, width, { height: 'auto', padding: '4px 5px', lineHeight: 1.4, resize: 'vertical' }) },
    });
}

/** Angles of incidence as a comma-separated list, committed on blur or Enter. */
export function AngleListField({ value, onChange, c, width = 110 }) {
    const text = list => (list || []).join(', ');
    const [raw, setRaw] = useState(text(value));
    useEffect(() => { setRaw(text(value)); }, [value]);
    const commit = () => {
        const parsed = [...new Set(raw.split(/[,\s;]+/).map(s => parseNumberStrict(s))
            .filter(v => Number.isFinite(v) && v >= 0 && v < 90).map(v => Math.round(v * 10) / 10))];
        if (parsed.length) onChange(parsed); else setRaw(text(value));
    };
    return h('input', {
        type: 'text', inputMode: 'decimal', value: raw,
        onChange: event => setRaw(event.target.value),
        onBlur: commit,
        onKeyDown: event => { if (event.key === 'Enter') commit(); },
        style: fieldStyle(c, width, { textAlign: 'right' }),
    });
}

/** A color, as the native picker beside its hex value. */
export function ColorField({ value, onChange, c }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h('input', {
            type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#000000',
            onChange: event => onChange(event.target.value),
            style: { width: 28, height: 24, padding: 0, border: `1px solid ${c.border}`, borderRadius: 3, backgroundColor: c.field, cursor: 'pointer' },
        }),
        h('span', { style: { fontSize: 11, color: c.textDim, fontFamily: FONT } }, value || ''),
    );
}

/** Button sized for a panel footer. */
export function PanelButton({ label, onClick, c, tone, disabled, title }) {
    return h('button', {
        type: 'button', title, disabled,
        onClick: () => { if (!disabled) onClick(); },
        style: {
            flex: 1, height: 26, padding: '0 8px', border: `1px solid ${c.border}`, borderRadius: 5,
            backgroundColor: 'transparent', color: disabled ? c.textDim : (tone || c.text),
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
            fontSize: 11, fontWeight: 500, fontFamily: FONT, whiteSpace: 'nowrap',
        },
    }, label);
}
