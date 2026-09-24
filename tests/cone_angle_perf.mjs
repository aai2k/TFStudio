/**
 * Reproducible benchmark for cone-averaged operand evaluation.
 * Run with: node tests/cone_angle_perf.mjs
 *
 * The first evaluation on a context settles the cone's rays for every band
 * sample (evalCore/coneNodeCount.js); every later evaluation on that context,
 * which is every step of a run, reuses them. This times both and checks the
 * reuse is bit-identical.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
    buildEvalContext, evaluateOperands, makeOperand, operandSampleLambdas,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';

// The GUI runs every TMM hot path on the WASM kernel, so a JS-fallback run
// here would time (and pace) a path the app never takes.
await initWasmForTest();
console.log(`cone evaluation benchmark · WASM ${tmmWasmActive() ? 'ON' : 'off (JS fallback)'}`);

const resolveMat = id => getMaterial(id);
const op = makeOperand({
    type: 'RAV', lambdaStart: 500, lambdaEnd: 550,
    aoi: 20, pol: 'avg', target: 0, weight: 1,
});

function design(layerCount) {
    return {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        surfaceMode: 'front_only', mfEvalMode: 'side',
        cone: { enabled: true, halfAngleDeg: 10, distribution: 'uniform', gridPoints: 24 },
        frontLayers: Array.from({ length: layerCount }, (_, index) => ({
            id: `l${index}`,
            material: index % 2 ? 'SiO2' : 'TiO2',
            thickness: index % 2 ? 95 : 55,
            locked: false,
        })),
        backLayers: [],
    };
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function timeCase(layerCount, repeats) {
    const samples = { first: [], settled: [] };
    let firstValue, settledValue, rays;
    for (let index = 0; index < repeats; index++) {
        const context = buildEvalContext(design(layerCount), resolveMat);
        let start = performance.now();
        firstValue = evaluateOperands([op], context)[0];
        samples.first.push(performance.now() - start);
        start = performance.now();
        settledValue = evaluateOperands([op], context)[0];
        samples.settled.push(performance.now() - start);
        rays = [...context._coneNodeCache.get(op.aoi).byLambda.values()].map(nodes => nodes.length);
    }
    assert.equal(settledValue, firstValue, 'reusing the settled rays is bit-identical');
    return {
        layers: layerCount,
        wavelengthSamples: operandSampleLambdas(op).length,
        raysPerSample: [Math.min(...rays), Math.max(...rays)],
        repeats,
        firstMs: +median(samples.first).toFixed(2),
        settledMs: +median(samples.settled).toFixed(2),
    };
}

console.log(JSON.stringify({
    benchmark: 'cone evaluation',
    node: process.version,
    cases: [timeCase(2, 7), timeCase(40, 5)],
}, null, 2));
