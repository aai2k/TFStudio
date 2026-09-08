import { OPERAND_POLS } from '../../../../../utils/physics/optimizer.js';
import { ROW_H } from './rowWindow.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

/**
 * The mouse handlers of a cell that is selected like a spreadsheet cell: the
 * button going down focuses it, or stretches or toggles the selection with
 * Shift or Ctrl, and dragging across cells grows the rectangle.
 */
export function selectable(ctx, colKey) {
    return {
        onMouseDown: event => ctx.cellDown(colKey, event),
        onMouseEnter: () => ctx.cellEnter(colKey),
    };
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
            whiteSpace: 'nowrap', flexShrink: 0,
            background: accent ? c.accent + '22' : c.panel,
            color: disabled ? c.textDim : accent ? c.accent : c.text,
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, fontFamily: 'inherit',
        },
    }, label);
}

/**
 * A dropdown sized to sit inside one table row.
 *
 * The customizable select the app opts into carries a 24 px minimum height of
 * its own, which is taller than a row. Left alone it stretches the row past
 * `ROW_H`, and since a row is placed from its index the whole table then drifts
 * out of step with its scrollbar. The minimum is cleared and the height given
 * outright.
 */
export function CellSelect({ value, onChange, title, color, children, selectRef, onBlur, onKeyDown }) {
    return h('select', {
        ref: selectRef, value, onChange, onBlur, onKeyDown, title,
        style: {
            width: '100%', background: 'transparent', color, border: 'none',
            fontSize: 11, padding: '1px 2px', fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
            height: ROW_H - 2, minHeight: 0, boxSizing: 'border-box',
        },
    }, children);
}

/**
 * The Pol cell's editor: the three polarizations as a list, dropped open the
 * moment it appears. A pick or Enter commits; Escape cancels and hands the
 * focus back to the table; focus leaving the list, as a click elsewhere takes
 * it, closes it without a change.
 */
export function PolSelect({ value, onCommit, onCancel, c }) {
    const ref = useRef(null);
    useEffect(() => {
        const select = ref.current;
        if (!select) return;
        select.focus();
        // Dropping the list open needs a user gesture, and the key or click
        // that started the edit is one. Where it is refused the list is
        // focused and closed, and opens on Space or Alt+Down.
        try { select.showPicker?.(); } catch { /* opened from the keyboard instead */ }
    }, []);
    return h(CellSelect, {
        selectRef: ref, value, color: c.text,
        onChange: event => onCommit(event.target.value),
        onBlur: () => onCancel(false),
        onKeyDown: event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(true); }
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onCommit(event.target.value); }
        },
    }, OPERAND_POLS.map(pol => h('option', { key: pol, value: pol, style: { background: c.panel } }, pol)));
}
