/**
 * Reproducible benchmark for cone-node construction inside operand evaluation.
 * Run with: node tests/cone_angle_perf.mjs
 *
 * The "uncached" path uses the same evaluator with a Map-compatible sink, so
 * only node-grid reuse differs; TMM work and numeric results stay identical.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
    buildEvalContext, evaluateOperands, makeOperand,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';

// The GUI runs every TMM hot path on the WASM kernel, so a JS-fallback run
// here would time (and pace) a path the app never takes.
await initWasmForTest();
console.log(`cone-node cache benchmark · WASM ${tmmWasmActive() ? 'ON' : 'off (JS fallback)'}`);

const resolveMat = id => getMaterial(id);
const op = makeOperand({
    type: 'RAV', lambdaStart: 500, lambdaEnd: 550,
    aoi: 20, pol: 'avg', target: 0, weight: 1,
});
const noCache = { get: () => undefined, set: () => noCache };

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

function evaluate(layerCount, cached) {
    const context = buildEvalContext(design(layerCount), resolveMat);
    if (!cached) context._coneNodeCache = noCache;
    const value = evaluateOperands([op], context)[0];
    return { value, cacheSize: cached ? context._coneNodeCache.size : 0 };
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function timeCase(layerCount, repeats) {
    evaluate(layerCount, true);
    evaluate(layerCount, false);
    const samples = { cached: [], uncached: [] };
    for (let index = 0; index < repeats; index++) {
        for (const mode of index % 2 ? ['uncached', 'cached'] : ['cached', 'uncached']) {
            const start = performance.now();
            const result = evaluate(layerCount, mode === 'cached');
            samples[mode].push(performance.now() - start);
            if (mode === 'cached') assert.equal(result.cacheSize, 1, 'one grid cached for the one AOI');
        }
    }
    const cachedValue = evaluate(layerCount, true).value;
    const uncachedValue = evaluate(layerCount, false).value;
    assert.equal(cachedValue, uncachedValue, 'cache is bit-identical');
    const cachedMs = median(samples.cached);
    const uncachedMs = median(samples.uncached);
    return {
        layers: layerCount,
        wavelengthSamples: 26,
        angularNodes: 312,
        repeats,
        cachedMs: +cachedMs.toFixed(2),
        uncachedMs: +uncachedMs.toFixed(2),
        speedup: +(uncachedMs / cachedMs).toFixed(3),
    };
}

console.log(JSON.stringify({
    benchmark: 'cone node cache',
    node: process.version,
    cases: [timeCase(2, 7), timeCase(40, 5)],
}, null, 2));
