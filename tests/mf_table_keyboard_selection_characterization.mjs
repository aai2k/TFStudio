import assert from 'node:assert/strict';
import {
    cellText, clipboardScope, copySelectedOperands, doKeyDown, keyComboOf, parseOperandsTsv,
    pasteIntoCell, pasteOperands, runKeyAction, serializeOperandsTsv,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/tableKeyboard.js';
import {
    navigationTarget, selectionAfterRowClick,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/selectionModel.js';

const operands = [
    { id: 'r', type: 'R', lambdaStart: 400, lambdaEnd: 700, aoi: 5, pol: 's', target: 0.123, weight: 2 },
    { id: 'tt', type: 'TT', lambdaStart: 0, lambdaEnd: 0, aoi: 0, pol: 'avg', target: 1200, weight: 3 },
    { id: 'math', type: 'OPGT', lambdaStart: 0, lambdaEnd: 0, aoi: 0, pol: 'p', target: 0.99, weight: 4 },
];

assert.equal(serializeOperandsTsv(operands, new Set(['math', 'r'])),
    'R\t400\t700\t5\ts\t12.30\t2\nOPGT\t0\t0\t0\tp\t0.99\t4');
assert.deepEqual(parseOperandsTsv('R\t450\t650\t30\tp\t75\t2\r\nTT\tbad\t\tbad\tx\t1500\tbad\n'), [
    { type: 'R', lambdaStart: 450, lambdaEnd: 650, aoi: 30, pol: 'p', target: 0.75, weight: 2 },
    { type: 'TT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 1500, weight: 1 },
]);
assert.deepEqual(parseOperandsTsv('UNKNOWN\t\t\t\t\t50\t\n\n'), [{
    type: 'RAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0.5, weight: 1,
}]);
assert.deepEqual(parseOperandsTsv('R\t450\t650\t0\tavg\t50\t-2\nT\t450\t650\t0\tavg\t50\tInfinity'), [
    { type: 'R', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0.5, weight: 1 },
    { type: 'T', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0.5, weight: 1 },
]);
assert.deepEqual(parseOperandsTsv('   '), []);

let written = null;
await copySelectedOperands(operands, new Set(['tt']), {
    writeText(text) { written = text; return Promise.resolve(); },
});
assert.equal(written, 'TT\t0\t0\t0\tavg\t1200.00\t3');
const pasteCalls = [];
pasteOperands((...args) => pasteCalls.push(args), 7, {
    readText: () => Promise.resolve('A\t300\t800\t0\tavg\t5\t1'),
});
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(pasteCalls, [[[
    { type: 'A', lambdaStart: 300, lambdaEnd: 800, aoi: 0, pol: 'avg', target: 0.05, weight: 1 },
], 7]]);

const combo = (key, extra = {}) => keyComboOf({ key, ctrlKey: false, shiftKey: false, ...extra });
assert.equal(combo('d', { ctrlKey: true }), 'Ctrl+d');
assert.equal(combo('D', { ctrlKey: true }), 'Ctrl+d');
assert.equal(combo('D', { ctrlKey: true, shiftKey: true }), 'D');
assert.equal(combo('c', { ctrlKey: true }), 'Ctrl+c');
assert.equal(combo('C', { ctrlKey: true }), 'C');
assert.equal(combo('v', { ctrlKey: true }), 'Ctrl+v');
assert.equal(combo('x', { ctrlKey: true }), 'Ctrl+x');
assert.equal(combo('X', { ctrlKey: true }), 'X');
assert.equal(combo('F2'), 'Enter');
assert.equal(combo('Tab'), 'Tab');

const rows = [{ id: 'a', type: 'R' }, { id: 'b', type: 'TT' }, { id: 'c', type: 'TAV' }, { id: 'd', type: 'BLNK' }];
let selection = selectionAfterRowClick({ operands: rows, previous: new Set(), anchor: null, id: 'b', shift: false, ctrl: false });
assert.deepEqual([...selection.selectedIds], ['b']);
assert.equal(selection.anchor, 'b');
selection = selectionAfterRowClick({ operands: rows, previous: selection.selectedIds, anchor: selection.anchor, id: 'd', shift: true, ctrl: false });
assert.deepEqual([...selection.selectedIds], ['b', 'c', 'd']);
assert.equal(selection.anchor, 'b');
selection = selectionAfterRowClick({ operands: rows, previous: new Set(['a']), anchor: 'b', id: 'd', shift: true, ctrl: true });
assert.deepEqual([...selection.selectedIds], ['b', 'c', 'd', 'a']);
selection = selectionAfterRowClick({ operands: rows, previous: selection.selectedIds, anchor: selection.anchor, id: 'c', shift: false, ctrl: true });
assert.deepEqual([...selection.selectedIds], ['b', 'd', 'a']);
assert.equal(selection.anchor, 'c');

assert.deepEqual(navigationTarget(rows, 0, 'type', 'right'), { rowIdx: 0, colKey: 'lambdaStart', focus: false });
assert.deepEqual(navigationTarget(rows, 0, 'weight', 'right'), { rowIdx: 1, colKey: 'enabled', focus: true });
assert.deepEqual(navigationTarget(rows, 2, 'enabled', 'left'), { rowIdx: 1, colKey: 'weight', focus: true });
assert.deepEqual(navigationTarget(rows, 0, 'type', 'down'), { rowIdx: 1, colKey: 'type', focus: true });
assert.deepEqual(navigationTarget(rows, 3, 'enabled', 'down'), null);
assert.deepEqual(navigationTarget(rows, 0, 'enabled', 'left'), null);

function event(key, extra = {}) {
    return {
        key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
        prevented: false,
        preventDefault() { this.prevented = true; },
        ...extra,
    };
}

const actionCalls = [];
const actionBase = {
    rowIdx: 1, colKey: 'target', operands: rows, selectedIds: new Set(['a', 'c']),
    setSelIds: value => actionCalls.push(['selection', [...value]]),
    setFocusCell: value => actionCalls.push(['focus-state', value]),
    onDelete: ids => actionCalls.push(['delete', ids]),
    onInsertAt: (...args) => actionCalls.push(['insert', ...args]),
    onDuplicate: ids => actionCalls.push(['duplicate', ids]),
    focusAt: (...args) => actionCalls.push(['focus', ...args]),
    navigate: (...args) => actionCalls.push(['navigate', ...args]),
    startEdit: (...args) => actionCalls.push(['edit', ...args]),
};
const deleteEvent = event('Delete');
runKeyAction('Delete', { ...actionBase, event: deleteEvent });
assert.equal(deleteEvent.prevented, true);
assert.deepEqual(actionCalls.splice(0), [
    ['delete', ['a', 'c']], ['selection', []], ['focus-state', null],
]);
runKeyAction('Insert', { ...actionBase, event: event('Insert', { shiftKey: true }) });
runKeyAction('Ctrl+d', { ...actionBase, event: event('d', { ctrlKey: true }) });
runKeyAction('ArrowDown', { ...actionBase, event: event('ArrowDown') });
runKeyAction('ArrowLeft', { ...actionBase, event: event('ArrowLeft') });
runKeyAction('Enter', { ...actionBase, event: event('Enter') });
runKeyAction('Tab', { ...actionBase, event: event('Tab', { shiftKey: true }) });
assert.deepEqual(actionCalls, [
    ['insert', 2, rows[1]],
    ['duplicate', ['a', 'c']],
    ['focus', 2, 'target'],
    ['navigate', 1, 'target', 'left'],
    ['edit', 1, 'target', null],
    ['navigate', 1, 'target', 'left'],
]);

const keyCalls = [];
const keyCtx = {
    editCell: null,
    focusCell: { rowIdx: 0, colKey: 'weight' },
    selectedIds: new Set(['a']),
    operands: rows,
    setSelIds() {}, setFocusCell() {}, onDelete() {}, onAdd() {},
    focusAt() {}, navigate() {},
    startEdit: (...args) => keyCalls.push(args),
};
doKeyDown(keyCtx, event('7'));
doKeyDown({ ...keyCtx, editCell: { rowIdx: 0 } }, event('8'));
doKeyDown({ ...keyCtx, focusCell: null, selectedIds: new Set() }, event('9'));
assert.deepEqual(keyCalls, [[0, 'weight', '7']]);

// ── Cut moves the rows, never a cell ─────────────────────────────────────────
{
    const deleted = [];
    let selection = new Set(['r']);
    let focus = { rowIdx: 0, colKey: 'target' };
    const prevented = { count: 0 };
    runKeyAction('Ctrl+x', {
        event: { preventDefault: () => { prevented.count++; } },
        operands, selectedIds: selection, focusCell: focus, rowIdx: 0, colKey: 'target',
        onDelete: ids => deleted.push(ids),
        setSelIds: next => { selection = next; }, setFocusCell: next => { focus = next; },
    });
    assert.deepEqual(deleted, [['r']], 'the focused row goes, even with a text cell focused');
    assert.equal(selection.size, 0);
    assert.equal(focus, null);
    assert.equal(prevented.count, 1);
    runKeyAction('Ctrl+x', {
        event: { preventDefault() {} }, operands, selectedIds: new Set(), focusCell: null, rowIdx: 5, colKey: 'type',
        onDelete: ids => deleted.push(ids), setSelIds() {}, setFocusCell() {},
    });
    assert.equal(deleted.length, 1, 'nothing to cut when no row is focused or selected');
}

// ── Single-cell copy and paste ────────────────────────────────────────────────
//
// A focused text cell copies and pastes its own value. Rows stay the unit when
// the # column has focus (focusCell null), when more than one row is selected,
// or when the focus is on a picked column such as Type or Pol.
assert.equal(clipboardScope({ focusCell: { rowIdx: 0, colKey: 'target' }, selectedIds: new Set() }), 'cell');
assert.equal(clipboardScope({ focusCell: { rowIdx: 0, colKey: 'target' }, selectedIds: new Set(['r']) }), 'cell');
assert.equal(clipboardScope({ focusCell: { rowIdx: 0, colKey: 'target' }, selectedIds: new Set(['r', 'tt']) }), 'rows');
assert.equal(clipboardScope({ focusCell: { rowIdx: 0, colKey: 'type' }, selectedIds: new Set() }), 'cell',
    'the type code is text like any other value cell');
assert.equal(clipboardScope({ focusCell: { rowIdx: 0, colKey: 'current' }, selectedIds: new Set() }), 'rows',
    'a computed column is not a value cell');
assert.equal(clipboardScope({ focusCell: null, selectedIds: new Set(['r']) }), 'rows');

assert.equal(cellText(operands[0], 'target', false), '12.30', 'a fractional target copies as the percent the editor shows');
assert.equal(cellText(operands[1], 'target', false), '1200', 'a thickness target copies as is');
assert.equal(cellText(operands[0], 'lambdaStart', false), '400');
assert.equal(cellText({ type: 'R' }, 'weight', false), '');

{
    const commits = [];
    const adds = [];
    const ctx = { rowIdx: 0, colKey: 'target', commitEdit: (...args) => commits.push(args), onAdd: (...args) => adds.push(args) };
    const clipboard = text => ({ readText: () => Promise.resolve(text) });
    pasteIntoCell(ctx, clipboard('45'));
    pasteIntoCell(ctx, clipboard('20→80\n'));
    pasteIntoCell(ctx, clipboard('   '));
    pasteIntoCell(ctx, clipboard('A\t300\t800\t0\tavg\t5\t1'));
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(commits, [[0, 'target', '45'], [0, 'target', '20→80']],
        'a single value, ramp syntax included, goes through the cell editor commit');
    assert.deepEqual(adds, [[[{ type: 'A', lambdaStart: 300, lambdaEnd: 800, aoi: 0, pol: 'avg', target: 0.05, weight: 1 }], 1]],
        'tab-separated text is rows and is inserted below the focused row');
}

console.log('mf_table_keyboard_selection_characterization: passed');
