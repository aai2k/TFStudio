/**
 * A merit row of a type this build does not know, and a measured-curve block on
 * a channel it does not know, are refused with a reason on the row instead of
 * being scored as T, R or A. A newer TFStudio writes such rows; scored by the
 * first letter of the type, a T-in-dB row at -30 dB would be read as a
 * transmittance 30 away from its target.
 *
 * Run: node tests/unknown_operand_types.mjs
 */

import assert from 'node:assert/strict';

import {
    buildEvalContext,
    calcMF,
    evaluateOperands,
    expandMeasuredCurveOperands,
    isKnownOperandType,
    makeMeasuredCurveOperand,
    makeOperand,
    operandEvaluationErrors,
} from '../src/utils/physics/optimizer.js';
import { operandSpectrumReads } from '../src/utils/physics/optimizer/evalCore/operands/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const design = {
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [{ id: 'L1', material: 'TiO2', thickness: 60 }],
    backLayers: [],
    surfaceMode: 'front_only',
    mfEvalMode: 'side',
};
const ctx = () => buildEvalContext(design, id => getMaterial(id));

// Every type the table offers, and the s/p-suffixed rows of older designs, is
// known; a made-up one is not.
for (const type of ['T', 'TAV', 'RMX', 'MCURVE', 'PSI', 'GDFLAT', 'OPGT', 'MXWT', 'TT', 'STR', 'MNT', 'BLNK', 'DMFS', 'TS', 'RP', 'AS']) {
    assert.ok(isKnownOperandType(type), `${type} is a known type`);
}
assert.ok(!isKnownOperandType('TDBX'), 'a made-up type is not known');

// The s/p-suffixed rows still evaluate, as their base type with that
// polarization.
{
    const s = evaluateOperands([makeOperand({ type: 'TS', lambdaStart: 550, lambdaEnd: 550, aoi: 45 })], ctx());
    const base = evaluateOperands([makeOperand({ type: 'T', pol: 's', lambdaStart: 550, lambdaEnd: 550, aoi: 45 })], ctx());
    assert.equal(operandEvaluationErrors(s)[0], null, 'a TS row evaluates');
    assert.equal(s[0], base[0], 'a TS row reads T in s polarization');
}

// An unknown type: no value, the reason on the row, and no merit.
{
    const operands = [
        makeOperand({ type: 'TAV', lambdaStart: 450, lambdaEnd: 650, target: 0.9 }),
        makeOperand({ type: 'TDBX', lambdaStart: 550, lambdaEnd: 550, target: -30 }),
    ];
    const computed = evaluateOperands(operands, ctx());
    const errors = operandEvaluationErrors(computed);
    assert.equal(errors[0], null, 'the known row still evaluates');
    assert.equal(computed[1], null, 'the unknown row has no value');
    assert.match(errors[1], /type TDBX is of a kind this version of TFStudio does not know/);
    assert.equal(calcMF(operands, computed), Infinity, 'the merit is refused');
    assert.equal(operandSpectrumReads(operands[1]), null, 'the unknown row reads no spectrum');
}

// A measured block on an unknown channel keeps that channel when seeded or
// duplicated, is left whole when a run expands blocks, and is refused.
{
    const block = makeMeasuredCurveOperand({
        quantity: 'TDBX', sampleLambdas: [500, 550, 600], sampleTargets: [-1, -2, -3],
    });
    assert.equal(block.quantity, 'TDBX', 'the channel is kept as written');
    assert.equal(makeOperand({ ...block }).quantity, 'TDBX', 'a copy keeps the channel');

    const expanded = expandMeasuredCurveOperands([block]);
    assert.equal(expanded.length, 1, 'the block is not expanded into points');
    assert.equal(expanded[0], block);

    const computed = evaluateOperands([block], ctx());
    const errors = operandEvaluationErrors(computed);
    assert.equal(computed[0], null, 'the block has no value');
    assert.match(errors[0], /channel TDBX is of a kind this version of TFStudio does not know/);
    assert.equal(calcMF([block], computed), Infinity, 'the merit is refused');
    assert.equal(operandSpectrumReads(block), null, 'the block reads no spectrum');
}

// A block with no channel recorded is still an R block.
{
    const block = makeMeasuredCurveOperand({ sampleLambdas: [500, 600], sampleTargets: [0.1, 0.2] });
    delete block.quantity;
    const computed = evaluateOperands([block], ctx());
    assert.equal(operandEvaluationErrors(computed)[0], null, 'a block with no channel evaluates');
    const asR = evaluateOperands([{ ...block, quantity: 'R' }], ctx());
    assert.equal(computed[0], asR[0], 'and reads R');
}

console.log('PASS: unknown_operand_types');
