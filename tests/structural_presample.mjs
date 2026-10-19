/**
 * The Structural Optimizer's worker material tables score the merit the main
 * thread scores. A worker refine reads its materials only from these tables,
 * so a table that dropped the films' mechanical constants scored STR as if no
 * film were stressed, and one without frequency responses left GD and GDD rows
 * unavailable, while the main thread accepted or rejected on the real values.
 *
 * Each table goes through structuredClone, as postMessage sends it, and the
 * worker resolver evaluates the same rows the main thread does.
 */
import assert from 'node:assert/strict';
import {
    buildEvalContext, evaluateOperands, makeOperand,
} from '../src/utils/physics/optimizer.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { makeResolveMat } from '../src/utils/workers/resolveMat.js';
import { presampleAll } from '../src/utils/structural/refine.js';

const warnings = [];
const collect = message => warnings.push(message);

// User materials carrying measured stress, embedded in the design as a file
// carries them; the pool adds a built-in.
const MATERIALS = {
    'user_s:H': {
        id: 'H', name: 'High index (stressed)', formulaNum: -1,
        tabData: [[400, 2.45, 0], [550, 2.37, 0], [700, 2.30, 0]],
        mechanical: { youngsModulusGPa: 200, poissonsRatio: 0.25, intrinsicStressMPa: -300 },
    },
    'user_s:L': {
        id: 'L', name: 'Low index (stressed)', formulaNum: -1,
        tabData: [[400, 1.48, 0], [550, 1.465, 0], [700, 1.45, 0]],
        mechanical: { youngsModulusGPa: 70, poissonsRatio: 0.17, intrinsicStressMPa: 150 },
    },
};
const design = {
    incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [
        { id: 'F1', material: 'user_s:H', thickness: 100 },
        { id: 'F2', material: 'user_s:L', thickness: 150 },
        { id: 'F3', material: 'user_s:H', thickness: 80 },
    ],
    backLayers: [],
    surfaceMode: 'front_only',
    materials: MATERIALS,
};
const pool = [{ id: 'builtin:TiO2' }];

const operands = [
    makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }),
    makeOperand({ type: 'STR', target: 0, weight: 1 }),
    makeOperand({ type: 'GD', lambdaStart: 550, aoi: 0, pol: 's', target: 5, weight: 1 }),
    makeOperand({ type: 'GDD', lambdaStart: 550, aoi: 0, pol: 's', target: -3, weight: 1 }),
];

const mainThread = evaluateOperands(operands, buildEvalContext(design, designMaterialLookup(design)));
const table = structuredClone(presampleAll(design, operands, pool));
const worker = evaluateOperands(operands, buildEvalContext(design, makeResolveMat(table, 'structural', collect)));

assert.ok(mainThread[1] !== 0, 'the design does put a force on the substrate');
operands.forEach((op, i) => {
    assert.ok(Number.isFinite(worker[i]), `${op.type} evaluates in the worker`);
    assert.equal(worker[i], mainThread[i], `${op.type} scores the same in the worker as on the main thread`);
});
assert.equal(warnings.length, 0, 'no lookup fell back or went without a frequency response');
assert.deepEqual(table['user_s:H'].mechanical, MATERIALS['user_s:H'].mechanical, 'the table carries the mechanical block');
assert.ok(table['builtin:TiO2'] && table.Air, 'pool materials and Air are sampled too');

console.log('structural_presample: ok');
