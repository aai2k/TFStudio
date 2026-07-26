import assert from 'node:assert/strict';

import { processLayer } from '../src/utils/monitoring/monitoringSim/layerLoop.js';
import { processMonoLayer } from '../src/utils/monitoring/monoSim/layerLoop.js';
import { _turningStep } from '../src/utils/monitoring/monoSim/cutSteps.js';

function makeMutableState() {
    return {
        acc: {
            asBuilt: [null],
            cutTimes: [null],
            realizedRates: [null],
            estimated: [null],
            cutStrategies: [null],
        },
        truthThicks: [0],
        modelThicks: [0],
        ouRate: new Map(),
        ouLastT: new Map(),
        tElapsed: 0,
        t_global: 0,
    };
}

const layer = { material: 'H', thickness: 100 };
const rates = new Map([['H', { mean: 1, sigma: 0 }]]);

{
    const mut = makeMutableState();
    processLayer(0, layer, {
        rates,
        excludeLayers: new Set([0]),
        relThkErrByLayer: [0],
        sigmaThkAbsNm: 0,
        sigmaThkRelPct: 0,
        shutterMeanS: 2,
        shutterRmsS: 0,
        rng: () => 0.5,
        N: 1,
    }, mut);

    assert.equal(mut.acc.asBuilt[0], 102);
    assert.equal(mut.tElapsed, 102);
    assert.equal(mut.t_global, 102);
}

{
    const mut = makeMutableState();
    processMonoLayer(0, layer, {
        rates,
        monTable: [{ strategy: 'time', sigmaRelPct: 0 }],
        refLam: 550,
        excludeLayers: new Set(),
        relThkErrByLayer: [0],
        shutterMeanS: 2,
        shutterRmsS: 0,
        rng: () => 0.5,
        N: 1,
    }, mut);

    assert.equal(mut.acc.asBuilt[0], 102);
    assert.equal(mut.acc.cutTimes[0], 102);
    assert.equal(mut.tElapsed, 102);
    assert.equal(mut.t_global, 102);
}

{
    const mut = makeMutableState();
    processMonoLayer(0, { material: 'H', thickness: 0 }, {
        rates,
        monTable: [{ strategy: 'time', sigmaRelPct: 0 }],
        refLam: 550,
        excludeLayers: new Set(),
        relThkErrByLayer: [0],
        shutterMeanS: 2,
        shutterRmsS: 0,
        rng: () => 0.5,
        N: 1,
    }, mut);

    assert.equal(mut.acc.realizedRates[0], 0);
    assert.equal(mut.acc.asBuilt[0], 0);
    assert.equal(mut.acc.cutTimes[0], 0);
    assert.equal(mut.acc.estimated[0], 0);
    assert.equal(mut.tElapsed, 0);
    assert.equal(mut.t_global, 0);
}

{
    const state = {
        runExtS: -Infinity,
        runExtD: 0,
        runExtT: 0,
        confirm: 0,
    };
    const config = {
        extIsMax: true,
        trackD0: 0,
        trackD1: 20,
        armD: 0,
        confirmScans: 2,
        noiseFrac: 0,
        bufFill: 1,
    };

    assert.equal(_turningStep(1, 10, 10, state, config), null);
    assert.equal(_turningStep(0.9, 11, 11, state, config), null);
    assert.deepEqual(_turningStep(0.8, 12, 12, state, config), { d: 12, t: 12 });
}

console.log('PASS: monitoring medium-severity regression guards');
