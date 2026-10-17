/**
 * A math row that reads a measured-curve block works in an optimizer run.
 *
 * The optimizers score a curve block as one row per measured point, each with
 * an id of its own, so a math row naming the block found nothing to read and
 * every run stopped before its first step. The block's own row is kept, at
 * weight 0, for the math row to read.
 *
 *   1. Expanded for a run, a block a math row reads keeps its id and weighs
 *      nothing; a block nothing reads is points only.
 *   2. The optimizer's merit equals the editor's, its residuals give the same
 *      merit, and a refinement step runs.
 *
 * Run: node tests/math_row_on_curve_block.mjs
 */
import assert from 'node:assert/strict';

const {
    makeOperand, makeMeasuredCurveOperand, expandMeasuredCurveOperands, evaluateOperands,
    buildEvalContext, calcMF, DLSOptimizer,
} = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');

const near = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);

const resolveMat = id => getMaterial(id);
const design = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'L1', material: 'Ta2O5', thickness: 120, locked: false },
        { id: 'L2', material: 'SiO2', thickness: 180, locked: false },
    ],
    backLayers: [], surfaceMode: 'front_only',
};
const lambdas = [450, 500, 550, 600, 650];
const block = makeMeasuredCurveOperand({ quantity: 'R', sampleLambdas: lambdas, sampleTargets: [0.04, 0.05, 0.06, 0.05, 0.04], weight: 1 });
const bound = makeOperand({ type: 'OPLT', refId: block.id, target: 0.001, weight: 1 });
const rows = [block, bound];

// ── 1. Expansion ─────────────────────────────────────────────────────────────
{
    const expanded = expandMeasuredCurveOperands(rows);
    const kept = expanded.filter(op => op.id === block.id);
    assert.equal(kept.length, 1, 'the block a math row reads keeps its row');
    assert.equal(kept[0].weight, 0, 'at weight 0');
    assert.equal(expanded.filter(op => op.measuredCurveBlockId === block.id).length, lambdas.length, 'beside one row per point');
    assert.ok(!expandMeasuredCurveOperands([block]).some(op => op.id === block.id), 'a block nothing reads is points only');
}

// ── 2. Optimizer ─────────────────────────────────────────────────────────────
{
    const editorMerit = calcMF(rows, evaluateOperands(rows, buildEvalContext(design, resolveMat)));
    assert.ok(Number.isFinite(editorMerit) && editorMerit > 0, 'the editor scores the merit');
    const optimizer = new DLSOptimizer(rows, JSON.parse(JSON.stringify(design)), resolveMat);
    const comp = evaluateOperands(optimizer.operands, optimizer._ctxFor(optimizer.thicknesses));
    near(calcMF(optimizer.operands, comp), editorMerit, 'the optimizer scores the same merit');
    const residuals = optimizer._residuals(optimizer.thicknesses);
    const sumW = optimizer.operands.reduce((sum, op) => sum + (op.enabled ? op.weight : 0), 0);
    near(Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / sumW), editorMerit, 'and its residuals give it');
    assert.doesNotThrow(() => optimizer.step(), 'a refinement step runs');
}

console.log('math_row_on_curve_block: passed');
