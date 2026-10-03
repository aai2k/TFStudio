/**
 * The curve editor's tools: fill, change, resample and smooth the selection or
 * the table, read a file into it, drag a point, and apply. Each takes the
 * editor `ed` described in editorActions.js, with `ed.tools` holding the
 * numbers the tool panels show. A panel says why its tool cannot run, and its
 * button does nothing until it can (toolText.js), so a fill, change or
 * resample with numbers it cannot use leaves the table as it was.
 */
import { changeCells, fillCells } from './cellOps.js';
import { resampleTable, smoothCells } from './curveOps.js';
import { applyProblem } from './curveApply.js';
import { draggedCell, roundDragged } from './chartModel.js';
import { columnIndex, setCells, sortedRows } from './curveTable.js';
import { selectedOf } from './editorActions.js';
import { tableFromText } from './tableText.js';
import { changeOptions, fillOptions } from './toolText.js';

export function fillSelected(ed) {
    const cells = selectedOf(ed);
    ed.edit(table => fillCells(table, cells, fillOptions(ed.tools.fill)));
}

export function changeSelected(ed) {
    const cells = selectedOf(ed);
    ed.edit(table => changeCells(table, cells, changeOptions(ed.tools.change)));
}

/** Every column resampled onto the step in the Resample panel. */
export function resampleAll(ed) {
    const result = resampleTable(ed.table, ed.tools.step);
    if (result.problem) return;
    ed.edit(() => result.table);
    ed.sel.clearCells();
}

export function smoothSelected(ed) {
    const { window, order } = ed.tools.smooth;
    const result = smoothCells(ed.table, selectedOf(ed), { window, order });
    ed.edit(() => result.table);
    if (result.problem) ed.notify('warning', ed.ce.smoothProblems[result.problem]);
}

/** A point dropped on the plot: its cell takes the value it was dropped at. */
export function dragPoint(ed, meta, result) {
    const { rowIdx, colKey } = draggedCell(meta.opId);
    const index = columnIndex(colKey);
    const value = roundDragged(result.y0, ed.table.rows.map(row => row[index]));
    ed.edit(table => setCells(table, [{ rowIdx, colKey, value }]));
}

/** A file read into the table through the importers' file picker. */
export async function importFile(ed) {
    const result = await window.electronAPI?.spectrumPickFile?.();
    if (!result?.success) {
        if (result && !result.canceled) ed.notify('error', ed.ce.loadError(result.error || ''));
        return;
    }
    const read = tableFromText(result.text || '', ed.table, result.fileName || '');
    if (read.error) {
        ed.notify('error', ed.ce.parseError);
        return;
    }
    ed.edit(() => read.table);
    ed.sel.clearCells();
    ed.notify('info', ed.ce.loaded(result.fileName || '', read.table.rows.length));
}

/** The table handed to the window that opened the editor, rows by wavelength. */
export function applyTable(ed, onApply, options) {
    const problem = applyProblem(ed.table);
    if (problem) {
        ed.notify('error', ed.ce[problem]);
        return;
    }
    onApply({ ...ed.table, rows: sortedRows(ed.table.rows) }, options);
}
