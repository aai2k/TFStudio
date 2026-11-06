/**
 * Operand cells on the clipboard: what a cell copies as, and the edits a pasted
 * block of text makes. Where a block lands is the shared grid's rule
 * (ui/grid/gridModel.js); what a cell accepts is the operand's own.
 */
import { parseCellGrid } from '../../../../ui/grid/gridModel.js';
import { cellEdit, cellInitialText } from './editModel.js';
import { looksLikeOperandRows, parseOperandsTsv } from './operandClipboard.js';
import { editableColsForRow } from './operandViewModel.js';
import { MF_GRID, RANGE_COLUMNS, pasteTargets, selectedCells } from './selectionModel.js';

const CELL_TEXT_COLUMNS = new Set(RANGE_COLUMNS);

/**
 * What Ctrl+C and Ctrl+V act on: 'cell', 'rows' or 'none'. A focused value
 * cell copies and pastes its own value while no more than its own row is
 * selected. Rows are the unit when they are selected as rows, from the #
 * column or by the focus landing on a header or comment row, and when more
 * than one row is selected.
 *
 * A focused cell that holds no value copies and pastes nothing: the on/off
 * mark, the computed columns, and the dash a row shows in a column its operand
 * type does not carry (a thickness constraint has no angle, a measured curve
 * no target). Copying the whole row from one of them would put more on the
 * clipboard than the cell shows.
 */
export function clipboardScope({ op, focusCell, selectedIds }) {
    if (!focusCell) return 'rows';
    const holdsValue = CELL_TEXT_COLUMNS.has(focusCell.colKey)
        && (!op || editableColsForRow(op).includes(focusCell.colKey));
    if (!holdsValue) return selectedIds.size > 0 ? 'rows' : 'none';
    return selectedIds.size > 1 ? 'rows' : 'cell';
}

/** The text a cell copies; see cellInitialText in editModel.js. */
export const cellText = cellInitialText;

// One cell's text, for the grid's copy below.
function textOfCell(operands, isMathPct, integralPresets) {
    const table = { operands, integralPresets };
    return (op, colKey) => cellText(op, colKey, isMathPct(op), table);
}

/** A rectangle of operand cells as tab-separated lines; see gridModel.js. */
export function rangeText(operands, range, isMathPct, integralPresets) {
    return MF_GRID.rangeText(operands, range, textOfCell(operands, isMathPct, integralPresets));
}

/** Operand cells that are not one rectangle as text; see gridModel.js. */
export function selectionText(operands, selection, isMathPct, integralPresets) {
    return MF_GRID.selectionText(operands, selection, textOfCell(operands, isMathPct, integralPresets));
}

export function copyCellText(text, clipboard = navigator.clipboard) {
    clipboard?.writeText(text).catch(() => {});
}

/**
 * The edits a grid of text makes to the table: one entry per target cell, in
 * the form the window's edit callback takes. Text a cell cannot hold is skipped.
 */
export function gridEdits({ grid, range, focus, operands, integralPresets, cells, text }) {
    const edits = [];
    const targets = cells
        ? cells.map(cell => ({ ...cell, text }))
        : pasteTargets({ grid, range, focus, operands });
    for (const target of targets) {
        const op = operands[target.rowIdx];
        const edit = cellEdit(op, target.colKey, target.text, { operands, integralPresets });
        if (edit) edits.push({ id: op.id, key: edit[0], value: edit[1] });
    }
    return edits;
}

function applyEdits(ctx, edits) {
    if (edits.length === 0) return;
    if (ctx.onEditMany) ctx.onEditMany(edits);
    else edits.forEach(edit => ctx.onEdit(edit.id, edit.key, edit.value));
}

/**
 * Paste into the focused cell or over the selected range. A single value into
 * a single cell goes through the cell editor's own commit, so percent and ramp
 * syntax apply. Operand rows, as Ctrl+C on rows writes them, are inserted below
 * the focused row unless a range is selected. Any other grid of values is laid
 * over the range, or from the focused cell down and to the right.
 */
export function pasteIntoCell(ctx, clipboard = navigator.clipboard) {
    clipboard?.readText().then(raw => {
        const grid = parseCellGrid(raw);
        const single = grid.length === 1 && grid[0].length === 1;
        if (single && grid[0][0] === '') return;
        const { operands, integralPresets } = ctx;
        // Cells gathered with Ctrl take one value each, whatever their shape.
        if (single && ctx.extraCells?.size) {
            const cells = selectedCells({
                range: ctx.range, extraCells: ctx.extraCells, focus: { rowIdx: ctx.rowIdx, colKey: ctx.colKey },
            });
            applyEdits(ctx, gridEdits({ grid, range: null, focus: null, operands, integralPresets, cells, text: grid[0][0] }));
            return;
        }
        if (!ctx.range && single) {
            ctx.commitEdit(ctx.rowIdx, ctx.colKey, grid[0][0]);
            return;
        }
        if (!ctx.range && looksLikeOperandRows(grid)) {
            const items = parseOperandsTsv(raw);
            if (items.length) ctx.onAdd(items, ctx.rowIdx + 1);
            return;
        }
        applyEdits(ctx, gridEdits({
            grid, range: ctx.range || null, focus: { rowIdx: ctx.rowIdx, colKey: ctx.colKey }, operands, integralPresets,
        }));
    }).catch(() => {});
}
