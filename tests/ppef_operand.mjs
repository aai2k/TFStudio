/**
 * PPEF: the peak-to-peak error of a design against a measured-curve block,
 * max − min over the block's points of EF = target dB − design dB.
 *
 * The acceptance list of the roadmap item:
 *   • a design scored against its own spectrum gives 0;
 *   • against a target moved by a constant number of dB it gives 0, which is
 *     what separates it from a curve-fit residual;
 *   • a linear tilt of 2 dB across the band reads 2 dB;
 *   • it equals the exact max − min of the sampled EF.
 * And: it reads the block whole or expanded for a run, refuses a missing or
 * switched-off block, goes with its block when the block is deleted, has an
 * analytic Jacobian that matches central differences, and the Specification
 * window reads the same number through the same row.
 *
 * Run: node tests/ppef_operand.mjs
 */

import assert from 'node:assert/strict';

import {
    DLSOptimizer, buildEvalContext, calcMF, evaluateOperands, expandMeasuredCurveOperands,
    logValue, makeMeasuredCurveOperand, makeOperand, operandEvaluationErrors,
    removeOperandsAndDependents,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { evaluateQualifier, makeQualifier, qualifiersToMFOperands } from '../src/utils/synthesis/qualifiers.js';

const resolve = id => getMaterial(id);
const near = (a, b, tol, message) => assert.ok(Math.abs(a - b) <= tol, `${message}: ${a} vs ${b}`);

const design = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: [62, 104, 58, 97, 64, 101].map((thickness, i) => ({
        id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness,
    })),
};
const lambdas = Array.from({ length: 31 }, (_, i) => 500 + 5 * i);
const ctx = () => buildEvalContext(design, resolve);
const ownDb = lambdas.map(lambda => logValue('dB', evaluateOperands(
    [makeOperand({ type: 'T', lambdaStart: lambda, lambdaEnd: lambda })], ctx())[0]));

const dbBlock = (targets, extra = {}) => makeMeasuredCurveOperand({ quantity: 'TDB', sampleLambdas: lambdas, sampleTargets: targets, ...extra });
const ppef = (block, extra = {}) => makeOperand({ type: 'PPEF', refId: block.id, ...extra });
const value = rows => evaluateOperands(rows, ctx())[rows.length - 1];

// -- Acceptance -------------------------------------------------------------------
{
    const own = dbBlock(ownDb);
    near(value([own, ppef(own)]), 0, 1e-12, 'against its own spectrum');
    const shifted = dbBlock(ownDb.map(db => db - 0.8));
    near(value([shifted, ppef(shifted)]), 0, 1e-12, 'against a target moved by a constant');
    const tilted = dbBlock(ownDb.map((db, i) => db + 2 * i / (lambdas.length - 1)));
    near(value([tilted, ppef(tilted)]), 2, 1e-12, 'a 2 dB tilt reads 2 dB');
    const wavy = ownDb.map((db, i) => db + 0.3 * Math.sin(i) - 0.1 * Math.cos(2 * i));
    const ef = wavy.map((target, i) => target - ownDb[i]);
    const block = dbBlock(wavy);
    near(value([block, ppef(block)]), Math.max(...ef) - Math.min(...ef), 1e-12, 'max − min of the sampled EF');
    // A block holding T as a fraction gives the same number.
    const linear = makeMeasuredCurveOperand({ quantity: 'T', sampleLambdas: lambdas, sampleTargets: wavy.map(db => 10 ** (db / 10)) });
    near(value([linear, ppef(linear)]), Math.max(...ef) - Math.min(...ef), 1e-9, 'a T block reads the same');
}

// -- The block in either form -----------------------------------------------------
{
    const block = dbBlock(ownDb.map((db, i) => db + 0.5 * (i % 3)));
    const whole = value([block, ppef(block)]);
    const expanded = expandMeasuredCurveOperands([block, ppef(block)]);
    assert.ok(expanded.length === lambdas.length + 1, 'the block expands into points');
    near(value(expanded), whole, 1e-12, 'the expanded points give the same value');
    near(value([{ ...block, levelFree: true }, ppef(block)]), whole, 1e-12, 'and so does a level-free block');
}

