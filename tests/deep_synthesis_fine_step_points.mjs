/**
 * Deep Synthesis takes its target points from every sample of the merit's T
 * and R rows (deepSynthesis/points.js targetPoints). A band row at the finest
 * Step, 0.001 nm over 400-1600 nm, has 1,200,001 samples, more than a call can
 * take as arguments, and the run must still start: every sample is a point,
 * and the points share the row's weight.
 *
 * Run: node tests/deep_synthesis_fine_step_points.mjs
 */
import assert from 'node:assert/strict';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { targetPoints } from '../src/utils/synthesis/deepSynthesis/points.js';

const row = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 1600, aoi: 0, pol: 'avg', target: 1, weight: 2, flag: 4 });
const ev = { operands: [row], incident: 'Air', n: () => 1 };

let built;
assert.doesNotThrow(() => { built = targetPoints(ev); }, 'the points of a row at the finest Step are built');
assert.equal(built.points.length, 1200001, 'one point per sample');
assert.ok(built.points.every(p => p.kind === 'pass'), 'each a pass point, the row asking for T = 1');
const weight = built.points.reduce((sum, p) => sum + p.weight, 0);
assert.ok(Math.abs(weight - 2) < 1e-9, `the points share the row's weight (${weight})`);

console.log('PASS: deep_synthesis_fine_step_points');
