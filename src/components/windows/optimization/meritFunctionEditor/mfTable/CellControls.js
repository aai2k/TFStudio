import { dropPositionFrom } from '../../../../ui/PickerDropdown.js';
import { listenForDismiss, ownerWindow } from '../../../../ui/ownerWindow.js';
import { rowButtonStyle } from '../../../analysis/chrome/controls.js';

const { createElement: h, useState, useEffect, useLayoutEffect, useRef } = React;

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

export function TblBtn({ label, onClick, disabled, c, accent, title }) {
    return h('button', {
        onClick, disabled: !!disabled, title,
        style: { ...rowButtonStyle(c, { active: accent, disabled }), flexShrink: 0 },
    }, label);
}

// What a key does in an open list: moves the highlight, picks a value, or
// closes the list. Null for a key the list has no use for.
function listKeyAction(event, { options, highlight, pickByKey }) {
    const count = options.length;
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) return { highlight: count ? (highlight + step + count) % count : 0 };
    if (event.key === 'Enter' || event.key === ' ') return { pick: options[highlight]?.value };
    if (event.key === 'Escape') return { cancel: true };
    const typed = event.ctrlKey || event.altKey || event.metaKey ? null : pickByKey?.(event.key);
    return typed ? { pick: typed } : null;
}

// A long list, such as the rows a math row can read, scrolls; the highlighted
// entry is kept in sight.
function keepInView(list, index) {
    const item = list?.children[index];
    if (!item) return;
    const bottom = item.offsetTop + item.offsetHeight;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

// Where the list sits: under or over its cell once measured. Until then it is
// out of sight, with its scrollbar showing, so the width it is measured at
// still fits its longest entry if it turns out long enough to scroll.
function listPlacement(pos) {
    if (!pos) return { visibility: 'hidden', overflowY: 'scroll' };
    const edge = pos.top != null ? { top: pos.top } : { bottom: pos.bottom };
    return { left: pos.left, width: pos.width, maxHeight: pos.maxH, ...edge };
}

// One entry: lit under the pointer or the arrows, marked when it is the
// cell's value. It is picked on the press: a click would first move the focus
// off the list and close it.
function listItem(option, index, { current, highlight, setHighlight, onCommit, c }) {
    const marked = index === current;
    return h('div', {
        key: index,
        onMouseDown: event => { event.preventDefault(); onCommit(option.value); },
        onMouseEnter: () => setHighlight(index),
        style: {
            padding: '2px 8px', cursor: 'pointer',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            background: index === highlight ? c.accent + '33' : 'transparent',
            color: marked ? c.accent : c.text, fontWeight: marked ? 600 : 400,
        },
    }, option.label);
}

/**
 * A cell's list of values, dropped under the cell with the current one
 * marked. Arrows move the highlight, Enter or a click picks, and Escape or the
 * focus leaving the list closes it. `pickByKey(key)` names the value a typed
 * key picks outright, as a, s and p do for polarization.
 *
 * It is drawn in the page, like the operand picker, and not as a native
 * dropdown: in the app's window that opens as a widget of its own, takes the
 * focus with it and reports no pick back to the cell.
 *
 * It is as wide as its longest entry, and never narrower than its cell or
 * 60 px.
 *
 *   options   [{ value, label }] in list order; a value may be null, as for
 *             the entry that empties a reference
 *   value     the cell's value, marked in the list
 */
export function CellList({ options, value, onCommit, onCancel, pickByKey, c }) {
    const current = options.findIndex(option => option.value === value);
    const [highlight, setHighlight] = useState(Math.max(0, current));
    const [pos, setPos] = useState(null);
    const ref = useRef(null);
    // Placed from the cell it hangs under, its parent, before the first paint,
    // at the width it is drawn at out of sight.
    useLayoutEffect(() => {
        const list = ref.current;
        const cell = list?.parentElement;
        if (!cell) return;
        const width = Math.max(60, list.offsetWidth);
        setPos(dropPositionFrom(cell.getBoundingClientRect(), width, ownerWindow(cell)));
    }, []); // eslint-disable-line
    // Focused once it is placed, since a hidden element refuses the focus, and
    // the focus leaving is one of the two things that close the list.
    useLayoutEffect(() => { if (pos) ref.current?.focus(); }, [pos]);
    useLayoutEffect(() => { if (pos) keepInView(ref.current, highlight); }, [pos, highlight]);
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
        const action = listKeyAction(event, { options, highlight, pickByKey });
        if (!action) return;
        event.preventDefault();
        if (action.highlight != null) setHighlight(action.highlight);
        else if (action.cancel) onCancel(true);
        else onCommit(action.pick);
    };
    const item = { current, highlight, setHighlight, onCommit, c };
    return h('div', {
        ref, tabIndex: -1, onKeyDown, onBlur: () => onCancel(false),
        style: {
            position: 'fixed', zIndex: 9999, outline: 'none', overflowY: 'auto', ...listPlacement(pos),
            background: c.panel, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)', fontSize: 11, padding: '2px 0',
        },
    }, options.map((option, index) => listItem(option, index, item)));
}

