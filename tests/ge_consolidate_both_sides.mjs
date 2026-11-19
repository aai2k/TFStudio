/**
 * Gradual Evolution's final consolidation takes the layers out of every side it
 * scans: on a design coated on both sides it tries the back stack too.
 *
 * Run: node tests/ge_consolidate_both_sides.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const O = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { runGradualEvolution } = await import('../src/utils/gradualEvolution/runGradualEvolution.js');
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');

const log = console.log; console.log = () => {};
const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const ops = [O.makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 })];
const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const design = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'both_independent', mfEvalMode: 'total',
    frontLayers: [layer('F1', 'TiO2', 30), layer('F2', 'SiO2', 50)],
    backLayers: [layer('B1', 'SiO2', 50), layer('B2', 'TiO2', 30)],
};

const jobs = [];
const runJob = (job, onTick) => new Promise((resolve, reject) => {
    jobs.push(job);
    dispatchSynthesisJob(job, makeResolveMat(job.materials || {}, 'both'), m => {
        if (m.type === 'tick') { onTick?.(m); return; }
        if (m.type === 'error') reject(new Error(m.message)); else resolve(m);
    });
});
const pool = {
    map: (batch, onProgress) => Promise.all(batch.map((job, i) => runJob(job, onProgress && (m => onProgress(i, m))))),
    run: runJob, terminate() {},
};
await runGradualEvolution(design, ops, { pool: POOL, maxLayers: 6, maxGeCycles: 2, targetMF: 1e-6, refineIter: 10, dMin: 15, threads: 2 },
    { makeWorkerPool: () => pool });
console.log = log;

const sides = jobs.filter(job => job.type === 'removePass').map(job => job.side);
assert.deepEqual(sides, ['front', 'back'], `consolidation tries the front and then the back (${sides.join(', ')})`);
console.log('PASS ge_consolidate_both_sides');
