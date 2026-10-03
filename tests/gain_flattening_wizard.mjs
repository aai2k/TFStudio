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
import { fieldRows, typeSwitch } from '../src/components/windows/optimization/meritFunctionEditor/wizardModel.js';
import { FILTER_CATEGORIES, defaultFilterParams } from '../src/utils/physics/optimizer.js';
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
        minEnabled: true, maxEnabled: true, minThick: 10, maxThick: 500,
    }).block;
    assert.deepEqual(block2.map(op => op.type), ['DMFS', 'MCURVE', 'PPEF', 'TDBMN', 'MNT', 'MXT']);
    assert.match(block2[0].comment, /^Gain flattening, edfa flattening target; ≥10 nm, ≤500 nm$/);
    const noMax = buildWizardResult({
        tw: { types: { GAIN_FLATTENING: { label: 'Gain flattening' } } },
        typeId: 'GAIN_FLATTENING', curveRows: result,
        minEnabled: true, maxEnabled: false, minThick: 10, maxThick: 500,
    }).block;
    assert.deepEqual(noMax.map(op => op.type), ['DMFS', 'MCURVE', 'PPEF', 'TDBMN', 'MNT'], 'a minimum with no maximum');
    assert.match(noMax[0].comment, /; ≥10 nm$/);

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

    // A design with no curve the type can take says so instead of asking for a
    // pick from an empty list. The only curve there is is taken without a pick;
    // with two, the wizard asks which.
    assert.equal(curveWizardRows({ typeId: 'CURVE_TARGET', design, params: {} }).error, 'noCurves');
    assert.equal(curveWizardRows({ typeId: 'CURVE_TARGET', design: withCurve, params: {} }).rows[0].curveId, curve.id,
        'the one curve on the design is taken without a pick');
    const twoCurves = { ...design, measuredCurves: [curve, { ...curve, id: 'second', name: 'Second' }] };
    assert.equal(curveWizardRows({ typeId: 'CURVE_TARGET', design: twoCurves, params: {} }).error, 'noCurve');
    assert.equal(curveWizardRows({ typeId: 'CURVE_TARGET', design: twoCurves, params: { curveId: 'second' } }).rows[0].curveId,
        'second', 'a pick among several is kept');
    assert.equal(curveWizardRows({ typeId: 'GAIN_FLATTENING', design, params: { input: 'gain' } }).error, 'noGain');
    assert.equal(curveWizardRows({ typeId: 'GAIN_FLATTENING', design, params: { input: 'target' } }).error, 'noCurves');
    assert.equal(curveWizardRows({ typeId: 'GAIN_FLATTENING', design: twoCurves, params: { input: 'target' } }).error, 'noCurve');
    const reflectanceOnly = { ...design, measuredCurves: [{ ...curve, id: 'r1', quantity: 'R' }] };
    assert.equal(curveWizardRows({ typeId: 'GAIN_FLATTENING', design: reflectanceOnly, params: { input: 'target' } }).error,
        'noCurves', 'a target loss curve is a T curve, so an R curve does not count');
    const failed = buildWizardResult({ tw: { types: {} }, typeId: 'CURVE_TARGET', curveRows: { error: 'noCurve' } });
    assert.deepEqual(failed.block, [], 'nothing is written');
    assert.equal(failed.error, 'noCurve');
}

// -- A gain typed into the curve editor ---------------------------------------------
{
    const { tableFromPoints, isValueTable } = await import('../src/components/windows/dataExchange/curveEditor/curveTable.js');
    const { applyProblem, pointsFromTable } = await import('../src/components/windows/dataExchange/curveEditor/curveApply.js');
    const { valueProblem, toStored } = await import('../src/components/windows/dataExchange/curveEditor/units.js');
    const { designBackdrop } = await import('../src/components/windows/dataExchange/curveEditor/designBackdrop.js');
    const points = [[1550, 21], [1530, 20.5], [1540, 22.1]];
    const table = tableFromPoints('gain', points);
    assert.ok(isValueTable('gain') && table.fixed, 'a gain is one fixed column');
    assert.equal(table.columns[0].unit, 'gain');
    assert.equal(toStored(22.1, 'gain'), 22.1, 'a gain is kept in dB as typed, not turned into a fraction');
    assert.equal(valueProblem('G', 'gain', 30), null, 'a gain above 0 dB is not out of range');
    assert.deepEqual(pointsFromTable(table), [[1530, 20.5], [1540, 22.1], [1550, 21]], 'sorted on Apply');
    assert.equal(applyProblem(tableFromPoints('gain', [[1530, 20]])), 'needTwoRows');
    assert.deepEqual(designBackdrop(design, table, {}), [null], 'no design curve behind a gain');
}

// -- The form -------------------------------------------------------------------------
// The input and the gain or curve take a row each in the Preset box; the
// derived target's conditions and the two specification values sit in the
// Angle and target box, one field to a row.
const keysOf = rows => rows.map(row => row.keys);
assert.deepEqual(keysOf(fieldRows('GAIN_FLATTENING', { input: 'gain' })), [['input'], ['gain']]);
assert.deepEqual(keysOf(fieldRows('GAIN_FLATTENING', { input: 'gain' }, 'angle')),
    [['curveAoi'], ['curvePol'], ['insertionLossDb'], ['ppefDb']]);
assert.deepEqual(keysOf(fieldRows('GAIN_FLATTENING', { input: 'target' })), [['input'], ['curveId']]);
assert.deepEqual(keysOf(fieldRows('GAIN_FLATTENING', { input: 'target' }, 'angle')), [['insertionLossDb'], ['ppefDb']],
    'a target input shows a curve in place of the gain, and no conditions of its own');
assert.deepEqual(keysOf(fieldRows('CURVE_TARGET', {}, 'angle')), []);

// Gain flattening starts with no layer maximum, since its layers run to several
// µm; leaving it turns the maximum back on, and other switches leave it alone.
const firstType = FILTER_CATEGORIES[0].types[0];
assert.equal(typeSwitch(firstType, 'GAIN_FLATTENING').maxEnabled, false, 'entering gain flattening turns MXT off');
assert.equal(typeSwitch('GAIN_FLATTENING', 'CURVE_TARGET').maxEnabled, true, 'leaving it turns MXT back on');
assert.ok(!('maxEnabled' in typeSwitch(firstType, 'CURVE_TARGET')), 'between other types the limits stay');
assert.deepEqual(typeSwitch(firstType, 'GAIN_FLATTENING').params, defaultFilterParams('GAIN_FLATTENING'));

console.log('PASS: gain_flattening_wizard');
