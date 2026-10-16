/**
 * The Refinement window's merit table changes a row the way the Merit Function
 * Editor does.
 *
 * Both windows draw the same table, and the table hands each window the number
 * as typed. The Refinement window used to keep its own copy of the edit rules,
 * which divided every typed target by 100, left a spectral target's ramp end
 * behind, kept the old range across a type change, gave a new MNT row the
 * wavelength defaults and dropped a math row's reference when copying it.
 *
 *   1. A target typed in nm or dB is stored as typed; a percentage is stored
 *      as a fraction; one number typed into a spectral target sets both ends.
 *   2. A type change between a wavelength row and MNT reseeds the range and
 *      the target, as in the editor.
 *   3. An added MNT row covers every layer.
 *   4. Duplicate and Insert copy the whole row, references and preset included.
 *
 * Run: node tests/refinement_table_edits.mjs
 */
import assert from 'node:assert/strict';

const refinement = await import('../src/components/windows/optimization/refinement/operandEdits.js');
const editor = await import('../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js');
const { makeOperand, makeConstraintOperand, DEFAULT_CONSTRAINT_LAST_LAYER } = await import('../src/utils/physics/optimizer.js');

const rav = makeOperand({ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, target: 0.01 });
const tt = makeOperand({ type: 'TT', lambdaStart: 1, lambdaEnd: 1, target: 500 });
const tdb = makeOperand({ type: 'TDB', lambdaStart: 550, lambdaEnd: 550, target: -10 });
const tgt = makeOperand({ type: 'TGT', lambdaStart: 400, lambdaEnd: 700, target: 0.9, targetEnd: 0.9 });
const math = makeOperand({ type: 'OPLT', refId: rav.id, target: 0.02 });
const tiw = makeOperand({ type: 'TIW', lambdaStart: 380, lambdaEnd: 780, presetKey: 'lum', source: { id: 'D65' } });
const mnt = makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: DEFAULT_CONSTRAINT_LAST_LAYER, target: 20 });
const rows = [rav, tt, tdb, tgt, math, tiw, mnt];

const row = (list, id) => list.find(op => op.id === id);
const edited = (id, key, value) => row(refinement.editOperand(rows, id, key, value), id);
const inEditor = (id, key, value) => row(editor.editOperand(rows, id, key, value), id);

// ── 1. Targets ───────────────────────────────────────────────────────────────
assert.equal(edited(tt.id, 'target', 1000).target, 1000, 'TT: 1000 nm stays 1000 nm');
assert.equal(edited(tdb.id, 'target', -20).target, -20, 'TDB: -20 dB stays -20 dB');
assert.equal(edited(rav.id, 'target', 1).target, 0.01, 'RAV: 1 % is stored as 0.01');
const flat = edited(tgt.id, 'target', 95);
assert.deepEqual([flat.target, flat.targetEnd], [0.95, 0.95], 'TGT: one number sets a flat target');
for (const [op, value] of [[tt, 1000], [tdb, -20], [rav, 1], [tgt, 95], [math, 3]]) {
    assert.deepEqual(edited(op.id, 'target', value), inEditor(op.id, 'target', value), `${op.type}: the same row as the editor`);
}

// ── 2. Type changes ──────────────────────────────────────────────────────────
{
    const toMnt = edited(rav.id, 'type', 'MNT');
    assert.deepEqual([toMnt.lambdaStart, toMnt.lambdaEnd], [1, DEFAULT_CONSTRAINT_LAST_LAYER], 'RAV to MNT covers every layer');
    assert.notEqual(toMnt.target, rav.target, 'and takes a thickness target, not 1 %');
    const toRav = edited(mnt.id, 'type', 'RAV');
    assert.deepEqual([toRav.lambdaStart, toRav.lambdaEnd], [400, 700], 'MNT to RAV gets a wavelength band, not 1-1000 nm');
    for (const [op, type] of [[rav, 'MNT'], [mnt, 'RAV'], [mnt, 'MXT']]) {
        const { id: _a, ...ours } = edited(op.id, 'type', type);
        const { id: _b, ...theirs } = inEditor(op.id, 'type', type);
        assert.deepEqual(ours, theirs, `${op.type} to ${type}: the same row as the editor`);
    }
}

// ── 3. Adding a row ──────────────────────────────────────────────────────────
{
    const added = refinement.addOperands(rows, { type: 'MNT', target: 30 }).next.at(-1);
    assert.deepEqual([added.lambdaStart, added.lambdaEnd], [1, DEFAULT_CONSTRAINT_LAST_LAYER], 'an added MNT row covers every layer');
    // A new row is a comment, as in the Merit Function Editor, so adding one
    // does not change the merit before a type is picked.
    const plain = refinement.addOperands(rows).next.at(-1);
    assert.equal(plain.type, 'BLNK', 'Add with no row adds a comment row');
    const blank = refinement.insertOperandAt(rows, 1);
    assert.equal(blank.next[1].type, 'BLNK', 'Insert with no source adds a comment row');
    assert.equal(blank.selectId, blank.next[1].id, 'and selects it');
}

// ── 4. Copies ────────────────────────────────────────────────────────────────
{
    const { next } = refinement.duplicateOperands(rows, [math.id, tiw.id]);
    const mathCopy = next[next.indexOf(row(next, math.id)) + 1];
    const tiwCopy = next[next.indexOf(row(next, tiw.id)) + 1];
    assert.notEqual(mathCopy.id, math.id, 'a duplicate is a new row');
    assert.equal(mathCopy.refId, rav.id, 'a duplicated math row keeps its reference');
    assert.equal(tiwCopy.presetKey, 'lum', 'a duplicated integral keeps its preset');

    const inserted = refinement.insertOperandAt(rows, 0, math);
    assert.equal(inserted.next[0].refId, rav.id, 'an inserted copy keeps the reference');
    assert.notEqual(inserted.selectId, math.id, 'and is a new row');
}

console.log('Refinement table edit tests passed.');
