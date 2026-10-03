/**
 * What the curve editor's table does on a key, a click or a paste: typing
 * into a cell, moving through the table, the clipboard, rows and selections.
 *
 * Each action takes the editor `ed` that useCurveEditor.js builds every render:
 *   table        the table on screen
 *   edit(fn)     commit fn(table) to the undo history
 *   sel          the grid selection (ui/grid/useGridSelection.js)
 *   setEditCell  open or close a cell's text editor
 *   notify(tone, text)  the line under the table
 *   ce           the editor's strings
 *   clipboard    the system clipboard
 */
import { parseNumberStrict } from '../../../../utils/misc/numberParsing.js';
import { continuedCells, filledRows } from '../../../ui/grid/gridFill.js';
import { navigationTarget } from '../../../ui/grid/gridModel.js';
import {
    X_KEY, cellText, clearCells, columnIndex, columnKeys, deleteRows, gridFor, insertRows, setCells, tidy,
    withRowCount,
} from './curveTable.js';
import { pasteIntoTable, readPastedText } from './tableText.js';

/** The selected cells in table order, or the focused one alone. */
export function selectedOf(ed) {
    const { range, extraCells, focusCell } = ed.sel;
    return gridFor(ed.table).selectedCells({ range, extraCells, focus: focusCell })
        .filter(cell => cell.rowIdx < ed.table.rows.length);
}

/**
 * A typed cell: a number in either decimal mark, or nothing to empty it. Text
 * that is not a number leaves the cell as it was and says so.
 */
export function typeIntoCell(ed, rowIdx, colKey, draft) {
    const text = String(draft ?? '').trim();
    const value = text === '' ? NaN : parseNumberStrict(text);
    if (text !== '' && !Number.isFinite(value)) {
        ed.notify('error', ed.ce.notNumber(text));
        return;
    }
    ed.edit(table => setCells(table, [{ rowIdx, colKey, value }]));
}

export function startCellEdit(ed, rowIdx, colKey, initChar) {
    const row = ed.table.rows[rowIdx];
    if (!row) return;
    ed.sel.place(rowIdx, colKey);
    const typed = initChar != null;
    ed.setEditCell({ rowIdx, colKey, typed, initValue: typed ? initChar : cellText(row[columnIndex(colKey)]) });
}

export function commitCellEdit(ed, rowIdx, colKey, draft) {
    ed.setEditCell(null);
    typeIntoCell(ed, rowIdx, colKey, draft);
}

/**
 * The move an arrow, Tab or Enter makes from a cell. Enter or the down arrow
 * from a cell being typed into on the last row adds a row below it, so a
 * curve can be typed in one column without reaching for the mouse.
 */
export function navigateFrom(ed, rowIdx, colKey, direction) {
    const keys = columnKeys(ed.table);
    const target = navigationTarget(
        { rowCount: ed.table.rows.length, columnsOf: () => keys }, rowIdx, colKey, direction);
    if (target?.focus) ed.sel.focusAt(target.rowIdx, target.colKey);
    else if (target) ed.sel.place(target.rowIdx, target.colKey);
    else if (direction === 'down' && rowIdx === ed.table.rows.length - 1) {
        ed.edit(table => insertRows(table, table.rows.length, 1));
        ed.sel.place(rowIdx + 1, colKey);
    }
}

const textOfCell = (row, colKey) => cellText(row[columnIndex(colKey)]);

/** The selection as tab-separated text, the way a spreadsheet copies it. */
export function selectionText(ed) {
    const grid = gridFor(ed.table);
    const { range, extraCells, focusCell } = ed.sel;
    if (extraCells?.size) return grid.selectionText(ed.table.rows, { range, extraCells, focus: focusCell }, textOfCell);
    if (range) return grid.rangeText(ed.table.rows, range, textOfCell);
    const row = focusCell && ed.table.rows[focusCell.rowIdx];
    return row ? textOfCell(row, focusCell.colKey) : '';
}

export function copyCells(ed) {
    ed.clipboard?.writeText(selectionText(ed)).catch(() => {});
}

export function clearSelected(ed) {
    const cells = selectedOf(ed);
    if (cells.length) ed.edit(table => clearCells(table, cells));
}

export function cutCells(ed) {
    copyCells(ed);
    clearSelected(ed);
}

