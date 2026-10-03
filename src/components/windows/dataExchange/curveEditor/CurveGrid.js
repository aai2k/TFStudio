/**
 * The curve editor's table. Only the rows over the pane are drawn
 * (ui/virtualRows.js): a 1 nm scan from 200 to 2500 nm is 2300 rows, and an
 * imported curve opens here. Cells select, copy and paste the way the merit
 * function table's do, through the shared grid model, and the selection's
 * fill handle carries its values on down or up, as a spreadsheet's does
 * (ui/grid/useFillDrag.js).
 */
import { CellInput } from '../../../ui/grid/CellInput.js';
import { fillHandle, fillLabel, fillOutlineStyle } from '../../../ui/grid/fillHandleView.js';
import { filledRows } from '../../../ui/grid/gridFill.js';
import { useVirtualRows, virtualBody } from '../../../ui/virtualRows.js';
import { X_KEY, cellText, columnIndex, columnKeys, gridFor } from './curveTable.js';
import { valueProblem, xProblem } from './units.js';

const { createElement: h, useEffect, useRef } = React;

export const ROW_HEIGHT = 22;

// Arrow keys move a focused cell that may be outside the drawn rows, and a row
// that is not drawn cannot be scrolled to by the browser, so the pane is moved
// to it. The sticky header covers the top of the pane and is measured.
function useRowInView(paneRef, headRef, rowIdx) {
    useEffect(() => {
        const pane = paneRef.current;
        if (!pane || rowIdx == null) return;
        const header = headRef.current?.offsetHeight || 0;
        const top = rowIdx * ROW_HEIGHT;
        if (top < pane.scrollTop) pane.scrollTop = top;
        else if (header + top + ROW_HEIGHT > pane.scrollTop + pane.clientHeight) {
            pane.scrollTop = header + top + ROW_HEIGHT - pane.clientHeight;
        }
    }, [rowIdx]);
}

function cellProblem(table, colKey, value) {
    if (colKey === X_KEY) return xProblem(value);
    const column = table.columns[columnIndex(colKey) - 1];
    return valueProblem(column.quantity, column.unit, value);
}

function cellStyle(c, state) {
    const { focused, selected, problem } = state;
    return {
        height: ROW_HEIGHT, padding: '0 6px', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden',
        fontVariantNumeric: 'tabular-nums', cursor: 'cell', userSelect: 'none',
        borderBottom: `1px solid ${c.border}55`, borderRight: `1px solid ${c.border}55`,
        backgroundColor: focused ? c.accent + '66' : selected ? c.accent + '33' : 'transparent',
        outline: focused ? `1px solid ${c.accent}` : 'none', outlineOffset: -1,
        color: problem ? (c.error || '#ef5350') : c.text,
        fontWeight: problem ? 600 : 400,
    };
}

function editingCell(view, rowIdx, colKey) {
    const { editor, c } = view;
    const { actions, editCell } = editor;
    return h('td', { key: colKey, style: { height: ROW_HEIGHT, padding: '0 2px' } },
        h(CellInput, {
            initValue: editCell.initValue, typed: editCell.typed, c,
            onCommit: draft => actions.commitEdit(rowIdx, colKey, draft),
            onCancel: actions.cancelEdit,
            onNavigate: direction => actions.navigate(rowIdx, colKey, direction),
        }));
}

// A cell's part in the fill handle: its piece of the outline while a drag is
// on, and the handle itself on the selection's corner cell.
function fillPart(view, rowIdx, colKey) {
    const { fill, c, ce } = view;
    const outline = fillOutlineStyle(c, fill.outline, rowIdx, colKey);
    const corner = fill.handle?.rowIdx === rowIdx && fill.handle.colKey === colKey;
    if (!corner) return { style: outline, handle: null };
    return { style: { ...outline, position: 'relative' }, handle: fillHandle(c, ce.fillHandleTip, fill.begin) };
}

function valueCell(view, row, rowIdx, colKey, selectedColumns) {
    const { editor, c, ce, table } = view;
    const { sel, actions, editCell } = editor;
    if (editCell?.rowIdx === rowIdx && editCell.colKey === colKey) return editingCell(view, rowIdx, colKey);
    const value = row[columnIndex(colKey)];
    const problem = cellProblem(table, colKey, value);
    const focused = sel.focusCell?.rowIdx === rowIdx && sel.focusCell.colKey === colKey;
    const fill = fillPart(view, rowIdx, colKey);
    return h('td', {
        key: colKey,
        title: problem ? ce.cellProblems[problem] : undefined,
        onMouseDown: event => sel.pressCell(rowIdx, colKey, event),
        onMouseEnter: () => sel.dragOver(rowIdx, colKey),
        onDoubleClick: () => actions.startEdit(rowIdx, colKey, null),
        style: { ...cellStyle(c, { focused, selected: !!selectedColumns?.includes(colKey), problem }), ...fill.style },
    }, cellText(value), fill.handle);
}

