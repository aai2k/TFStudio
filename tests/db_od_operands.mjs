/**
 * Merit rows scored in dB and optical density: TDB, TDBMN, TDBMX, RDBMX, ODMN,
 * and the measured-curve block on the T-in-dB channel.
 *
 *   • Values are 10·log₁₀T (Macleod, Thin-Film Optical Filters 5th ed.,
 *     §8.2.1) and −log₁₀T (Ch. 5, neutral-density filters), the band rows at
 *     the extremum the linear TMN family finds.
 *   • σ = 10/ln 10 dB and 1/ln 10, so a miss by a factor of two scores ln 2
 *     at any level.
 *   • The analytic Jacobian matches central differences.
 *   • T = 0, beyond the critical angle, reads as the floor with a flat row.
 *   • A T-in-dB block expands into TDB points and scores the same merit.
 *   • Custom Target writes the matching row for each unit, and only for the
 *     combinations a row exists for.
 *   • The plot draws the targets at the percentage they stand for.
 *   • Fit... in dB stores a T-in-dB block and the curve it came from rebuilds.
 *
 * Run: node tests/db_od_operands.mjs
 */

import assert from 'node:assert/strict';

import {
    DLSOptimizer, buildEvalContext, calcMF, convertCustomTargetValue, customTargetComparisons,
    customTargetStatement, customTargetUnits, defaultFilterParams, evaluateOperands,
    expandMeasuredCurveOperands, generateFilterOperands, isFractionalUnit, isKnownOperandType,
    makeMeasuredCurveOperand, makeOperand, operandEvaluationErrors, operandResidualScale,
    targetDomain,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import {
    PERCENT_LEVEL, buildTargetGeometry, operandCurveKey,
} from '../src/utils/physics/spectrumTargets.js';
import { measuredFitSnapshot } from '../src/components/windows/dataExchange/spectrumExchange/model.js';
import { curveFromFitBlock } from '../src/components/windows/dataExchange/fitTargetCurves.js';

const resolve = id => getMaterial(id);
const near = (a, b, tol, message) => assert.ok(Math.abs(a - b) <= tol, `${message}: ${a} vs ${b}`);

const design = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: Array.from({ length: 14 }, (_, i) => ({
        id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness: i % 2 ? 95 : 60,
    })),
};
const values = ops => evaluateOperands(ops, buildEvalContext(design, resolve));
const op = (type, lambdaStart, lambdaEnd, extra = {}) => makeOperand({ type, lambdaStart, lambdaEnd, ...extra });

// -- Values -------------------------------------------------------------------
{
    const rows = [
        op('T', 550, 550), op('TDB', 550, 550),
        op('TMN', 500, 600), op('TMX', 500, 600), op('RMX', 700, 800),
        op('TDBMN', 500, 600), op('TDBMX', 500, 600), op('RDBMX', 700, 800), op('ODMN', 500, 600),
    ];
    const v = values(rows);
    assert.ok(operandEvaluationErrors(v).every(error => error == null), 'every row evaluates');
    const [T, TDB, TMN, TMX, RMX, TDBMN, TDBMX, RDBMX, ODMN] = v;
    near(TDB, 10 * Math.log10(T), 1e-12, 'TDB is T in dB');
    near(TDBMN, 10 * Math.log10(TMN), 1e-12, 'TDBMN is the lowest T in dB');
    near(TDBMX, 10 * Math.log10(TMX), 1e-12, 'TDBMX is the highest T in dB');
    near(RDBMX, 10 * Math.log10(RMX), 1e-12, 'RDBMX is the highest R in dB');
    near(ODMN, -Math.log10(TMX), 1e-12, 'ODMN, the lowest density, is at the highest T');
}

// -- σ and the residual -------------------------------------------------------
{
    const sigmaDb = 10 / Math.LN10;
    near(operandResidualScale(op('TDB', 550, 550)), sigmaDb, 1e-15, 'σ of a dB row');
    near(operandResidualScale(op('ODMN', 500, 600)), 1 / Math.LN10, 1e-15, 'σ of a density row');
    // A ceiling at −30 dB missed by a factor of two in T scores ln 2, whatever
    // the level: the merit of one row is |residual| / σ.
    const [TMX] = values([op('TMX', 500, 600)]);
    const level = 10 * Math.log10(TMX);
    const missed = op('TDBMX', 500, 600, { target: level - 10 * Math.log10(2) });
    near(calcMF([missed], values([missed])), Math.LN2, 1e-12, 'a factor-of-two miss scores ln 2');
    const met = op('TDBMX', 500, 600, { target: level + 1 });
    assert.equal(calcMF([met], values([met])), 0, 'a ceiling that is met scores nothing');
    const floor = op('ODMN', 500, 600, { target: -Math.log10(TMX) + Math.log10(2) });
    near(calcMF([floor], values([floor])), Math.LN2, 1e-12, 'a density floor missed by a factor of two scores ln 2');
}