/** A pasted text laid on the table at the selection; see pasteIntoTable. */
export function pasteText(ed, text, selection) {
    const pasted = readPastedText(text || '');
    if (!pasted.grid.length) {
        ed.notify('warning', ed.ce.pasteEmpty);
        return;
    }
    ed.edit(table => pasteIntoTable(table, pasted, selection));
}

export function pasteCells(ed) {
    const { range, extraCells, focusCell } = ed.sel;
    const selection = { range, extraCells, focus: focusCell || { rowIdx: 0, colKey: X_KEY } };
    ed.clipboard?.readText().then(text => pasteText(ed, text, selection)).catch(() => {});
}

// The rows the selection touches, in order.
function selectedRows(ed) {
    return [...new Set(selectedOf(ed).map(cell => cell.rowIdx))].sort((a, b) => a - b);
}

/** As many empty rows as the selection spans, above it; one at the end with nothing selected. */
export function insertRowsAbove(ed) {
    const rows = selectedRows(ed);
    const at = rows.length ? rows[0] : ed.table.rows.length;
    ed.edit(table => insertRows(table, at, Math.max(1, rows.length)));
}

export function deleteSelectedRows(ed) {
    const rows = selectedRows(ed);
    if (!rows.length) return;
    ed.edit(table => deleteRows(table, rows));
    ed.sel.clearCells();
}

function lastCell(ed) {
    const keys = columnKeys(ed.table);
    return { rowIdx: ed.table.rows.length - 1, colKey: keys[keys.length - 1] };
}

export function selectAllCells(ed) {
    const last = lastCell(ed);
    if (last.rowIdx >= 0) ed.sel.selectRange({ rowIdx: 0, colKey: X_KEY }, last);
}

/** A click on a column's header selects the column. */
export function selectColumn(ed, colKey) {
    const last = ed.table.rows.length - 1;
    if (last >= 0) ed.sel.selectRange({ rowIdx: 0, colKey }, { rowIdx: last, colKey });
}

/** A click on a row's number selects the row; with Shift, the rows from the anchor's. */
export function selectRow(ed, rowIdx, shift) {
    const from = shift && ed.sel.anchorCell ? ed.sel.anchorCell.rowIdx : rowIdx;
    ed.sel.selectRange({ rowIdx: from, colKey: X_KEY }, { ...lastCell(ed), rowIdx });
}

// The cells a fill handle dragged from `source` to `reach` writes, by the
// shared grid's series rules (ui/grid/gridFill.js), each value tidied so the
// binary rounding of a step of 0.1 does not show in the cells.
function draggedCells(ed, source, reach, ctrl) {
    const read = (rowIdx, colKey) => ed.table.rows[rowIdx]?.[columnIndex(colKey)];
    return continuedCells(source, reach, read, ctrl).map(cell => ({ ...cell, value: tidy(cell.value) }));
}

/**
 * The fill handle released: the values written as one edit, rows added below
 * the last for a fill that runs past it, and the selection grown over the
 * filled cells. A selection with no number in it fills nothing.
 */
export function fillDragged(ed, source, reach, ctrl) {
    const cells = draggedCells(ed, source, reach, ctrl);
    if (!cells.length) return;
    const { first, last } = filledRows(source, reach);
    ed.edit(table => setCells(withRowCount(table, last + 1), cells));
    const columns = source.colKeys;
    const [from, to] = reach.up ? [source.rowEnd, first] : [source.rowStart, last];
    ed.sel.placeRange({ rowIdx: from, colKey: columns[0] }, { rowIdx: to, colKey: columns[columns.length - 1] });
    // The handle's press kept focus where it was, perhaps on a tool button, and
    // Ctrl+Z after a fill must reach the table.
    ed.sel.tableRef.current?.focus();
}

/** What the farthest filled row will hold, in column order, for the label by the pointer. */
export function fillDragLabel(ed, drag) {
    if (!drag?.reach) return [];
    const { first, last } = filledRows(drag.source, drag.reach);
    const far = drag.reach.up ? first : last;
    return draggedCells(ed, drag.source, drag.reach, drag.ctrl)
        .filter(cell => cell.rowIdx === far)
        .map(cell => cellText(cell.value));
}
