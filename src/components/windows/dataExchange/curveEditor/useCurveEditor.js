/**
 * The curve editor's state: the table and its undo history, the cell
 * selection (the shared grid's, ui/grid/useGridSelection.js) and the drag of
 * its fill handle (ui/grid/useFillDrag.js), the cell being typed into, the
 * tool panels' numbers and which panel is open, and the line of notices under
 * the table.
 *
 * The editor opens as a modal over the window that asked for it, so all of it
 * is component state and goes when the editor closes.
 */
import { fillSource } from '../../../ui/grid/gridFill.js';
import { navigationTarget } from '../../../ui/grid/gridModel.js';
import { useFillDrag } from '../../../ui/grid/useFillDrag.js';
import { useGridSelection } from '../../../ui/grid/useGridSelection.js';
import { columnKeys, gridFor } from './curveTable.js';
import {
    clearSelected, commitCellEdit, copyCells, cutCells, deleteSelectedRows, fillDragLabel, fillDragged,
    insertRowsAbove, navigateFrom, pasteCells, selectAllCells, selectColumn, selectRow, startCellEdit,
} from './editorActions.js';
import { editorKeyDown } from './editorKeys.js';
import { commitTable, redoTable, startHistory, undoTable } from './history.js';
import {
    applyTable, changeSelected, dragPoint, fillSelected, importFile, resampleAll, smoothSelected,
} from './toolActions.js';

const { useState, useRef, useCallback, useMemo } = React;

// What the tool panels start with: blank numbers to fill and change by, a step
// of one unit of the wavelength column, and the 5-point quadratic smoothing of
// Savitzky and Golay's first table. A fill's first and last value are shared
// by the modes that take them, so changing the mode keeps them.
const INITIAL_TOOLS = {
    fill: { mode: 'step', value: null, first: null, step: null, last: null },
    change: { mode: 'percent', percent: null, a: null, b: null },
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

// Escape on the table closes an open tool panel before it collapses the
// selection: the panel is what was opened last. `close` is null with no panel
// open, or while a cell is typed into, whose own editor takes the Escape.
function withPanelEscape(onKey, close) {
    if (!close) return onKey;
    return event => {
        if (event.key !== 'Escape') {
            onKey(event);
            return;
        }
        event.preventDefault();
        close();
    };
}

// The fill handle: the rectangle it sits on, its drag, and what the label by
// the pointer shows while it is dragged.
function useFillHandle(ed) {
    const { table, sel } = ed;
    const grid = gridFor(table);
    const rowCount = table.rows.length;
    const source = useMemo(
        () => fillSource(grid, { range: sel.range, extraCells: sel.extraCells, focus: sel.focusCell }, rowCount),
        [grid, sel.range, sel.extraCells, sel.focusCell, rowCount]);
    const { drag, begin } = useFillDrag({ source, onFill: (from, reach, ctrl) => fillDragged(ed, from, reach, ctrl) });
    return { source, drag, begin, label: fillDragLabel(ed, drag) };
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
    const [panel, setPanel] = useState(null);
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
    const fill = useFillHandle(ed);
    const closePanel = panel && !editCell ? () => setPanel(null) : null;
    return {
        table, sel, fill, editCell, status, tools, setTools, panel, setPanel,
        dragOn, setDragOn, sizes, setSizes, rebuild, setRebuild,
        canUndo: history.past.length > 0, canRedo: history.future.length > 0,
        actions, edit, onKeyDown: withPanelEscape(keyHandler(ed, actions, editCell), closePanel),
        apply: () => applyTable(ed, onApply, { rebuild }),
    };
}