// -- Jacobian against central differences ------------------------------------
{
    const [TMX, RMX] = values([op('TMX', 500, 600), op('RMX', 700, 800)]);
    const rows = [
        op('TDB', 550, 550, { target: -10 }),
        op('TDBMX', 500, 600, { target: 10 * Math.log10(TMX) - 3 }),
        op('RDBMX', 700, 800, { target: 10 * Math.log10(RMX) - 3 }),
        op('ODMN', 500, 600, { target: -Math.log10(TMX) + 0.3 }),
    ];
    const engine = new DLSOptimizer(rows, design, resolve, { fdStep: 0.01 });
    const thicknesses = engine.thicknesses;
    const free = thicknesses.map((_, index) => index);
    const analytic = engine._analyticJacobian(thicknesses, free);
    assert.ok(analytic, 'the dB and density rows take the analytic Jacobian');
    const differenced = engine._fdJacobian(thicknesses, free, analytic.length);
    for (let row = 0; row < analytic.length; row++) {
        const scale = Math.max(...differenced[row].map(Math.abs));
        for (let column = 0; column < free.length; column++) {
            near(analytic[row][column], differenced[row][column], 2e-3 * scale,
                `row ${rows[row].type}, layer ${column + 1}`);
        }
    }
}

// -- T = 0 reads as the floor -------------------------------------------------
{
    // Sapphire onto MgF2 past the critical angle, every medium lossless: no
    // light reaches the substrate.
    const glass = {
        ...design, incidentMedium: 'Al2O3', substrate: { material: 'MgF2', thickness: 1 },
        frontLayers: [{ id: 'L1', material: 'SiO2', thickness: 100 }],
    };
    const row = op('TDB', 550, 550, { aoi: 75, target: -10 });
    const v = evaluateOperands([row], buildEvalContext(glass, resolve));
    assert.equal(operandEvaluationErrors(v)[0], null, 'the row evaluates');
    near(v[0], -150, 1e-9, 'T = 0, computed as rounding residue, reads the −150 dB floor');
    const engine = new DLSOptimizer([row], glass, resolve);
    const jacobian = engine._analyticJacobian(engine.thicknesses, [0]);
    assert.ok(jacobian[0].every(Number.isFinite) && jacobian[0][0] === 0, 'below the floor the row is flat');
}

// -- A block on the T-in-dB channel ------------------------------------------
{
    const lambdas = [500, 525, 550, 575, 600];
    const block = makeMeasuredCurveOperand({ quantity: 'TDB', sampleLambdas: lambdas, sampleTargets: [-10, -12, -15, -12, -10] });
    near(operandResidualScale(block), 10 / Math.LN10, 1e-15, 'the block is scored in dB');
    const points = expandMeasuredCurveOperands([block]);
    assert.ok(points.length === lambdas.length && points.every(point => point.type === 'TDB'), 'it expands into TDB points');
    near(calcMF(points, values(points)), calcMF([block], values([block])), 1e-12, 'both forms score the same merit');
    assert.ok(!isFractionalUnit('TDB'), 'a dB row is not shown in percent');
}

// -- Custom Target ------------------------------------------------------------
{
    const generate = params => generateFilterOperands('CUSTOM_TARGET',
        { ...defaultFilterParams('CUSTOM_TARGET'), lamStart: 500, lamEnd: 600, ...params }, { pol: 'avg', stepNm: 10 });
    assert.deepEqual(customTargetUnits('T'), ['pct', 'dB', 'OD']);
    assert.deepEqual(customTargetUnits('R'), ['pct', 'dB']);
    assert.deepEqual(customTargetUnits('A'), ['pct']);
    assert.deepEqual(customTargetComparisons('R', 'dB'), ['le']);
    assert.deepEqual(customTargetComparisons('T', 'OD'), ['ge']);
    const cases = [
        [{ channel: 'T', unit: 'dB', cmp: 'ge', valuePct: -0.5 }, 'TDBMN', 1],
        [{ channel: 'T', unit: 'dB', cmp: 'le', valuePct: -30 }, 'TDBMX', 1],
        [{ channel: 'R', unit: 'dB', cmp: 'le', valuePct: -40 }, 'RDBMX', 1],
        [{ channel: 'T', unit: 'OD', cmp: 'ge', valuePct: 3 }, 'ODMN', 1],
        [{ channel: 'T', unit: 'dB', cmp: 'eq', valuePct: -3 }, 'TDB', 11],
    ];
    for (const [params, type, count] of cases) {
        const rows = generate(params);
        assert.equal(rows.length, count, `${type}: ${count} row(s)`);
        assert.ok(rows.every(row => row.type === type && row.target === params.valuePct), `${type} with the typed value`);
    }
    assert.deepEqual(generate({ channel: 'T', unit: 'dB', cmp: 'eq', valuePct: -3 }).map(row => row.lambdaStart),
        [500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600], 'TDB points on the step');
    // A combination with no row behind it falls back to one that has.
    assert.equal(customTargetStatement({ channel: 'R', unit: 'dB', cmp: 'ge' }).cmp, 'le');
    assert.equal(customTargetStatement({ channel: 'A', unit: 'dB', cmp: 'eq' }).unit, 'pct');
    assert.equal(generate({ channel: 'A', unit: 'dB', cmp: 'le', valuePct: 5 })[0].type, 'AMX');
    // A value above 0 dB is held to 0 dB.
    assert.equal(generate({ channel: 'T', unit: 'dB', cmp: 'le', valuePct: 2 })[0].target, 0);
    assert.equal(convertCustomTargetValue(80, 'pct', 'dB'), -0.97);
    assert.equal(convertCustomTargetValue(0.1, 'pct', 'OD'), 3);
    assert.equal(convertCustomTargetValue(-30, 'dB', 'OD'), 3);
    assert.equal(convertCustomTargetValue(3, 'OD', 'pct'), 0.1);
}