// A list cell's face: its value on one line, cut short before the chevron.
function listFace(text, caret) {
    return h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
        h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, text),
        caret);
}

/**
 * A cell holding one value out of a list. Focused, it shows a chevron at its
 * right, the way a spreadsheet marks a cell that offers a list; the chevron,
 * Enter or a double-click opens the list (listEditorCell). A value the row
 * fixes itself, such as a polarization carried in the type code, is shown
 * dimmed and opens nothing.
 *
 *   view  { text, title, color, fixed }
 */
export function listCell(ctx, colKey, width, view) {
    const { rowIdx, tdBase, startEdit, focusColKey } = ctx;
    const open = () => startEdit(rowIdx, colKey, null);
    const caret = !view.fixed && focusColKey === colKey
        && h('span', { className: 'tf-caret', onClick: open, style: { cursor: 'pointer' } });
    return h('td', {
        key: colKey, ...selectable(ctx, colKey),
        onDoubleClick: view.fixed ? undefined : open,
        title: view.title,
        style: tdBase(colKey, width, { color: view.color }),
    }, listFace(view.text, caret));
}

/**
 * What closing a cell's editor does, in every cell that has one: the cell goes
 * back to text, and the keyboard focus goes back on the cell, unless the editor
 * closed by a click elsewhere, which put the focus where it wanted it. The
 * editor held the focus and is gone with it, so without this the keys reach
 * nothing until the table is clicked.
 *
 *   cell  { rowIdx, setEditCell, focusAt }
 *   how   'outside' for a click elsewhere; a key or a pick otherwise
 */
export function cellEditorClosed({ rowIdx, setEditCell, focusAt }, colKey) {
    return how => {
        setEditCell(null);
        if (how !== 'outside') focusAt(rowIdx, colKey);
    };
}

/**
 * A list cell with its list open under it. A pick goes to `list.commit`; the
 * list closes as every cell's editor does (cellEditorClosed), the focus leaving
 * it counting as a click elsewhere.
 *
 *   list  listCell's view, with { options, value, pickByKey, commit }
 */
export function listEditorCell(ctx, colKey, width, list) {
    const { c, tdBase } = ctx;
    const closed = cellEditorClosed(ctx, colKey);
    return h('td', { key: colKey, title: list.title, style: tdBase(colKey, width, { color: list.color }) },
        listFace(list.text, h('span', { className: 'tf-caret tf-caret-open' })),
        h(CellList, {
            options: list.options, value: list.value, pickByKey: list.pickByKey, c,
            onCommit: value => { list.commit(value); closed('pick'); },
            onCancel: refocus => closed(refocus ? 'escape' : 'outside'),
        }));
}
