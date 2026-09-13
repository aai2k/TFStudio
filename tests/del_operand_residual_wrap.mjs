/**
 * A Δ target next to the 0°/360° wrap scores the short way round.
 *
 * Δ leaves the point evaluator wrapped into [0°, 360°), so a design sitting at
 * 359° against a target of 1° is two degrees away. The residual used to read
 * val − target there, 358, and jumped by 360 as Δ crossed the cut; a merit
 * function that jumps in the quantity it minimizes does not converge, and the
 * operand pulled the optimizer the long way round. Phase-shift operands
 * already wrapped; Δ now follows the same rule, in the merit function and in
 * the table's residual readout alike.
 *
 * Run: node tests/del_operand_residual_wrap.mjs
 */
import assert from 'node:assert/strict';
import {
    _operandResidual, buildEvalContext, calcMF, evaluateOperands, isWrappedAngle, makeOperand,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { rowDisplayMeta } from '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandViewModel.js';

const resolveMat = id => getMaterial(id);

// ── Which operands wrap ──────────────────────────────────────────────────────
assert.ok(isWrappedAngle('DEL'), 'Δ wraps');
assert.ok(['PR', 'PT', 'DPR', 'DPT'].every(isWrappedAngle), 'phase shifts already did');
assert.ok(['PSI', 'TANPSI', 'COSDEL', 'GD', 'R'].every(type => !isWrappedAngle(type)),
    'Ψ cannot leave 0 to 90, and tanΨ and cosΔ are plain numbers');

// ── The residual itself ──────────────────────────────────────────────────────
const del = target => makeOperand({ type: 'DEL', lambdaStart: 550, aoi: 70, target });
assert.equal(_operandResidual(del(1), 359), -2, '359° against 1° is two degrees short, not 358 long');
assert.equal(_operandResidual(del(359), 1), 2);
assert.equal(_operandResidual(del(180), 90), -90, 'away from the cut nothing changes');
assert.equal(Math.abs(_operandResidual(del(0), 180)), 180, 'half a turn is half a turn either way');
assert.equal(rowDisplayMeta(del(1), 359, false).rawResidual, -2,
    'the table reads the same residual the merit function scores');

// ── The merit stays continuous as Δ crosses the cut ──────────────────────────
//
// A single SiO2 layer on BK7 at 70°, above Brewster, holds Δ within a degree
// of the cut and crosses it near 122 nm. The raw Δ jumps by 360 there; the
// residual and the merit function must not.
function deltaAt(thickness, target) {
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [{ id: 'L1', material: 'SiO2', thickness }],
        backLayers: [], surfaceMode: 'front_only',
    };
    const ops = [del(target)];
    const computed = evaluateOperands(ops, buildEvalContext(design, resolveMat));
    return { raw: computed[0], residual: _operandResidual(ops[0], computed[0]), mf: calcMF(ops, computed) };
}
const trace = [];
for (let thickness = 100; thickness <= 150; thickness += 0.5) trace.push(deltaAt(thickness, 0.5));
const largestStep = key => Math.max(
    ...trace.slice(1).map((point, index) => Math.abs(point[key] - trace[index][key])));
assert.ok(largestStep('raw') > 300,
    `the sweep must cross the cut; largest raw Δ step was ${largestStep('raw').toFixed(2)}°`);
assert.ok(largestStep('residual') < 1,
    `the residual must not jump at the cut; largest step ${largestStep('residual').toFixed(3)}°`);
assert.ok(largestStep('mf') < 0.1,
    `the merit must not jump at the cut; largest step ${largestStep('mf').toFixed(4)}`);
assert.ok(trace.every(point => Math.abs(point.residual) <= 180));

console.log('PASS: del_operand_residual_wrap');
