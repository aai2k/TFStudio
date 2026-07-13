/**
 * Deterministic behavior guard for errorAnalysis.js maintainability refactors.
 *
 * Run: node tests/error_analysis_refactor_guard.mjs
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    computeLayerSensitivity,
    runErrorAnalysisMC,
} from '../src/utils/physics/errorAnalysis.js';

function makeRng(seed) {
    let a = seed >>> 0;
    let draws = 0;
    const rng = () => {
        draws++;
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.draws = () => draws;
    return rng;
}

function digest(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const materials = {
    Air: { getNK: () => [1, 0] },
    Sub: { getNK: () => [1.52, 0.002] },
    H: { getNK: (lambda) => [2.25 + lambda * 1e-5, 0.004] },
    L: { getNK: (lambda) => [1.46 + lambda * 5e-6, 0] },
};
const resolveMat = (id) => materials[id];

function makeDesign(surfaceMode = 'both_independent') {
    return {
        id: 'guard',
        referenceWavelength: 520,
        incidentMedium: 'Air',
        exitMedium: 'Air',
        substrate: { material: 'Sub', thickness: 0.8 },
        surfaceMode,
        frontLayers: [
            { id: 'F0', material: 'L', thickness: 0, locked: false },
            { id: 'F1', material: 'H', thickness: 70, locked: false },
            { id: 'F2', material: 'L', thickness: 105, locked: true },
        ],
        backLayers: [
            { id: 'B0', material: 'H', thickness: 55, locked: false },
            { id: 'B1', material: 'H', thickness: 90, locked: false },
        ],
    };
}

const params = {
    lambdaStart: 500,
    lambdaEnd: 540,
    lambdaStep: 20,
    theta: 17,
    polarization: 'avg',
};

async function mcScenario(seed, options, callbacks = {}) {
    const rng = makeRng(seed);
    const result = await runErrorAnalysisMC(makeDesign(), params, resolveMat, {
        char: 'R',
        nTrials: 3,
        rmsAbsNm: 0.4,
        rmsRelPct: 0.7,
        rmsReN: 0.012,
        rmsImN: 0.009,
        recordTrials: true,
        rng,
        ...options,
        ...callbacks,
    });
    return { result, rngDraws: rng.draws() };
}

const front = await mcScenario(101, {
    evalMode: 'front',
    distribution: 'gaussian',
});
assert.equal(front.result.trials.length, 3);
assert.ok(front.result.trials.every((trial) => trial.dThkF && trial.dThkB === null));
assert.ok(front.result.trials.every((trial) => trial.dnF && trial.dnB === null));
assert.ok(front.result.trials.some((trial) => trial.dkF[1] < -0.004 || trial.dkF[2] < 0));

const back = await mcScenario(202, {
    evalMode: 'back',
    distribution: 'uniform',
    perMaterialErrors: true,
});
assert.ok(back.result.trials.every((trial) => trial.dThkF === null && trial.dThkB));
assert.ok(back.result.trials.every((trial) => trial.dnF === null && trial.dnB));
assert.equal(back.result.trials[0].dnB[0], back.result.trials[0].dnB[1]);

const events = [];
let cancel = false;
const total = await mcScenario(303, {
    evalMode: 'total',
    distribution: 'truncated',
    keepOpticalThickness: true,
    evaluateSpec: true,
    qualifiers: [
        { enabled: true, kind: 'THICKNESS_BUDGET', cmp: 'le', target: 320, label: 'budget' },
        { enabled: true, kind: 'LAYER_COUNT', cmp: 'le', target: 5, label: 'count' },
    ],
    nTrials: 5,
    yieldEvery: 2,
}, {
    onTrial: ({ i, total: count }) => events.push(`trial:${i}/${count}`),
    onYield: async (i) => { events.push(`yield:${i}`); cancel = true; },
    shouldCancel: () => { events.push('cancel?'); return cancel; },
});
assert.equal(total.result.nTrials, 2);
assert.deepEqual(events, ['trial:1/5', 'cancel?', 'trial:2/5', 'yield:2', 'cancel?']);
assert.ok(total.result.trials.every((trial) => trial.dThkF && trial.dThkB));
assert.ok(total.result.trials.every((trial) => trial.spec !== null));
assert.equal(total.result.spec.evaluated, 2);
const totalFirst = total.result.trials[0];
const nNominal = materials.H.getNK(520)[0];
assert.equal(totalFirst.dThkF[1], 70 * (nNominal / (nNominal + totalFirst.dnF[1]) - 1));

const operands = [{
    type: 'RAV', lambdaStart: 500, lambdaEnd: 540,
    aoi: 0, pol: 'avg', target: 0, weight: 1, enabled: true,
}];
const sensitivity = {};
for (const surfaceMode of ['front_only', 'back_only', 'symmetric', 'both_independent']) {
    sensitivity[surfaceMode] = computeLayerSensitivity(
        makeDesign(surfaceMode), operands, resolveMat,
        { mode: 'absolute', absDeltaNm: -0.6, includeLocked: false },
    );
}
assert.deepEqual(
    sensitivity.front_only.rows.map(({ index, side, layerIndex }) => [index, side, layerIndex]),
    [[0, 'front', 0], [1, 'front', 1]],
);
assert.deepEqual(
    sensitivity.back_only.rows.map(({ index, side, layerIndex }) => [index, side, layerIndex]),
    [[0, 'back', 0], [1, 'back', 1]],
);
assert.deepEqual(
    sensitivity.symmetric.rows.map(({ index, side, layerIndex }) => [index, side, layerIndex]),
    [[0, 'front', 0], [1, 'front', 1]],
);
assert.deepEqual(
    sensitivity.both_independent.rows.map(({ index, side, layerIndex }) => [index, side, layerIndex]),
    [[0, 'front', 0], [1, 'front', 1], [3, 'back', 0], [4, 'back', 1]],
);

const actual = {
    front: digest(front),
    back: digest(back),
    total: digest({ ...total, events }),
    sensitivity: digest(sensitivity),
};
const expected = {
    front: '3ea4c67a0669bec4cade60e2c11dca970a32f58ff865a4b7f7c975e9b27fd929',
    back: 'fb3ba080a11efaa9d993ee9434f1c1cf52c083570e5567dd8417a415691442fb',
    total: '727f70c1538da49f74fc59b3fd0e45fad9194a5be0664d24e4b96431c0116851',
    sensitivity: '593cfae424e6cc720e8bdfd55aedbfb0389676ded3f492c1f8c2568d68a86b7b',
};

if (Object.values(expected).some((value) => !value)) {
    console.log(JSON.stringify(actual, null, 2));
    process.exitCode = 1;
} else {
    assert.deepEqual(actual, expected);
    console.log('PASS: error_analysis_refactor_guard');
}
