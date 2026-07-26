import { AOI_MAX, formatTheta } from './model.js';

const { createElement: h, useState } = React;

function parsedAoi(raw) {
    const value = parseFloat(raw);
    return isNaN(value) || value < 0 || value >= 90 ? null : Math.round(value * 10) / 10;
}

function addDraftAoi({ draft, values, onChange, setDraft }) {
    if (!draft.trim()) return;
    const value = parsedAoi(draft);
    if (value !== null && !values.includes(value) && values.length < AOI_MAX) onChange([...values, value]);
    setDraft('');
}

function editAoi({ index, raw, values, onChange }) {
    const value = parsedAoi(raw);
    const duplicate = values.some((item, itemIndex) => itemIndex !== index && item === value);
    if (value !== null && !duplicate && values[index] !== value) {
        onChange(values.map((item, itemIndex) => itemIndex === index ? value : item));
    }
}

function removeAoi({ index, values, onChange }) {
    if (values.length > 1) onChange(values.filter((_, itemIndex) => itemIndex !== index));
}

function AoiChip({ value, onRemove, onEdit, canRemove, c, oe }) {
    const [editing, setEditing] = useState(false);
    const [raw, setRaw] = useState('');
    const start = () => { setRaw(formatTheta(value)); setEditing(true); };
    const commit = () => { onEdit(raw); setEditing(false); };

    if (editing) {
        return h('input', {
            type: 'number', value: raw, min: 0, max: 89, step: 1, autoFocus: true,
            onFocus: event => event.target.select(),
            onChange: event => setRaw(event.target.value),
            onBlur: commit,
            onKeyDown: event => {
                if (event.key === 'Enter') commit();
                if (event.key === 'Escape') setEditing(false);
            },
            style: {
                width: 46, height: 22,
                border: `1px solid ${c.accent}`, borderRadius: 4,
                backgroundColor: c.panel, color: c.text,
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                padding: '0 6px', outline: 'none', textAlign: 'center'
            }
        });
    }

    return h('span', {
        style: {
            display: 'inline-flex', alignItems: 'center', height: 22,
            padding: canRemove ? '0 2px 0 7px' : '0 7px',
            border: 'none', borderRadius: 4,
            fontSize: 11, lineHeight: '20px', backgroundColor: c.panel,
            fontVariantNumeric: 'tabular-nums', color: c.text, gap: 2,
            flexShrink: 0
        }
    },
        h('span', { onClick: start, title: oe.editAoiTooltip, style: { cursor: 'pointer' } }, `${formatTheta(value)}°`),
        canRemove && h('button', {
            onClick: onRemove,
            'aria-label': `Remove ${formatTheta(value)}°`,
            style: {
                background: 'transparent', border: 'none', color: c.textDim, cursor: 'pointer',
                padding: '0 3px', fontSize: 13, lineHeight: 1, outline: 'none'
            }
        }, '×')
    );
}

export function AoiChips({ values, onChange, c, oe }) {
    const [draft, setDraft] = useState('');
    const [adding, setAdding] = useState(false);
    const addValue = () => {
        addDraftAoi({ draft, values, onChange, setDraft });
        setAdding(false);
    };
    const addTitle = oe.addAoiTooltip(AOI_MAX);
    return h('div', {
        style: {
            minHeight: 28, display: 'inline-flex', alignItems: 'center', gap: 2,
            padding: 2, border: `1px solid ${c.border}`, borderRadius: 7,
            backgroundColor: c.field, flexWrap: 'wrap'
        }
    },
        values.map((value, index) => h(AoiChip, {
            key: `${value}-${index}`, value,
            onRemove: () => removeAoi({ index, values, onChange }),
            onEdit: raw => editAoi({ index, raw, values, onChange }),
            canRemove: values.length > 1, c, oe
        })),
        values.length < AOI_MAX && adding && h('input', {
            type: 'number', value: draft,
            autoFocus: true, title: addTitle, 'aria-label': addTitle,
            min: 0, max: 89, step: 1,
            onChange: event => setDraft(event.target.value),
            onBlur: addValue,
            onKeyDown: event => {
                if (event.key === 'Enter') addValue();
                if (event.key === 'Escape') { setDraft(''); setAdding(false); }
            },
            style: {
                width: 46, height: 22,
                border: `1px solid ${c.accent}`, borderRadius: 4,
                backgroundColor: c.panel, color: c.text,
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                padding: '0 4px', outline: 'none', textAlign: 'center'
            }
        }),
        values.length < AOI_MAX && !adding && h('button', {
            onClick: () => setAdding(true), title: addTitle, 'aria-label': addTitle,
            style: {
                width: 24, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', borderRadius: 4, backgroundColor: 'transparent',
                color: c.textDim, cursor: 'pointer', outline: 'none', fontSize: 15, lineHeight: 1
            }
        }, '+')
    );
}
