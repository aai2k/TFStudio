/**
 * The merit table's flag column: a row that looks for a peak takes a whole
 * number from 1 to 4 there, its search step; every other row shows a dash. A
 * row without a flag reads 1, rows keep their flag through the row clipboard,
 * and a row retyped to a type that takes no flag loses it.
 *
 * Run: node tests/mf_table_step_flag.mjs
 */
import assert from 'node:assert/strict';
import { makeOperand, operandSampleLambdas } from '../src/utils/physics/optimizer.js';
import {
    cellEdit, cellInitialText,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/editModel.js';
import { editableColsForRow } from '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandViewModel.js';
import {
    looksLikeOperandRows, parseOperandsTsv, serializeOperandsTsv,
} from '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandClipboard.js';
import { retypeOperand } from '../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js';
import { cellRange } from '../src/components/windows/optimization/meritFunctionEditor/mfTable/selectionModel.js';
import { rangeText } from '../src/components/windows/optimization/meritFunctionEditor/mfTable/cellClipboard.js';

const tmx = makeOperand({ type: 'TMX', lambdaStart: 500, lambdaEnd: 600, target: 0.01 });

// Which rows carry the column.
assert.ok(editableColsForRow(tmx).includes('flag'), 'a peak row takes a flag');
assert.ok(!editableColsForRow(makeOperand({ type: 'TMN' })).includes('flag'), 'a dip row does not');
assert.ok(editableColsForRow(makeOperand({ type: 'TAV' })).includes('flag'), 'a band average takes one, for its grid step');

// Typing into the cell.
assert.equal(cellInitialText(tmx, 'flag', false), '1', 'a row without a flag reads 1');
assert.deepEqual(cellEdit(tmx, 'flag', '3'), ['flag', 3]);
for (const text of ['0', '5', '2.5', 'x']) assert.equal(cellEdit(tmx, 'flag', text), null, `"${text}" is refused`);
assert.deepEqual(cellEdit(tmx, 'flag', ''), ['flag', undefined], 'an empty cell clears the flag, the 1 nm step on a peak row');

// The edit takes effect: flag 3 is a 0.01 nm search.
assert.equal(operandSampleLambdas({ ...tmx, flag: 3 }).length, 10001);

// Whole rows on the clipboard keep the flag, in the column order of the table,
// so a block of cells copied from Type to Weight pastes back as the same rows.
const rows = [
    { ...tmx, flag: 2, weight: 3 },
    makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0.005, weight: 2 }),
];
const text = serializeOperandsTsv(rows, new Set(rows.map(row => row.id)));
assert.deepEqual(text.split('\n')[0].split('\t'), ['TMX', '500', '600', '0', 'avg', '2', '1.00', '3']);
assert.ok(looksLikeOperandRows(text.split('\n').map(line => line.split('\t'))));
const pasted = parseOperandsTsv(text);
assert.deepEqual([pasted[0].flag, pasted[0].target, pasted[0].weight], [2, 0.01, 3], 'the first row comes back whole');
assert.deepEqual([pasted[1].flag, pasted[1].target, pasted[1].weight], [undefined, 0.005, 2], 'a row without a flag gets none');
const range = cellRange({ rowIdx: 0, colKey: 'type' }, { rowIdx: 1, colKey: 'weight' });
const cells = parseOperandsTsv(rangeText(rows, range, () => false));
assert.deepEqual(cells.map(op => [op.type, op.flag, op.target, op.weight]),
    [['TMX', 2, 0.01, 3], ['RAV', undefined, 0.005, 2]], 'copied cells paste back as the same rows');
// A line from an earlier release has no flag field; a flag on a type that takes
// none is dropped.
assert.deepEqual(parseOperandsTsv('TMN\t500\t600\t0\tavg\t95.00\t4').map(op => [op.target, op.weight, op.flag]),
    [[0.95, 4, undefined]]);
assert.equal(parseOperandsTsv('TMN\t500\t600\t0\tavg\t3\t95.00\t1')[0].flag, undefined);

// Retyping.
assert.equal(retypeOperand({ ...tmx, flag: 2 }, 'RMN').flag, 2, 'another peak row keeps it');
assert.equal('flag' in retypeOperand({ ...tmx, flag: 2 }, 'TMN'), false, 'a dip row drops it');

console.log('PASS mf_table_step_flag');