// -- Refusals and deletion ----------------------------------------------------------
{
    const block = dbBlock(ownDb);
    const orphan = makeOperand({ type: 'PPEF', refId: 'gone' });
    const missing = evaluateOperands([block, orphan], ctx());
    assert.match(operandEvaluationErrors(missing)[1], /not in the merit function/);
    const off = evaluateOperands([{ ...block, enabled: false }, ppef(block)], ctx());
    assert.match(operandEvaluationErrors(off)[1], /switched off/);
    const row = ppef(block);
    assert.deepEqual(removeOperandsAndDependents([block, row], [block.id]), [], 'deleting the block deletes the row');
    assert.equal(makeOperand({ type: 'PPEF' }).target, 0, 'a new row starts at 0 dB');
}

// -- Residual, σ and Jacobian -----------------------------------------------------
{
    const block = dbBlock(ownDb.map((db, i) => db + 0.6 * Math.sin(i / 3)), { weight: 0 });
    const row = ppef(block, { target: 0.2 });
    const computed = evaluateOperands([block, row], ctx());
    const spread = computed[1];
    near(calcMF([block, row], computed), (spread - 0.2) / (10 / Math.LN10), 1e-12, 'a ceiling scored with the dB σ');
    const met = ppef(block, { target: spread + 0.1 });
    assert.equal(calcMF([block, met], evaluateOperands([block, met], ctx())), 0, 'a met ceiling scores nothing');

    const away = { ...design, frontLayers: design.frontLayers.map(layer => ({ ...layer, thickness: layer.thickness * 1.02 })) };
    const engine = new DLSOptimizer([block, row], away, resolve, { fdStep: 0.01 });
    const columns = engine.thicknesses.map((_, index) => index);
    const analytic = engine._analyticJacobian(engine.thicknesses, columns);
    assert.ok(analytic, 'the row takes an analytic Jacobian');
    const differenced = engine._fdJacobian(engine.thicknesses, columns, analytic.length);
    const last = analytic.length - 1;
    const largest = Math.max(...differenced[last].map(Math.abs));
    assert.ok(largest > 0, 'the row is active');
    analytic[last].forEach((entry, column) => near(entry, differenced[last][column], 2e-3 * largest, `layer ${column + 1}`));
}

// -- Specification -----------------------------------------------------------------
{
    const targetT = ownDb.map((db, i) => 10 ** ((db + 0.4 * Math.cos(i / 4)) / 10));
    const curve = { id: 'gain', name: 'GFF target', quantity: 'T', aoi: 0, pol: 'avg', x: lambdas, y: targetT };
    const withCurve = { ...design, measuredCurves: [curve] };
    const qual = makeQualifier({ kind: 'PPEF', curveId: 'gain', cmp: 'le', target: 0.5 });
    const verdict = evaluateQualifier(qual, withCurve, resolve);
    const block = makeMeasuredCurveOperand({ quantity: 'T', sampleLambdas: lambdas, sampleTargets: targetT });
    near(verdict.value, value([block, ppef(block)]), 1e-12, 'the Specification reads the merit row');
    assert.equal(verdict.unit, 'dB');
    assert.equal(evaluateQualifier({ ...qual, curveId: 'none' }, withCurve, resolve).summaryKey, 'noCurve');

    const rows = qualifiersToMFOperands([qual], { design: withCurve });
    const types = rows.map(op => op.type);
    assert.deepEqual(types, ['MCURVE', 'PPEF', 'OPLT'], 'Generate MF writes the block, the row and the ceiling');
    assert.equal(rows[0].weight, 0, 'the block is measured against, not fitted');
    assert.equal(rows[1].refId, rows[0].id);
    assert.equal(rows[2].refId, rows[1].id);
}

console.log('PASS: ppef_operand');
