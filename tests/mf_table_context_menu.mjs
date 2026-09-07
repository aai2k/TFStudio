import assert from 'node:assert/strict';
import {
    contextMenuItems, menuScope, menuTargetFromEvent,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/contextMenuModel.js';
import { COLS } from '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandViewModel.js';
import { doKeyDown, isTextControl } from '../src/components/windows/optimization/meritFunctionEditor/mfTable/tableKeyboard.js';

// ── Where a right-click landed ────────────────────────────────────────────────

// A built row names the operand it stands for, which is what the menu reads:
// only the rows on screen exist, so a row's DOM position is not its index.
function cellEvent(cellIndex, rowIdx, tagName = 'TD', dataset = {}) {
    const cell = { cellIndex, parentElement: { dataset: { row: String(rowIdx) } } };
    return { target: { tagName, dataset, closest: sel => (sel === 'td' ? cell : null) } };
}
assert.deepEqual(menuTargetFromEvent(cellEvent(7, 3), COLS), { rowIdx: 3, colKey: 'target', rowInput: false });
assert.deepEqual(menuTargetFromEvent(cellEvent(0, 0), COLS), { rowIdx: 0, colKey: 'num', rowInput: false });
assert.deepEqual(menuTargetFromEvent(cellEvent(2, 1), COLS), { rowIdx: 1, colKey: 'type', rowInput: false },
    'a DMFS or comment row spans its columns from the Type cell');
assert.equal(menuTargetFromEvent({ target: { tagName: 'DIV', closest: () => null } }, COLS), null,
    'the empty area below the rows has no target');
assert.equal(menuTargetFromEvent(cellEvent(3, 2, 'INPUT'), COLS), null,
    'a text control keeps the browser menu, which is where paste into it lives');
// A dropdown has no menu of its own to keep, so Pol, the comparison, the
// integral preset and the reference cells open the operand menu like any other.
assert.deepEqual(menuTargetFromEvent(cellEvent(6, 2, 'SELECT'), COLS),
    { rowIdx: 2, colKey: 'pol', rowInput: false },
    'a dropdown cell opens the operand menu');
assert.deepEqual(menuTargetFromEvent(cellEvent(3, 2, 'INPUT', { rowMenu: 'comment' }), COLS),
    { rowIdx: 2, colKey: 'lambdaStart', rowInput: true },
    'the comment input is the whole row, so it opens the operand menu');
assert.equal(menuTargetFromEvent({ target: { tagName: 'TH', closest: () => null } }, COLS), null);

// A row far down a windowed table is the operand it names, not the position it
// happens to hold among the handful of rows built around it.
assert.deepEqual(menuTargetFromEvent(cellEvent(7, 3617), COLS),
    { rowIdx: 3617, colKey: 'target', rowInput: false });

// The spacer standing in for the rows off screen names no operand, so a click
// on it acts on nothing.
{
    const spacer = { cellIndex: 0, parentElement: { dataset: {} } };
    assert.equal(menuTargetFromEvent(
        { target: { tagName: 'TD', dataset: {}, closest: () => spacer } }, COLS), null);
}

// A header or comment row never offers a cell to copy; other rows follow the
// keyboard's rule.
assert.equal(menuScope({ type: 'BLNK' }, 'lambdaStart', new Set()), 'rows');
assert.equal(menuScope({ type: 'DMFS' }, 'target', new Set()), 'rows');
assert.equal(menuScope({ type: 'R' }, 'target', new Set()), 'cell');
assert.equal(menuScope({ type: 'R' }, 'type', new Set()), 'rows');
assert.equal(menuScope({ type: 'R' }, 'target', new Set(['a', 'b'])), 'rows');

// A column the row does not carry shows a dash. There is nothing there to copy
// and nothing that may be pasted over, so the row is the unit.
assert.equal(menuScope({ type: 'MNT' }, 'aoi', new Set()), 'rows',
    'a thickness constraint has no angle to copy');
assert.equal(menuScope({ type: 'MNT' }, 'target', new Set()), 'cell',
    'but its own thickness is still a cell');

// ── The menu ─────────────────────────────────────────────────────────────────

const calls = [];
const actions = {
    copyCell: () => calls.push('copyCell'),
    pasteCell: () => calls.push('pasteCell'),
    cutRows: () => calls.push('cut'),
    copyRows: () => calls.push('copy'),
    pasteRows: () => calls.push('paste'),
    insertAt: index => calls.push(`insert@${index}`),
    duplicate: () => calls.push('duplicate'),
    deleteRows: () => calls.push('delete'),
};
const te = {
    contextMenu: {
        copyCell: 'Copy cell', pasteCell: 'Paste cell',
        cutOperand: n => (n > 1 ? `Cut ${n}` : 'Cut'), copyOperand: n => (n > 1 ? `Copy ${n}` : 'Copy'),
        pasteOperand: 'Paste', insertOperand: 'Insert', insertOperandAfter: 'Insert after',
        duplicateOperand: n => (n > 1 ? `Dup ${n}` : 'Dup'), deleteOperand: n => (n > 1 ? `Delete ${n}` : 'Delete'),
    },
};

const cellMenu = contextMenuItems({ te, scope: 'cell', rowIdx: 4, selectedCount: 1, actions });
assert.deepEqual(cellMenu.filter(item => !item.separator).map(item => item.label),
    ['Copy cell', 'Paste cell', 'Cut', 'Copy', 'Paste', 'Insert', 'Insert after', 'Dup', 'Delete']);
assert.equal(cellMenu.find(item => item.id === 'delete').danger, true);
// The shortcut shown follows the scope: Ctrl+C copies the cell here, so the
// row entry does not claim it too.
assert.equal(cellMenu.find(item => item.id === 'copyCell').shortcut, 'Ctrl+C');
assert.equal(cellMenu.find(item => item.id === 'copy').shortcut, undefined);
assert.equal(cellMenu.find(item => item.id === 'cut').shortcut, 'Ctrl+X');
assert.equal(cellMenu.find(item => item.id === 'insertAfter').shortcut, 'Shift+Insert');
assert.equal(cellMenu.find(item => item.id === 'duplicate').shortcut, 'Ctrl+D');
assert.equal(cellMenu.find(item => item.id === 'delete').shortcut, 'Del');
assert.ok(cellMenu.every(item => item.separator || !item.icon), 'no entry carries an icon, so the menu has no icon gutter');

const rowMenu = contextMenuItems({ te, scope: 'rows', rowIdx: 4, selectedCount: 3, actions });
assert.deepEqual(rowMenu.filter(item => !item.separator).map(item => item.label),
    ['Cut 3', 'Copy 3', 'Paste', 'Insert', 'Insert after', 'Dup 3', 'Delete 3'],
    'a row click offers no cell entries and counts the selection');
assert.equal(rowMenu.find(item => item.id === 'copy').shortcut, 'Ctrl+C');
assert.equal(rowMenu.find(item => item.id === 'paste').shortcut, 'Ctrl+V');

for (const item of rowMenu) if (!item.separator) item.onClick();
assert.deepEqual(calls, ['cut', 'copy', 'paste', 'insert@4', 'insert@5', 'duplicate', 'delete'],
    'insert goes above the clicked row, insert after goes below it');

// ── Typing in a text control is not a cell edit ───────────────────────────────
//
// The table's keydown listener starts editing the focused cell on any printable
// key. A key typed into a comment row's input bubbles to that listener too, and
// used to land in whichever cell was focused last.
assert.equal(isTextControl({ tagName: 'INPUT' }), true);
assert.equal(isTextControl({ tagName: 'SELECT' }), true);
assert.equal(isTextControl({ tagName: 'TD' }), false);
assert.equal(isTextControl(null), false);

const edits = [];
const ctx = {
    editCell: null, focusCell: { rowIdx: 0, colKey: 'weight' }, selectedIds: new Set(),
    operands: [{ id: 'a', type: 'R' }], startEdit: (...args) => edits.push(args),
};
const key = (target) => ({ key: 'x', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, target, preventDefault() {} });
doKeyDown(ctx, key({ tagName: 'INPUT' }));
doKeyDown(ctx, key({ tagName: 'SELECT' }));
doKeyDown(ctx, key({ tagName: 'TD' }));
assert.deepEqual(edits, [[0, 'weight', 'x']], 'only the key typed on the table itself opens the cell editor');

// A dropdown takes the keys it uses itself, but Delete and the clipboard mean
// nothing to a closed one, so the table keeps them: a row stays deletable while
// its Pol cell holds focus.
{
    const deleted = [];
    const rowCtx = {
        editCell: null, focusCell: { rowIdx: 0, colKey: 'pol' }, selectedIds: new Set(['a']),
        operands: [{ id: 'a', type: 'R' }], startEdit: () => {},
        onDelete: ids => deleted.push(ids), setSelIds() {}, setFocusCell() {},
    };
    const press = (k, target, ctrlKey = false) => doKeyDown(rowCtx,
        { key: k, shiftKey: false, ctrlKey, altKey: false, metaKey: false, target, preventDefault() {} });
    press('Delete', { tagName: 'SELECT' });
    assert.deepEqual(deleted, [['a']], 'Delete reaches the table from a dropdown cell');
    press('Delete', { tagName: 'INPUT' });
    assert.equal(deleted.length, 1, 'but never from a text input');
    press('ArrowDown', { tagName: 'SELECT' });
    assert.equal(rowCtx.focusCell.rowIdx, 0, 'arrows stay with the dropdown, which uses them itself');
}

console.log('mf_table_context_menu: passed');
