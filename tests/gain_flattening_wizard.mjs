/**
 * The merit function wizard's curve types: Curve and Gain flattening.
 *
 *   • A gain inverts to the loss that brings every wavelength down to the
 *     lowest gain, 0 dB at the gain minimum (T_target[dB] = G_min − G).
 *   • A gain reads from pasted or file text, decimal commas included.
 *   • Gain flattening writes the target as a dB block with its level free, a
 *     PPEF row against it and a TDBMN row at the target's peak holding the
 *     insertion loss, and puts the derived target on the design once.
 *   • Curve writes the block Fit… writes.
 *   • A missing curve or gain is named, and nothing is written.
 *   • The rows evaluate, and a refinement lowers the peak-to-peak error.
 *
 * Run: node tests/gain_flattening_wizard.mjs
 */

import assert from 'node:assert/strict';

import { flatteningLossDb } from '../src/utils/physics/gainFlattening.js';
import {
    DLSOptimizer, buildEvalContext, calcMF, evaluateOperands, hasFreeLevel, operandEvaluationErrors,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import {
    curveWizardRows, gainCurveFromText, gainTargetCurve,
} from '../src/components/windows/optimization/meritFunctionEditor/curveWizardModel.js';
import { buildWizardResult } from '../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js';
import { fieldRows } from '../src/components/windows/optimization/meritFunctionEditor/wizardModel.js';
import { measuredFitSnapshot } from '../src/components/windows/dataExchange/spectrumExchange/model.js';

const resolve = id => getMaterial(id);
const near = (a, b, tol, message) => assert.ok(Math.abs(a - b) <= tol, `${message}: ${a} vs ${b}`);

// -- The inversion ------------------------------------------------------------------
assert.deepEqual(flatteningLossDb([3, 5, 4]), [0, -2, -1], 'G_min − G');

// -- Reading a gain -----------------------------------------------------------------
{
    const gain = gainCurveFromText('Wavelength\tGain\n1540\t22,1\n1530\t20,5\n1550\t21,0\n', 'edfa.txt');
    assert.equal(gain.name, 'edfa');
    assert.deepEqual(gain.x, [1530, 1540, 1550], 'sorted, in nm');
    assert.deepEqual(gain.y, [20.5, 22.1, 21.0], 'gain in dB as written, decimal commas read');
    assert.equal(gainCurveFromText('not a table'), null);
}

// -- Gain flattening ---------------------------------------------------------------
// A stack whose transmittance has some slope over 500-600 nm, so a gain that
// mirrors part of it has a shape to flatten.
const design = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [], measuredCurves: [], meritOperands: [],
    frontLayers: [80, 120, 70, 110, 75].map((thickness, i) => ({
        id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness,
    })),
};
const lambdas = Array.from({ length: 21 }, (_, i) => 500 + 5 * i);
const gain = { name: 'edfa', x: lambdas, y: lambdas.map(lambda => 20 + 1.5 * Math.sin((lambda - 500) / 30)) };
const params = { input: 'gain', gain, curveAoi: 0, curvePol: 'avg', insertionLossDb: 0.4, ppefDb: 0.1 };
const flatteningName = name => `${name} flattening target`;
{
    const result = curveWizardRows({ typeId: 'GAIN_FLATTENING', params, design, flatteningName });
    assert.equal(result.error, undefined);
    const [block, ppef, loss] = result.rows;
    assert.equal(block.type, 'MCURVE');
    assert.equal(block.quantity, 'TDB', 'the target is a block in dB');
    assert.ok(hasFreeLevel(block), 'with its level free');
    assert.equal(ppef.type, 'PPEF');
    assert.equal(ppef.refId, block.id, 'the PPEF row reads the block');
    assert.equal(ppef.target, 0.1);
    assert.equal(ppef.weight, 1);
    assert.equal(loss.type, 'TDBMN');
    assert.equal(loss.target, -0.4, 'the insertion loss floor');
    const lowest = lambdas[gain.y.indexOf(Math.min(...gain.y))];
    assert.equal(loss.lambdaStart, lowest, 'held where the target is highest, at the gain minimum');
    assert.equal(loss.lambdaEnd, lowest);

    assert.equal(result.curves.length, 1, 'the derived target goes on the design');
    const curve = result.curves[0];
    assert.equal(curve.name, 'edfa flattening target');
    assert.equal(curve.quantity, 'T');
    assert.equal(block.curveId, curve.id);
    near(Math.max(...curve.y), 1, 1e-12, 'the target is 0 dB at the gain minimum');
    curve.y.forEach((value, i) => near(10 * Math.log10(value), Math.min(...gain.y) - gain.y[i], 1e-9, `point ${i}`));

    const again = curveWizardRows({
        typeId: 'GAIN_FLATTENING', params, flatteningName,
        design: { ...design, measuredCurves: [curve] },
    });
    assert.equal(again.curves.length, 0, 'generating again does not add a second copy');
    assert.equal(again.rows[0].curveId, curve.id);

    const block2 = buildWizardResult({
        tw: { types: { GAIN_FLATTENING: { label: 'Gain flattening' } } },
        typeId: 'GAIN_FLATTENING', curveRows: result,
        constraintsEnabled: true, minThick: 10, maxThick: 500,
    }).block;
    assert.deepEqual(block2.map(op => op.type), ['DMFS', 'MCURVE', 'PPEF', 'TDBMN', 'MNT', 'MXT']);
    assert.match(block2[0].comment, /^Gain flattening, edfa flattening target; ≥10 nm, ≤500 nm$/);

    // The rows evaluate, and a refinement lowers the peak-to-peak error.
    const operands = result.rows;
    const withCurve = { ...design, measuredCurves: [curve] };
    const before = evaluateOperands(operands, buildEvalContext(withCurve, resolve));
    assert.ok(operandEvaluationErrors(before).every(error => error == null), 'every row evaluates');
    const engine = new DLSOptimizer(operands, withCurve, resolve);
    const mf0 = engine.mf;
    for (let step = 0; step < 40 && !engine.isConverged(); step++) engine.step();
    engine.restoreBest();
    assert.ok(engine.mf < mf0, `the merit falls (${mf0} to ${engine.mf})`);
    const refined = engine.applyToDesign(withCurve);
    const after = evaluateOperands(operands, buildEvalContext(refined, resolve));
    assert.ok(after[1] < before[1], `the peak-to-peak error falls (${before[1]} to ${after[1]} dB)`);
    assert.ok(Number.isFinite(calcMF(operands, after)));
}

