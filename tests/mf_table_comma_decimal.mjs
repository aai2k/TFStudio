/**
 * The merit table reads a typed number with a comma decimal, and refuses text
 * that is not a number.
 *
 * A number typed into a merit table cell used to go through parseFloat, which
 * stops at the first character it cannot use: '94,2' became 94 and '94abc'
 * became 94, with nothing on screen to say so. The cells now read numbers as
 * the Design Editor's thickness column does.
 *
 *   1. A cell edit: target, wavelength, angle and weight with a comma decimal.
 *   2. A ramp target written with commas.
 *   3. Text that is not a number from start to end is refused, and the cell
 *      keeps its value; so is a typo with a doubled separator.
 *   4. Operand rows pasted from a spreadsheet with comma decimals.
 *
 * Run: node tests/mf_table_comma_decimal.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { cellEdit } = await import('../src/components/windows/optimization/meritFunctionEditor/mfTable/editModel.js');
const { parseOperandsTsv } = await import('../src/components/windows/optimization/meritFunctionEditor/mfTable/operandClipboard.js');
const { editOperand } = await import('../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');

const rav = makeOperand({ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, target: 0.01 });
const tgt = makeOperand({ type: 'TGT', lambdaStart: 400, lambdaEnd: 700, target: 0.9, targetEnd: 0.9 });

// ── 1. Cell edits ────────────────────────────────────────────────────────────
assert.deepEqual(cellEdit(rav, 'target', '94,2'), ['target', 94.2], 'target');
assert.deepEqual(cellEdit(rav, 'lambdaStart', '550,5'), ['lambdaStart', 550.5], 'wavelength');
assert.deepEqual(cellEdit(rav, 'aoi', '12,5'), ['aoi', 12.5], 'angle');
assert.deepEqual(cellEdit(rav, 'weight', '0,5'), ['weight', 0.5], 'weight');
assert.deepEqual(cellEdit(rav, 'target', '94.2'), ['target', 94.2], 'a dot still works');
assert.equal(editOperand([rav], rav.id, 'target', '1,5')[0].target, 0.015, 'the stored RAV target is 1.5 %');

// ── 2. Ramp target ───────────────────────────────────────────────────────────
assert.deepEqual(cellEdit(tgt, 'target', '95,5→90'), ['_patch', { target: 0.955, targetEnd: 0.9 }], 'a ramp with commas');

// ── 3. Not a number ──────────────────────────────────────────────────────────
for (const text of ['94abc', '550 nm', '550..5', '0,5,1']) {
    assert.equal(cellEdit(rav, 'target', text), null, `'${text}' is refused, not read as its leading digits`);
}

// ── 4. Pasted rows ───────────────────────────────────────────────────────────
{
    const [row] = parseOperandsTsv('RAV\t400,5\t700\t7,5\tavg\t1,5\t0,5');
    assert.deepEqual([row.lambdaStart, row.lambdaEnd, row.aoi, row.target, row.weight], [400.5, 700, 7.5, 0.015, 0.5],
        'a row pasted with comma decimals');
}

console.log('MF table comma decimal tests passed.');