function tableRow(view, row, rowIdx) {
    const { editor, c, keys, grid } = view;
    const selectedColumns = grid.selectedColumnsForRow(
        { range: editor.sel.range, extraCells: editor.sel.extraCells }, rowIdx);
    return h('tr', { key: rowIdx, style: { height: ROW_HEIGHT } },
        h('td', {
            onMouseDown: event => { event.preventDefault(); editor.actions.selectRow(rowIdx, event.shiftKey); },
            style: {
                padding: '0 6px', textAlign: 'right', color: c.textDim, fontSize: 10, userSelect: 'none',
                cursor: 'e-resize', borderBottom: `1px solid ${c.border}55`, background: c.bg,
            },
        }, rowIdx + 1),
        keys.map(colKey => valueCell(view, row, rowIdx, colKey, selectedColumns)));
}

// A row past the table's end, drawn while the fill handle is dragged; the
// fill adds it on release if the fill reaches it.
function blankRow(view, rowIdx) {
    const { c, keys, fill } = view;
    return h('tr', { key: rowIdx, style: { height: ROW_HEIGHT } },
        h('td', { style: { background: c.bg } }),
        keys.map(colKey => h('td', {
            key: colKey, style: { height: ROW_HEIGHT, padding: 0, ...fillOutlineStyle(c, fill.outline, rowIdx, colKey) },
        })));
}

// While the fill handle is dragged, empty rows are drawn under the table down
// to the fill's reach and a pane's height beyond it, so the pointer can go
// below the last row and the pane can scroll on.
function drawnRows(rows, drag) {
    if (!drag) return rows;
    const reached = drag.reach && !drag.reach.up ? filledRows(drag.source, drag.reach).last + 1 : 0;
    const count = Math.max(rows.length, reached) + drag.blankRows;
    return rows.concat(new Array(count - rows.length).fill(null));
}

// What the cells need of the fill handle: the corner it sits on, unless a cell
// is being typed into, the press that starts its drag, and the outline of the
// cells a drag in progress will fill.
function fillView(editor, begin) {
    const { source, drag } = editor.fill;
    const handle = source && !editor.editCell
        ? { rowIdx: source.rowEnd, colKey: source.colKeys[source.colKeys.length - 1] } : null;
    const outline = drag?.reach ? { ...filledRows(drag.source, drag.reach), colKeys: drag.source.colKeys } : null;
    return { handle, outline, begin };
}

function headerCell(c, key, label, onMouseDown) {
    return h('th', {
        key, title: label, onMouseDown,
        style: {
            position: 'sticky', top: 0, zIndex: 1, background: c.panel, color: c.textDim,
            padding: '4px 6px', fontSize: 10.5, fontWeight: 600, textAlign: 'right',
            borderBottom: `1px solid ${c.border}`, whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis', cursor: 'pointer', userSelect: 'none',
        },
    }, label);
}

/**
 * A click on the # heading selects every cell, on a column's heading the
 * column, and on a row's number the row.
 *
 *   editor   useCurveEditor.js
 *   labels   { header(colKey) }, the column headings
 */
export function CurveGrid({ editor, labels, c, ce }) {
    const { table, sel, editCell, fill } = editor;
    const keys = columnKeys(table);
    const items = drawnRows(table.rows, fill.drag);
    const virtual = useVirtualRows(items.length, ROW_HEIGHT);
    const headRef = useRef(null);
    useRowInView(virtual.paneRef, headRef, sel.focusCell?.rowIdx);
    const beginFill = event => fill.begin(event, {
        pane: virtual.paneRef.current, header: headRef.current?.offsetHeight || 0, rowHeight: ROW_HEIGHT,
    });
    const view = { editor, c, ce, table, keys, grid: gridFor(table), fill: fillView(editor, beginFill) };
    const pick = handler => event => { event.preventDefault(); handler(); };
    return h('div', {
        ref: sel.tableRef, tabIndex: 0, onKeyDown: editor.onKeyDown,
        style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none' },
    },
        h('div', {
            ref: virtual.paneRef, onScroll: virtual.onScroll,
            style: { flex: 1, minHeight: 0, overflow: 'auto' },
        },
            h('table', {
                style: {
                    width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 11.5,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                },
            },
                h('colgroup', null,
                    h('col', { style: { width: 46 } }),
                    keys.map(colKey => h('col', { key: colKey }))),
                h('thead', { ref: headRef },
                    h('tr', null,
                        headerCell(c, 'all', '#', pick(editor.actions.selectAll)),
                        keys.map(colKey => headerCell(c, colKey, labels.header(colKey),
                            pick(() => editor.actions.selectColumn(colKey)))))),
                h('tbody', null, virtualBody(items,
                    { first: virtual.first, end: virtual.end, keep: editCell?.rowIdx ?? -1 },
                    ROW_HEIGHT, keys.length + 1,
                    (row, rowIdx) => (row ? tableRow(view, row, rowIdx) : blankRow(view, rowIdx)))),
            ),
        ),
        fillLabel(c, fill.drag, fill.label),
    );
}