// -- Target input, Curve, and what is missing -----------------------------------
{
    const curve = gainTargetCurve(gain, {}, 'loss profile');
    const withCurve = { ...design, measuredCurves: [curve] };
    const fromTarget = curveWizardRows({
        typeId: 'GAIN_FLATTENING', design: withCurve, params: { ...params, input: 'target', curveId: curve.id },
    });
    assert.equal(fromTarget.curves.length, 0, 'a target already on the design is used as it is');
    assert.equal(fromTarget.rows[0].curveId, curve.id);

    const fit = curveWizardRows({ typeId: 'CURVE_TARGET', design: withCurve, params: { curveId: curve.id, scale: 'dB' } });
    const expected = measuredFitSnapshot(withCurve, curve, { scale: 'dB' }).operand;
    const { id: _a, ...fitRest } = fit.rows[0];
    const { id: _b, ...expectedRest } = expected;
    assert.deepEqual(fitRest, expectedRest, 'Curve writes the block Fit… writes');

    assert.equal(curveWizardRows({ typeId: 'CURVE_TARGET', design, params: {} }).error, 'noCurve');
    assert.equal(curveWizardRows({ typeId: 'GAIN_FLATTENING', design, params: { input: 'gain' } }).error, 'noGain');
    assert.equal(curveWizardRows({ typeId: 'GAIN_FLATTENING', design, params: { input: 'target' } }).error, 'noCurve');
    const failed = buildWizardResult({ tw: { types: {} }, typeId: 'CURVE_TARGET', curveRows: { error: 'noCurve' } });
    assert.deepEqual(failed.block, [], 'nothing is written');
    assert.equal(failed.error, 'noCurve');
}

// -- The form -------------------------------------------------------------------------
assert.deepEqual(fieldRows('GAIN_FLATTENING', { input: 'gain' }).map(row => [row.label, row.keys]),
    [['source', ['input', 'gain']], ['conditions', ['curveAoi', 'curvePol']], ['spec', ['insertionLossDb', 'ppefDb']]]);
assert.deepEqual(fieldRows('GAIN_FLATTENING', { input: 'target' }).map(row => [row.label, row.keys]),
    [['source', ['input', 'curveId']], ['spec', ['insertionLossDb', 'ppefDb']]],
    'a target input shows a curve in place of the gain and its conditions');

console.log('PASS: gain_flattening_wizard');
