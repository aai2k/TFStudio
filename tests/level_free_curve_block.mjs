/**
 * A curve block with its level free scores the shape of a curve and not where
 * it sits: the constant that best fits the design's departure from the points
 * is removed before the deviation is taken.
 *
 *   • A target equal to the design's own curve moved by a constant scores 0;
 *     the same block with its level fixed scores the constant.
 *   • The block is not expanded for a run; it gives one residual per point and
 *     their squares sum to its share of the merit.
 *   • Its analytic Jacobian, the point derivatives less their mean, matches
 *     central differences, in dB and in linear T.
 *   • A refinement from a wrong thickness recovers the thickness the shape
 *     came from, whatever the offset.
 *
 * Run: node tests/level_free_curve_block.mjs
 */

import assert from 'node:assert/strict';

import {
    DLSOptimizer, buildEvalContext, calcMF, evaluateOperands, expandMeasuredCurveOperands,
    hasFreeLevel, logValue, makeMeasuredCurveOperand, makeOperand, operandEvaluationErrors,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolve = id => getMaterial(id);
const near = (a, b, tol, message) => assert.ok(Math.abs(a - b) <= tol, `${message}: ${a} vs ${b}`);

const stack = thicknesses => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: thicknesses.map((thickness, i) => ({ id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness })),
});
const truth = [62, 104, 58, 97, 64, 101];
const design = stack(truth);
const lambdas = Array.from({ length: 41 }, (_, i) => 450 + 5 * i);

// The design's own T at the block's points, in dB or as a fraction.
function ownCurve(target, channel) {
    const points = lambdas.map(lambda => makeOperand({ type: 'T', lambdaStart: lambda, lambdaEnd: lambda }));
    const values = evaluateOperands(points, buildEvalContext(target, resolve));
    return channel === 'TDB' ? values.map(value => logValue('dB', value)) : values;
}
const block = (channel, offset, levelFree) => makeMeasuredCurveOperand({
    quantity: channel, levelFree, sampleLambdas: lambdas,
    sampleTargets: ownCurve(design, channel).map(value => value + offset),
});

// -- The level is not scored --------------------------------------------------
{
    const free = block('TDB', -0.7, true);
    const fixed = block('TDB', -0.7, false);
    assert.ok(hasFreeLevel(free) && !hasFreeLevel(fixed));
    const [freeValue, fixedValue] = evaluateOperands([free, fixed], buildEvalContext(design, resolve));
    near(freeValue, 0, 1e-12, 'a curve moved by a constant scores nothing with its level free');
    near(fixedValue, 0.7, 1e-12, 'and the constant with its level fixed');
    const psi = makeMeasuredCurveOperand({ quantity: 'PSI', levelFree: true, sampleLambdas: [500], sampleTargets: [40] });
    assert.ok(!hasFreeLevel(psi), 'a Ψ block has no free level');
}

// -- One residual per point, not expanded ------------------------------------
{
    const free = block('TDB', -0.7, true);
    const away = stack(truth.map(thickness => thickness * 1.03));
    assert.deepEqual(expandMeasuredCurveOperands([free]), [free], 'the block reaches the engine whole');
    const engine = new DLSOptimizer([free], away, resolve);
    const residuals = engine._residuals(engine.thicknesses);
    assert.equal(residuals.length, lambdas.length, 'one residual per point');
    const computed = evaluateOperands([free], buildEvalContext(away, resolve));
    assert.equal(operandEvaluationErrors(computed)[0], null);
    const sumSq = residuals.reduce((sum, value) => sum + value * value, 0);
    near(Math.sqrt(sumSq / free.weight), calcMF([free], computed), 1e-12, 'the residuals sum to the merit');
}

// -- Jacobian -------------------------------------------------------------------
for (const channel of ['TDB', 'T']) {
    const free = block(channel, channel === 'TDB' ? -0.7 : -0.02, true);
    const away = stack(truth.map(thickness => thickness * 1.03));
    const engine = new DLSOptimizer([free], away, resolve, { fdStep: 0.01 });
    const columns = engine.thicknesses.map((_, index) => index);
    const analytic = engine._analyticJacobian(engine.thicknesses, columns);
    assert.ok(analytic, `${channel}: the block takes analytic rows`);
    const differenced = engine._fdJacobian(engine.thicknesses, columns, analytic.length);
    let largest = 0;
    for (const row of differenced) for (const value of row) largest = Math.max(largest, Math.abs(value));
    for (let row = 0; row < analytic.length; row++) {
        for (let column = 0; column < columns.length; column++) {
            near(analytic[row][column], differenced[row][column], 1e-3 * largest, `${channel} point ${row}, layer ${column + 1}`);
        }
    }
}

// -- A refinement recovers the shape -------------------------------------------
{
    const free = block('TDB', -1.5, true);
    const start = stack(truth.map((thickness, index) => thickness * (index % 2 ? 0.97 : 1.03)));
    const engine = new DLSOptimizer([free], start, resolve);
    for (let step = 0; step < 60 && !engine.isConverged(); step++) engine.step();
    assert.ok(engine.mfBest < 1e-4, `the shape is matched (merit ${engine.mfBest})`);
    engine.thickBest.forEach((thickness, index) => near(thickness, truth[index], 0.05, `layer ${index + 1} recovered`));
}

console.log('PASS: level_free_curve_block');
