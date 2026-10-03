/**
 * The curve editor table's keys. Moving the selection is the shared grid's
 * (ui/grid/gridKeys.js); the rest is a spreadsheet's:
 *
 *   Enter, F2         type into the focused cell; a typed character does too
 *   Delete            delete the rows of the selected cells
 *   Backspace         empty the selected cells
 *   Insert            insert rows above the selection
 *   Ctrl+C, X, V      copy, cut, paste
 *   Ctrl+Z, Ctrl+Y    undo, redo (Ctrl+Shift+Z redoes too)
 *   Ctrl+A            select every cell
 *
 * Chords are read by the character the layout gives, so they work on a
 * Cyrillic keyboard and with Caps Lock on (utils/misc/keyChords.js).
 */
import { ctrlChordChar } from '../../../../utils/misc/keyChords.js';
import {
    beginEdit, collapseRange, isPrintableEditKey, isTextControl, moveHorizontal, moveTab, moveVertical,
} from '../../../ui/grid/gridKeys.js';
import { X_KEY } from './curveTable.js';

export function editorCombo(event) {
    const chord = ctrlChordChar(event);
    if (chord) return `${event.shiftKey ? 'Ctrl+Shift+' : 'Ctrl+'}${chord}`;
    return event.key === 'F2' ? 'Enter' : event.key;
}

const run = name => ctx => {
    ctx.event.preventDefault();
    ctx.actions[name]();
};

const EDITOR_KEYS = {
    ArrowDown: ctx => moveVertical(ctx, 1),
    ArrowUp: ctx => moveVertical(ctx, -1),
    ArrowRight: ctx => moveHorizontal(ctx, 'right'),
    ArrowLeft: ctx => moveHorizontal(ctx, 'left'),
    Tab: moveTab,
    Enter: beginEdit,
    Escape: collapseRange,
    Delete: run('deleteRows'),
    Backspace: run('clear'),
    Insert: run('insertRows'),
    'Ctrl+c': run('copy'),
    'Ctrl+x': run('cut'),
    'Ctrl+v': run('paste'),
    'Ctrl+z': run('undo'),
    'Ctrl+y': run('redo'),
    'Ctrl+Shift+z': run('redo'),
    'Ctrl+a': run('selectAll'),
};

/**
 * A key pressed on the table. `ctx` carries the focused cell, the table's row
 * count and column keys, the selection's handlers and the editor's actions.
 * With no cell focused the keys act from the first cell. Keys typed into a
 * cell's editor or another field belong to it, and so do keys on a button in
 * the heading: Enter on + Column adds a column rather than opening a cell.
 */
export function editorKeyDown(ctx, event) {
    if (ctx.editCell || isTextControl(event.target) || event.target?.tagName === 'BUTTON') return;
    const rowIdx = ctx.focusCell?.rowIdx ?? 0;
    const colKey = ctx.focusCell?.colKey ?? X_KEY;
    const keyCtx = { ...ctx, event, rowIdx, colKey, stepTarget: direction => ctx.stepFrom(rowIdx, colKey, direction) };
    const action = EDITOR_KEYS[editorCombo(event)];
    if (action) action(keyCtx);
    else if (isPrintableEditKey(event) && ctx.rowCount > 0) {
        event.preventDefault();
        ctx.startEdit(rowIdx, colKey, event.key);
    }
}
