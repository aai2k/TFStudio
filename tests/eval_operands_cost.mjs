/**
 * Work-per-call guard for evaluateOperands.
 *
 * evaluateOperands runs once per merit evaluation, so a refinement run calls it
 * thousands of times: a DLS step is one of these plus a Jacobian. The optimizer
 * guard and the physics tests pin the NUMBERS it produces. Nothing pinned what
 * it costs to produce them, and the timing benchmarks live in the BENCH set a
 * default `npm test` skips.
 *
 * This counts work instead of timing it. What makes the function cheap is the
 * per-call memoization: within one call the thicknesses and materials are
 * fixed, so operands sharing a (λ, angle, polarization) coordinate reuse one
 * TMM result and one complex index per material. A change that breaks that
 * sharing multiplies the cost of every merit evaluation by the number of
 * operands, which is the regression worth catching, and a counted assertion
 * catches it identically on a fast machine, a slow one, and a loaded one.
 *
 * The same caches must NOT survive between calls, because the thicknesses move
 * underneath them. The second half of the file pins that direction too: a
 * context reused at new thicknesses has to produce new numbers.
 *
 * Run: node tests/eval_operands_cost.mjs
 */

import assert from 'node:assert/strict';
import { buildEvalContext, evaluateOperands } from '../src/utils/physics/optimizer/evalCore.js';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const LAYER_COUNT = 8;
const OPERAND_COUNT = 500;

let nkCalls = 0;
const wrapped = new Map();
// Counts every complex-index lookup that reaches a material, so the per-call
// index cache is measured rather than assumed.
function resolveMat(id) {
    let material = wrapped.get(id);
    if (!material) {
        const real = getMaterial(id);
        material = Object.create(real);
        material.getNK = (lam) => { nkCalls++; return real.getNK(lam); };
        wrapped.set(id, material);
    }
    return material;
}

const design = {
    surfaceMode: 'front_only',
    mfEvalMode: 'side',
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: Array.from({ length: LAYER_COUNT }, (_, i) => ({
        material: i % 2 === 0 ? 'TiO2' : 'SiO2',
        thickness: 60 + i * 5,
    })),
    backLayers: [],
};

const oneOperand = () => makeOperand({
    type: 'TAV',
    lambdaStart: 550,
    lambdaEnd: 550,
    aoi: 0,
    target: 0.99,
    weight: 1,
    enabled: true,
});

const single = [oneOperand()];
const many = Array.from({ length: OPERAND_COUNT }, oneOperand);
const ctx = buildEvalContext(design, resolveMat);

// The index cache is keyed by material and wavelength, not by layer, so one
// evaluation at a single wavelength costs one lookup per DISTINCT material
// however many layers the alternating stack has.
const INDICES_PER_EVALUATION = new Set([
    design.incidentMedium,
    design.substrate.material,
    ...design.frontLayers.map(layer => layer.material),
]).size;

// ── Operands at one coordinate share the call's memoized work ─────────────────
{
    nkCalls = 0;
    evaluateOperands(single, ctx);
    const forOne = nkCalls;

    assert.equal(forOne, INDICES_PER_EVALUATION,
        `one operand over a ${LAYER_COUNT}-layer stack should resolve ${INDICES_PER_EVALUATION} indices, `
        + `one per distinct material, not ${forOne}`);

    nkCalls = 0;
    evaluateOperands(many, ctx);
    const forMany = nkCalls;

    assert.equal(forMany, forOne,
        `${OPERAND_COUNT} operands at the same wavelength, angle and polarization cost ${forMany} index lookups `
        + `against ${forOne} for a single operand. More means the per-call memoization is no longer shared across `
        + 'operands, so every merit evaluation costs the optimizer one full evaluation per row. Fewer means a cache '
        + 'survived the previous call, which is the stale-design failure the next block covers.');
}

// ── The caches do not outlive the call ────────────────────────────────────────
// Thicknesses move between calls on a context the optimizer reuses, so a cache
// that survived would score the previous design.
{
    const before = evaluateOperands(many, ctx)[0];

    ctx.frontThicks = ctx.frontThicks.map(d => d * 1.2);
    const after = evaluateOperands(many, ctx)[0];

    assert.notEqual(after, before,
        'the same context re-evaluated at 1.2x thicknesses returned the previous value, '
        + 'so a per-call cache survived the call and the merit is scoring a stale design');

    ctx.frontThicks = ctx.frontThicks.map(d => d / 1.2);
    const restored = evaluateOperands(many, ctx)[0];
    assert.ok(Math.abs(restored - before) < 1e-12,
        'returning the thicknesses should return the value; got '
        + `${restored} against ${before}`);
}

console.log(`PASS eval_operands_cost: ${OPERAND_COUNT} operands cost ${INDICES_PER_EVALUATION} index lookups, caches reset per call`);