// -- Operand model --------------------------------------------------------------
{
    for (const type of ['TDB', 'TDBMN', 'TDBMX', 'RDBMX', 'ODMN']) assert.ok(isKnownOperandType(type), `${type} is known`);
    assert.equal(targetDomain('TDBMX'), 'dB');
    assert.equal(targetDomain('ODMN'), 'OD');
    assert.equal(makeOperand({ type: 'TDBMX' }).target, -30, 'a new ceiling starts at −30 dB, not the fractional default');
    assert.equal(makeOperand({ type: 'ODMN' }).target, 3);
}

// -- The plot -------------------------------------------------------------------
{
    near(PERCENT_LEVEL.toAxis(-30, 'TDBMX'), 0.1, 1e-12, '−30 dB draws at 0.1 %');
    near(PERCENT_LEVEL.toAxis(3, 'ODMN'), 0.1, 1e-12, 'OD 3 draws at 0.1 %');
    near(PERCENT_LEVEL.fromAxis(0.1, 'ODMN'), 3, 1e-12, 'a drag to 0.1 % is OD 3');
    near(PERCENT_LEVEL.toAxis(0.5, 'T'), 50, 1e-12, 'a fraction still draws in percent');
    assert.equal(operandCurveKey({ type: 'ODMN', pol: 'avg' }), 'T', 'a density target belongs to the T curve');
    assert.equal(operandCurveKey({ type: 'RDBMX', pol: 's' }), 'Rs');
    const geometry = buildTargetGeometry([
        op('TDBMX', 500, 600, { target: -20 }), op('TDB', 550, 550, { target: -3 }),
    ]);
    assert.equal(geometry.lines.length, 1, 'a band row draws as a line');
    assert.ok(geometry.lines[0].points.every(point => Math.abs(point[1] - 1) < 1e-9), 'at 1 %');
    const marker = geometry.markers.find(item => item.x === 550 && item.label.startsWith('TDB '));
    near(marker.y, 100 * 10 ** -0.3, 1e-9, 'a TDB point draws at its percentage');
}

// -- Fit... in dB ---------------------------------------------------------------
{
    const curve = {
        id: 'gain', name: 'Target loss', quantity: 'T', aoi: 0, pol: 'avg',
        x: [500, 520, 540, 560, 580, 600], y: [0.9, 0.5, 0.25, 0, 0.5, 0.9],
    };
    const snapshot = measuredFitSnapshot(design, curve, { scale: 'dB', clipToCoverage: false });
    assert.equal(snapshot.operand.quantity, 'TDB', 'the block is on the T-in-dB channel');
    assert.equal(snapshot.droppedNonPositive, 1, 'the point at 0 % is left out and counted');
    assert.deepEqual(snapshot.operand.sampleLambdas, [500, 520, 540, 580, 600]);
    near(snapshot.operand.sampleTargets[2], 10 * Math.log10(0.25), 1e-12, 'points are stored in dB');
    const rebuilt = curveFromFitBlock(snapshot.operand);
    assert.equal(rebuilt.quantity, 'T', 'the rebuilt curve is a T curve');
    near(rebuilt.y[2], 0.25, 1e-12, 'with its points in transmittance');
    const linear = measuredFitSnapshot(design, { ...curve, quantity: 'R' }, { scale: 'dB', clipToCoverage: false });
    assert.equal(linear.operand.quantity, 'R', 'only a T curve is fitted in dB');
}

console.log('PASS: db_od_operands');
