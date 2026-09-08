import assert from 'node:assert/strict';
import {
    RANGE_COLUMNS, cellRange, pasteTargets, rangeColumnsForRow,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/selectionModel.js';
import {
    gridEdits, looksLikeOperandRows, parseCellGrid, pasteIntoCell, rangeText, runKeyAction,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/tableKeyboard.js';
import {
    cellEdit, polFromKey, startEdit,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/editModel.js';

const operands = [
    { id: 'a', type: 'RGT', lambdaStart: 1565, lambdaEnd: 1630, aoi: 45, pol: 's', target: 1, targetEnd: 1, weight: 1 },
    { id: 'b', type: 'TGT', lambdaStart: 1565, lambdaEnd: 1630, aoi: 45, pol: 's', target: 0, targetEnd: 0, weight: 1 },
    { id: 'c', type: 'MNT', lambdaStart: 1, lambdaEnd: 1000, aoi: 0, pol: 'avg', target: 40, weight: 1 },
    { id: 'd', type: 'R', lambdaStart: 550, lambdaEnd: 550, aoi: 0, pol: 'avg', target: 0.02, weight: 2 },
];
const noPercent = () => false;

// ── The rectangle ─────────────────────────────────────────────────────────────

assert.deepEqual(RANGE_COLUMNS, ['type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight']);
assert.equal(cellRange(null, { rowIdx: 0, colKey: 'aoi' }), null);
assert.equal(cellRange({ rowIdx: 1, colKey: 'aoi' }, { rowIdx: 1, colKey: 'aoi' }), null, 'one cell is no range');
assert.equal(cellRange({ rowIdx: 1, colKey: 'current' }, { rowIdx: 2, colKey: 'aoi' }), null, 'a computed column cannot anchor a range');
assert.deepEqual(cellRange({ rowIdx: 3, colKey: 'target' }, { rowIdx: 1, colKey: 'lambdaEnd' }),
    { rowStart: 1, rowEnd: 3, colKeys: ['lambdaEnd', 'aoi', 'pol', 'target'] },
    'the rectangle is the same whichever corner is the anchor');
const range = cellRange({ rowIdx: 0, colKey: 'lambdaStart' }, { rowIdx: 1, colKey: 'aoi' });
assert.deepEqual(rangeColumnsForRow(range, 1), ['lambdaStart', 'lambdaEnd', 'aoi']);
assert.equal(rangeColumnsForRow(range, 2), null);
assert.equal(rangeColumnsForRow(null, 0), null);

// ── Copy ──────────────────────────────────────────────────────────────────────

assert.equal(rangeText(operands, range, noPercent), '1565\t1630\t45\n1565\t1630\t45');
const acrossDash = cellRange({ rowIdx: 1, colKey: 'aoi' }, { rowIdx: 2, colKey: 'target' });
assert.equal(rangeText(operands, acrossDash, noPercent), '45\ts\t0.0→0.0\n\t\t40',
    'a cell the row does not carry copies as nothing, keeping the columns aligned');

// ── Paste geometry ───────────────────────────────────────────────────────────

assert.deepEqual(parseCellGrid('1\t2\n3\t4\n'), [['1', '2'], ['3', '4']]);
assert.equal(looksLikeOperandRows([['R', '400', '700', '0', 'avg', '50', '1']]), true);
assert.equal(looksLikeOperandRows([['400', '700']]), false);
assert.equal(looksLikeOperandRows([]), false);

// One value fills the whole range.
assert.deepEqual(pasteTargets({ grid: [['2']], range: cellRange({ rowIdx: 0, colKey: 'weight' }, { rowIdx: 3, colKey: 'weight' }), operands }),
    [{ rowIdx: 0, colKey: 'weight', text: '2' }, { rowIdx: 1, colKey: 'weight', text: '2' },
        { rowIdx: 2, colKey: 'weight', text: '2' }, { rowIdx: 3, colKey: 'weight', text: '2' }]);
// A row of values repeats down the range; a dash cell is skipped.
assert.deepEqual(pasteTargets({ grid: [['44', 'p']], range: acrossDash, operands }),
    [{ rowIdx: 1, colKey: 'aoi', text: '44' }, { rowIdx: 1, colKey: 'pol', text: 'p' }, { rowIdx: 1, colKey: 'target', text: '44' },
        { rowIdx: 2, colKey: 'target', text: '44' }]);
// From one cell the grid is laid out down and right and clipped at the table edge.
assert.deepEqual(pasteTargets({ grid: [['1', '2', '3'], ['4', '5', '6']], range: null, focus: { rowIdx: 3, colKey: 'target' }, operands }),
    [{ rowIdx: 3, colKey: 'target', text: '1' }, { rowIdx: 3, colKey: 'weight', text: '2' }]);
assert.deepEqual(pasteTargets({ grid: [['x']], range: null, focus: { rowIdx: 0, colKey: 'current' }, operands }), []);

// ── Paste values ─────────────────────────────────────────────────────────────

assert.deepEqual(cellEdit(operands[3], 'type', 'tav'), ['type', 'TAV']);
assert.equal(cellEdit(operands[3], 'type', 'nope'), null);
assert.equal(cellEdit(operands[3], 'type', 'MEAS'), null, 'a generated-only type cannot be typed in');
assert.deepEqual(cellEdit(operands[3], 'pol', 'p'), ['pol', 'p']);
assert.deepEqual(cellEdit(operands[3], 'pol', 'avg'), ['pol', 'avg']);
assert.equal(cellEdit(operands[3], 'pol', 'x'), null);
assert.deepEqual(cellEdit(operands[0], 'target', '20→80'), ['_patch', { target: 0.2, targetEnd: 0.8 }]);
assert.deepEqual(cellEdit(operands[0], 'target', '50'), ['target', 50]);
assert.deepEqual(cellEdit(operands[3], 'weight', '3'), ['weight', 3]);
assert.equal(cellEdit(operands[3], 'weight', '-1'), null);
assert.equal(cellEdit(operands[3], 'aoi', 'abc'), null);

const fill = gridEdits({ grid: [['2']], range: cellRange({ rowIdx: 0, colKey: 'weight' }, { rowIdx: 1, colKey: 'weight' }), operands });
assert.deepEqual(fill, [{ id: 'a', key: 'weight', value: 2 }, { id: 'b', key: 'weight', value: 2 }]);
const mixed = gridEdits({ grid: [['tav', 'bad']], range: cellRange({ rowIdx: 3, colKey: 'type' }, { rowIdx: 3, colKey: 'lambdaStart' }), operands });
assert.deepEqual(mixed, [{ id: 'd', key: 'type', value: 'TAV' }], 'text a cell cannot hold is dropped, the rest lands');

// pasteIntoCell routes by shape: one value to the editor, operand rows below,
// a grid over the range through one batched edit.
{
    const log = [];
    const ctx = {
        rowIdx: 0, colKey: 'weight', operands, range: null,
        commitEdit: (...args) => log.push(['commit', ...args]),
        onAdd: (...args) => log.push(['add', args[0].length, args[1]]),
        onEditMany: edits => log.push(['many', edits]),
        onEdit: () => log.push(['one']),
    };
    const clip = text => ({ readText: () => Promise.resolve(text) });
    pasteIntoCell(ctx, clip('3'));
    pasteIntoCell(ctx, clip('R\t400\t700\t0\tavg\t50\t1'));
    pasteIntoCell(ctx, clip('4\n5'));
    pasteIntoCell({ ...ctx, range: cellRange({ rowIdx: 0, colKey: 'weight' }, { rowIdx: 1, colKey: 'weight' }) }, clip('7'));
    pasteIntoCell(ctx, clip('   '));
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(log, [
        ['commit', 0, 'weight', '3'],
        ['add', 1, 1],
        ['many', [{ id: 'a', key: 'weight', value: 4 }, { id: 'b', key: 'weight', value: 5 }]],
        ['many', [{ id: 'a', key: 'weight', value: 7 }, { id: 'b', key: 'weight', value: 7 }]],
    ]);
}

// ── Keyboard: Shift stretches, Escape collapses ───────────────────────────────
{
    const calls = [];
    const event = (key, shiftKey) => ({ key, shiftKey, preventDefault: () => calls.push('prevented') });
    const base = {
        operands, rowIdx: 1, colKey: 'aoi', focusAt: (...a) => calls.push(['focus', ...a]),
        navigate: (...a) => calls.push(['navigate', ...a]), extendTo: (...a) => calls.push(['extend', ...a]),
        collapseRange: () => calls.push(['collapse']),
    };
    runKeyAction('ArrowDown', { ...base, event: event('ArrowDown', true) });
    runKeyAction('ArrowDown', { ...base, event: event('ArrowDown', false) });
    runKeyAction('ArrowRight', { ...base, event: event('ArrowRight', true) });
    runKeyAction('ArrowLeft', { ...base, event: event('ArrowLeft', false) });
    runKeyAction('Escape', { ...base, range, event: event('Escape', false) });
    runKeyAction('Escape', { ...base, range: null, event: event('Escape', false) });
    assert.deepEqual(calls.filter(call => call !== 'prevented'), [
        ['extend', 2, 'aoi'], ['focus', 2, 'aoi'], ['extend', 1, 'pol'], ['navigate', 1, 'aoi', 'left'], ['collapse'],
    ], 'Escape with no range is left to whoever else wants it');
    // Shift+Right at the row's last column would move to the next row; a range
    // does not wrap, so nothing happens.
    calls.length = 0;
    runKeyAction('ArrowRight', { ...base, colKey: 'weight', event: event('ArrowRight', true) });
    assert.deepEqual(calls.filter(call => call !== 'prevented'), []);
}

// ── Type and Pol from the keyboard ───────────────────────────────────────────

assert.equal(polFromKey('S'), 's');
assert.equal(polFromKey('q'), null);
{
    const calls = [];
    const ctx = {
        operands, onEdit: (...a) => calls.push(['edit', ...a]), isMathPct: noPercent,
        setFocusCell: cell => calls.push(['focus', cell]), setEditCell: cell => calls.push(['editCell', cell]),
    };
    startEdit(ctx, 3, 'type', 't');
    startEdit(ctx, 3, 'type', null);
    startEdit(ctx, 3, 'pol', 'p');
    startEdit(ctx, 3, 'pol', null);
    startEdit(ctx, 2, 'pol', 's');
    startEdit(ctx, 3, 'lambdaEnd', null);
    assert.deepEqual(calls, [
        ['focus', { rowIdx: 3, colKey: 'type' }], ['editCell', { rowIdx: 3, colKey: 'type', initValue: 't' }],
        ['focus', { rowIdx: 3, colKey: 'type' }], ['editCell', { rowIdx: 3, colKey: 'type', initValue: '' }],
        ['edit', 'd', 'pol', 'p'],
        ['focus', { rowIdx: 3, colKey: 'pol' }], ['editCell', { rowIdx: 3, colKey: 'pol', initValue: 'avg' }],
    ], 'a typed letter opens the picker searching for it, Enter opens it empty; Pol takes a letter outright and opens its list on Enter; a dash cell and a constraint\'s Pol do nothing');
}

console.log('mf_table_range_selection: passed');
