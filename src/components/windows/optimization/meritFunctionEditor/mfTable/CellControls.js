import { OPERAND_TYPES } from '../../../../../utils/physics/optimizer.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;
const TYPE_GROUP_ORDER = ['optical', 'range', 'rangetarget', 'integral', 'worst', 'math', 'argwave', 'thick', 'misc'];

export function typeOptionEls(t, c) {
    const operandTypes = t?.meritFunctionEditor?.operandTypes || {};
    const operandGroups = t?.meritFunctionEditor?.operandGroups || {};
    const grouped = {};
    for (const type of OPERAND_TYPES) {
        const group = operandTypes[type]?.group || 'optical';
        (grouped[group] = grouped[group] || []).push(type);
    }
    const options = [];
    for (const group of TYPE_GROUP_ORDER) {
        if (!grouped[group]) continue;
        options.push(h('optgroup', { key: group, label: operandGroups[group] || group },
            grouped[group].map(type => h('option', {
                key: type, value: type, title: operandTypes[type]?.label || type,
                style: { background: c.panel },
            }, type)),
        ));
    }
    for (const type of OPERAND_TYPES) {
        const group = operandTypes[type]?.group || 'optical';
        if (TYPE_GROUP_ORDER.includes(group)) continue;
        options.push(h('option', { key: type, value: type, style: { background: c.panel } }, type));
    }
    return options;
}

export function CellInput({ initValue, onCommit, onCancel, onNavigate, c }) {
    const [draft, setDraft] = useState(initValue);
    const ref = useRef(null);
    useEffect(() => { ref.current?.select(); }, []);
    const commit = useCallback(() => onCommit(draft), [draft, onCommit]);

    return h('input', {
        ref,
        value: draft,
        onChange: event => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: event => {
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); onNavigate('down'); }
            if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); commit(); onNavigate(event.shiftKey ? 'left' : 'right'); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
            if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); commit(); onNavigate('down'); }
            if (event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); commit(); onNavigate('up'); }
        },
        style: {
            width: '100%', background: c.bg, color: c.text,
            border: `1px solid ${c.accent}`, borderRadius: 2,
            fontSize: 11, padding: '1px 3px', fontFamily: 'inherit',
            outline: 'none', boxSizing: 'border-box',
        },
    });
}

export function TblBtn({ label, onClick, disabled, c, accent, title }) {
    return h('button', {
        onClick, disabled: !!disabled, title,
        style: {
            padding: '2px 8px', fontSize: 11, border: `1px solid ${c.border}`, borderRadius: 3,
            background: accent ? c.accent + '22' : c.panel,
            color: disabled ? c.textDim : accent ? c.accent : c.text,
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, fontFamily: 'inherit',
        },
    }, label);
}

export function CellSelect({ value, onChange, title, color, children }) {
    return h('select', {
        value, onChange, title,
        style: {
            width: '100%', background: 'transparent', color, border: 'none',
            fontSize: 11, padding: '1px 2px', fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
        },
    }, children);
}
