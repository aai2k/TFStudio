/**
 * The curve editor's state: the table and its undo history, the cell
 * selection (the shared grid's, ui/grid/useGridSelection.js), the cell being
 * typed into, the tool bar's numbers, and the line of notices under the table.
 *
 * The editor opens as a modal over the window that asked for it, so all of it
 * is component state and goes when the editor closes.
 */
import { navigationTarget } from '../../../ui/grid/gridModel.js';
import { useGridSelection } from '../../../ui/grid/useGridSelection.js';
import { columnKeys, gridFor } from './curveTable.js';
import {
    clearSelected, commitCellEdit, copyCells, cutCells, deleteSelectedRows, insertRowsAbove, navigateFrom,
    pasteCells, selectAllCells, selectColumn, selectRow, startCellEdit,
} from './editorActions.js';
import { editorKeyDown } from './editorKeys.js';
import { commitTable, redoTable, startHistory, undoTable } from './history.js';
import {
    applyTable, changeSelected, dragPoint, fillSelected, importFile, resampleAll, smoothSelected,
} from './toolActions.js';

const { useState, useRef, useCallback } = React;

// What the tool bar starts with: blank numbers to fill and change by, a step
// of one unit of the wavelength column, and the 5-point quadratic smoothing of
// Savitzky and Golay's first table.
const INITIAL_TOOLS = {
    fill: { mode: 'step', a: null, b: null },
    change: { mode: 'percent', a: null, b: null },
    step: 1,
    smooth: { window: 5, order: 2 },
};

function tableActions(ed, setHistory, setEditCell) {
    return {
        undo: () => { setHistory(undoTable); setEditCell(null); },
        redo: () => { setHistory(redoTable); setEditCell(null); },
        clear: () => clearSelected(ed),
        copy: () => copyCells(ed),
        cut: () => cutCells(ed),
        paste: () => pasteCells(ed),
        insertRows: () => insertRowsAbove(ed),
        deleteRows: () => deleteSelectedRows(ed),
        selectAll: () => selectAllCells(ed),
        selectColumn: colKey => selectColumn(ed, colKey),
        selectRow: (rowIdx, shift) => selectRow(ed, rowIdx, shift),
        startEdit: (rowIdx, colKey, initChar) => startCellEdit(ed, rowIdx, colKey, initChar),
        commitEdit: (rowIdx, colKey, draft) => commitCellEdit(ed, rowIdx, colKey, draft),
        // Escape closes the cell's editor and gives the keys back to the table.
        cancelEdit: () => { setEditCell(null); ed.sel.tableRef.current?.focus(); },
        navigate: (rowIdx, colKey, direction) => navigateFrom(ed, rowIdx, colKey, direction),
        fill: () => fillSelected(ed),
        change: () => changeSelected(ed),
        resample: () => resampleAll(ed),
        smooth: () => smoothSelected(ed),
        importFile: () => importFile(ed),
        dragPoint: (meta, result) => dragPoint(ed, meta, result),
    };
}

function keyHandler(ed, actions, editCell) {
    const keys = columnKeys(ed.table);
    const rowCount = ed.table.rows.length;
    return event => editorKeyDown({
        editCell, focusCell: ed.sel.focusCell, rowCount, range: ed.sel.range,
        stepFrom: (rowIdx, colKey, direction) =>
            navigationTarget({ rowCount, columnsOf: () => keys }, rowIdx, colKey, direction),
        extendTo: ed.sel.extendTo, focusAt: ed.sel.focusAt, collapseRange: ed.sel.collapseRange,
        navigate: actions.navigate, startEdit: actions.startEdit, actions,
    }, event);
}

/**
 * @param {object} props
 *   initialTable  the table the editor opens with (curveTable.js)
 *   onApply(table, { rebuild })  the applied table, rows by wavelength
 *   ce            t.curveEditor
 */
export function useCurveEditor({ initialTable, onApply, ce }) {
    const [history, setHistory] = useState(() => startHistory(initialTable));
    const [editCell, setEditCell] = useState(null);
    const [status, setStatus] = useState(null);
    const [tools, setTools] = useState(INITIAL_TOOLS);
    const [dragOn, setDragOn] = useState(true);
    const [sizes, setSizes] = useState([45, 55]);
    const [rebuild, setRebuild] = useState(true);
    const table = history.present;
    const live = useRef(null);
    live.current = table;
    const sel = useGridSelection(gridFor(table), {
        hasRow: rowIdx => rowIdx >= 0 && rowIdx < live.current.rows.length,
        onPick: () => sel.tableRef.current?.focus(),
    });
    const edit = useCallback(fn => {
        setHistory(current => commitTable(current, fn(current.present)));
        setStatus(null);
    }, []);
    const notify = useCallback((tone, text) => setStatus({ tone, text }), []);
    const ed = {
        table, edit, sel, setEditCell, notify, ce, tools, clipboard: globalThis.navigator?.clipboard,
    };
    const actions = tableActions(ed, setHistory, setEditCell);
    return {
        table, sel, editCell, status, tools, setTools, dragOn, setDragOn, sizes, setSizes, rebuild, setRebuild,
        canUndo: history.past.length > 0, canRedo: history.future.length > 0,
        actions, edit, onKeyDown: keyHandler(ed, actions, editCell),
        apply: () => applyTable(ed, onApply, { rebuild }),
    };
}
