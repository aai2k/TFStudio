/**
 * MNT and MXT count their layer range from the substrate.
 *
 * The Design Editor calls the layer on the substrate layer 1, on both sides.
 * A thickness constraint's range uses the same numbers, so 'Layers 1-1' bounds
 * the layer on the substrate in the merit value, in the analytic Jacobian row
 * and in the SQP box. Front layers are stored incident medium first, back
 * layers substrate first.
 *
 *   1. One side: layer k of the front is the k-th stored from the end (front
 *      only, mirror symmetry); layer k of the back is the k-th stored.
 *   2. Both sides independent: the front counted from its substrate, then the
 *      back counted from its substrate.
 *   3. A violated MNT 1-1 puts its Jacobian entry on the layer on the substrate.
 *   4. SQP puts the MNT 1-1 floor on the layer on the substrate.
 *   5. A range over every layer and a range past the stack read as before.
 *
 * Run: node tests/mnt_layer_range_from_substrate.mjs
 */
import assert from 'node:assert/strict';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();

const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { buildEvalContext, evaluateOperands, makeConstraintOperand } = await import('../src/utils/physics/optimizer.js');
const { makeEngine } = await import('../src/utils/optimizers/index.js');

const stack = (prefix, thicknesses) => thicknesses.map((thickness, i) => ({
    id: `${prefix}${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false,
}));
// Front stored air side first: 11 nm is on the air, 13 nm on the substrate.
// Back stored substrate first: 21 nm is on the substrate.
const design = surfaceMode => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode, mfEvalMode: 'side',
    frontLayers: stack('F', [11, 12, 13]),
    backLayers: stack('B', [21, 22]),
});
const constraint = (type, from, to, target = 1) => makeConstraintOperand({ type, lambdaStart: from, lambdaEnd: to, target, weight: 1 });
const evaluate = (operands, d) => evaluateOperands(operands, buildEvalContext(d, designMaterialLookup(d)));
const singleLayers = (d, count) => evaluate(Array.from({ length: count }, (_, i) => constraint('MNT', i + 1, i + 1)), d);

// ── 1. One side ──────────────────────────────────────────────────────────────
assert.deepEqual(singleLayers(design('front_only'), 4), [13, 12, 11, null], 'front: layer 1 is the one on the substrate');
assert.deepEqual(singleLayers(design('symmetric'), 4), [13, 12, 11, null], 'mirror symmetry: the front numbers');
assert.deepEqual(singleLayers(design('back_only'), 3), [21, 22, null], 'back: layer 1 is the one on the substrate');

// ── 2. Both sides independent ────────────────────────────────────────────────
{
    const both = design('both_independent');
    assert.deepEqual(singleLayers(both, 6), [13, 12, 11, 21, 22, null], 'front from its substrate, then the back');
    assert.deepEqual(evaluate([constraint('MNT', 2, 4), constraint('MXT', 2, 4)], both), [11, 21],
        'layers 2-4 are the two outer front layers and the back layer on the substrate');
}

// ── 3. Analytic Jacobian ─────────────────────────────────────────────────────
const jacobianColumn = (surfaceMode, row) => {
    const d = design(surfaceMode);
    const engine = makeEngine('dls', [row], d, designMaterialLookup(d), { dMin: 1 });
    const free = engine.thicknesses.map((_, i) => i);
    const [entries] = engine._analyticJacobian(engine.thicknesses, free);
    const nonzero = entries.flatMap((v, i) => (v ? [i] : []));
    assert.equal(nonzero.length, 1, `${surfaceMode}: one entry in the row`);
    return nonzero[0];
};
assert.equal(jacobianColumn('front_only', constraint('MNT', 1, 1, 50)), 2, 'front: the stored-last layer');
assert.equal(jacobianColumn('front_only', constraint('MXT', 3, 3, 5)), 0, 'front layer 3 of 3: the stored-first layer');
assert.equal(jacobianColumn('both_independent', constraint('MNT', 1, 1, 50)), 2, 'both sides: front layer 1');
assert.equal(jacobianColumn('both_independent', constraint('MNT', 4, 4, 50)), 3, 'both sides: back layer 1');

// ── 4. SQP box ───────────────────────────────────────────────────────────────
{
    const d = design('front_only');
    const engine = makeEngine('sqp', [constraint('MNT', 1, 1, 50)], d, designMaterialLookup(d), { dMin: 1 });
    const { boxLo } = engine._thicknessBounds([0, 1, 2]);
    assert.deepEqual(boxLo, [1, 1, 50], 'the floor sits on the layer on the substrate');
    assert.deepEqual(engine.thicknesses, [11, 12, 50], 'the start is projected into that box');
}

// ── 5. Full and empty ranges ─────────────────────────────────────────────────
for (const mode of ['front_only', 'symmetric', 'back_only', 'both_independent']) {
    const d = design(mode);
    const [min, max, emptyMin, emptyMax] = evaluate([
        constraint('MNT', 1, 1000), constraint('MXT', 1, 1000),
        constraint('MNT', 6, 1000), constraint('MXT', 6, 1000),
    ], d);
    const layers = mode === 'back_only' ? [21, 22] : mode === 'both_independent' ? [11, 12, 13, 21, 22] : [11, 12, 13];
    assert.deepEqual([min, max], [Math.min(...layers), Math.max(...layers)], `${mode}: 1-1000 covers every layer`);
    assert.deepEqual([emptyMin, emptyMax], [null, null], `${mode}: a range past the stack has no value`);
}

console.log('MNT/MXT layer range from the substrate tests passed.');
