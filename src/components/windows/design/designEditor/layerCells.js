/**
 * The layer table as a grid of cells: the row number, then Material and the
 * four thickness columns.
 *
 * The focus on a row number selects whole layers, which copy and paste as
 * layers. The focus on a cell selects cells, which copy as text and take pasted
 * material names and thicknesses. A rectangle of cells, the text it copies as
 * and where a pasted block lands are the shared grid's (ui/grid/gridModel.js).
 *
 * A cell is named `{ id, column }` by its layer's id, so it stays on its layer
 * when rows are added or moved. The grid's rows are the table's rows in the
 * order shown.
 */
import { createGridModel, parseCellGrid } from '../../../ui/grid/gridModel.js';
import { LAYER_THICKNESS_COLUMNS } from './layerTableLayout.js';
import { nmToUnit, thicknessEntryToNm, thicknessText } from './units.js';

export const ROW_NUMBER = 'number';
export const MATERIAL = 'material';

/** The columns a rectangle of cells can span, in table order. */
export const LAYER_CELL_COLUMNS = Object.freeze([MATERIAL, ...LAYER_THICKNESS_COLUMNS.map(column => column.unit)]);

const ROW_COLUMNS = [ROW_NUMBER, ...LAYER_CELL_COLUMNS];

export const LAYER_GRID = createGridModel(LAYER_CELL_COLUMNS);

export const isCellColumn = column => LAYER_CELL_COLUMNS.includes(column);

/**
 * The column a Left or Right arrow moves the focus to, stopping at the row
 * number and at FW. With `extend`, a Shift arrow stretching a rectangle of
 * cells, it stops at Material: a rectangle never takes in the row number.
 */
export function sidewaysColumn(column, delta, extend = false) {
    const columns = extend ? LAYER_CELL_COLUMNS : ROW_COLUMNS;
    const index = columns.indexOf(column);
    if (index < 0) return column;
    return columns[Math.max(0, Math.min(columns.length - 1, index + delta))];
}

function gridCell(rows, cell) {
    return { rowIdx: rows.findIndex(row => row.id === cell.id), colKey: cell.column };
}

/**
 * The rectangle of cells from `anchor` to `focus`, as the grid holds one, or
 * null when they are the same cell or either is not a cell of `rows`.
 */
export function layerCellRange(rows, anchor, focus) {
    if (!anchor || !focus) return null;
    const from = gridCell(rows, anchor);
    const to = gridCell(rows, focus);
    if (from.rowIdx < 0 || to.rowIdx < 0) return null;
    return LAYER_GRID.cellRange(from, to);
}

/**
 * A cell's text: the material's name, or the thickness in the column's unit as
 * the cell shows it. `view` is `{ refLambda, designMaterials, materialName }`.
 */
export function layerCellText(layer, column, view) {
    if (column === MATERIAL) return view.materialName(layer.material);
    const value = nmToUnit(layer.thickness, layer.material, view.refLambda, column, view.designMaterials);
    return thicknessText(value, column);
}

/**
 * The selected cells as tab-separated text, one line per row: the rectangle,
 * or the focused cell alone.
 */
export function copiedCellText(rows, { range, focus }, view) {
    const text = (layer, column) => layerCellText(layer, column, view);
    if (range) return LAYER_GRID.rangeText(rows, range, text);
    const layer = rows.find(row => row.id === focus.id);
    return layer && isCellColumn(focus.column) ? text(layer, focus.column) : '';
}

// What one pasted value does to its layer's `edit`: on Material, the material
// its name stands for; elsewhere a thickness, read in the column's unit at the
// layer's material, the one pasted beside it if any. A locked layer keeps its
// thickness, as it does against typing; its material can still change. Text
// that names no material or is not a thickness changes nothing.
function applyPasted(edit, layer, target, view) {
    if (target.colKey === MATERIAL) {
        const material = view.materialFor(target.text);
        if (material) edit.material = material;
        return;
    }
    if (layer.locked) return;
    const material = edit.material || layer.material;
    const nm = thicknessEntryToNm(target.text, material, view.refLambda, target.colKey, view.designMaterials);
    if (nm != null) edit.thickness = nm;
}

/**
 * The changes, by layer id, that pasting `text` over the cells makes: a
 * `material` id and a `thickness` in nm, either or both.
 *
 * The text lands as the grid lays it: from the focused cell down and to the
 * right with what falls past the last row dropped, or repeated to fill a
 * rectangle. `view.materialFor(text)` names the material a pasted name stands
 * for (pastedMaterial.js).
 */
export function pastedEdits(rows, text, { range, focus, ...view }) {
    const edits = new Map();
    const from = gridCell(rows, focus);
    if (!range && from.rowIdx < 0) return edits;
    const targets = LAYER_GRID.pasteTargets({ grid: parseCellGrid(text), range, focus: from, rows });
    for (const target of targets) {
        const layer = rows[target.rowIdx];
        const edit = edits.get(layer.id) || {};
        applyPasted(edit, layer, target, view);
        if (Object.keys(edit).length) edits.set(layer.id, edit);
    }
    return edits;
}

/** `layers` with `edits` made, or null when they change none of them. */
export function withEdits(layers, edits) {
    let changed = false;
    const next = layers.map(layer => {
        const edit = edits.get(layer.id);
        if (!edit || Object.entries(edit).every(([key, value]) => layer[key] === value)) return layer;
        changed = true;
        return { ...layer, ...edit };
    });
    return changed ? next : null;
}
