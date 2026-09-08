import { OPERAND_POLS } from '../../../../../utils/physics/optimizer.js';
import { dropPositionFrom } from '../../../../ui/PickerDropdown.js';
import { listenForDismiss, ownerWindow } from '../../../../ui/ownerWindow.js';
import { polFromKey } from './editModel.js';
import { ROW_H } from './rowWindow.js';

const { createElement: h, useState, useEffect, useLayoutEffect, useRef, useCallback } = React;

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
export function CellSelect({ value, onChange, title, color, children }) {
    return h('select', {
        value, onChange, title,
        style: {
            width: '100%', background: 'transparent', color, border: 'none',
            fontSize: 11, padding: '1px 2px', fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
            height: ROW_H - 2, minHeight: 0, boxSizing: 'border-box',
        },
    }, children);
}

/**
 * The Pol cell's editor: the three polarizations as a short list dropped under
 * the cell, the current one marked. Arrows move the highlight, Enter or a click
 * picks, a typed a, s or p picks outright, and Escape or the focus leaving the
 * list closes it.
 *
 * It is drawn in the page, like the operand picker, and not as a native
 * dropdown: in the app's window that opens as a widget of its own, takes the
 * focus with it and reports no pick back to the cell.
 */
export function PolList({ value, onCommit, onCancel, c }) {
    const [highlight, setHighlight] = useState(Math.max(0, OPERAND_POLS.indexOf(value)));
    const [pos, setPos] = useState(null);
    const ref = useRef(null);
    // Placed from the cell it hangs under, its parent, before the first paint;
    // until measured it is drawn out of sight.
    useLayoutEffect(() => {
        const cell = ref.current?.parentElement;
        if (cell) setPos(dropPositionFrom(cell.getBoundingClientRect(), 60, ownerWindow(cell)));
    }, []);
    // Focused once it is placed, since a hidden element refuses the focus, and
    // the focus leaving is one of the two things that close the list.
    useLayoutEffect(() => { if (pos) ref.current?.focus(); }, [pos]);
    // The other is a press anywhere outside it, in either window, which closes
    // it whether or not it ever held the focus. Escape from the table does too.
    useEffect(() => {
        const list = ref.current;
        const onDown = event => { if (!list.contains(event.target)) onCancel(false); };
        const onKey = event => { if (event.key === 'Escape') onCancel(true); };
        return listenForDismiss(list, { mousedown: onDown, keydown: onKey });
    }, []); // eslint-disable-line
    const onKeyDown = event => {
        event.stopPropagation();
        const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
        if (step) {
            event.preventDefault();
            setHighlight(index => (index + step + OPERAND_POLS.length) % OPERAND_POLS.length);
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onCommit(OPERAND_POLS[highlight]); return; }
        if (event.key === 'Escape') { event.preventDefault(); onCancel(true); return; }
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        const pol = polFromKey(event.key);
        if (pol) { event.preventDefault(); onCommit(pol); }
    };
    const placement = pos
        ? { left: pos.left, width: pos.width, ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }) }
        : { visibility: 'hidden' };
    return h('div', {
        ref, tabIndex: -1, onKeyDown, onBlur: () => onCancel(false),
        style: {
            position: 'fixed', zIndex: 9999, outline: 'none', ...placement,
            background: c.panel, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)', fontSize: 11, padding: '2px 0',
        },
    }, OPERAND_POLS.map((pol, index) => h('div', {
        key: pol,
        // Picked on the press: a click would first move the focus off the
        // list and close it.
        onMouseDown: event => { event.preventDefault(); onCommit(pol); },
        onMouseEnter: () => setHighlight(index),
        style: {
            padding: '2px 8px', cursor: 'pointer',
            background: index === highlight ? c.accent + '33' : 'transparent',
            color: pol === value ? c.accent : c.text, fontWeight: pol === value ? 600 : 400,
        },
    }, pol)));
}
