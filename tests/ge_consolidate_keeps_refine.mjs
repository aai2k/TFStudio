/**
 * Gradual Evolution's closing consolidation keeps the design its refine reached
 * when the remove pass takes no layer out.
 *
 * The remove pass refines the best design before it tries any removal. When no
 * removal is accepted it still returns that refined design. If it scores below
 * the best, the run ends on it and records it as a Refine row, so the history
 * holds the design the run ends on. A refine that does not beat the best leaves
 * the best as it was.
 *
 *   1. A front pass that removes nothing and refines to a lower merit: the
 *      run's front stack is the refined one, the run's merit is that merit, and
 *      the last row is a 'refine' row on the front holding that design.
 *   2. A pass that removes nothing and does not beat the best: the result and
 *      the rows are those of a run whose pass changed nothing.
 *
 * The jobs are the real synthesis jobs; only the remove pass's answer is
 * scripted.
 *
 * Run: node tests/ge_consolidate_keeps_refine.mjs
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

const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const ops = [O.makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 })];
const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const design = () => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'both_independent', mfEvalMode: 'total',
    frontLayers: [layer('F1', 'TiO2', 30), layer('F2', 'SiO2', 50)],
    backLayers: [layer('B1', 'SiO2', 50), layer('B2', 'TiO2', 30)],
});

const runJob = (job, onTick, answer) => new Promise((resolve, reject) => {
    dispatchSynthesisJob(job, makeResolveMat(job.materials || {}, 'keeps'), m => {
        if (m.type === 'tick') { onTick?.(m); return; }
        if (m.type === 'error') { reject(new Error(m.message)); return; }
        resolve(job.type === 'removePass' ? answer(m, job) : m);
    });
});

// `answer(real, job)` turns the real remove pass's result into the scripted one.
async function run(answer) {
    const rows = [];
    const pool = {
        map: (batch, onProgress) => Promise.all(batch.map((job, i) => runJob(job, onProgress && (m => onProgress(i, m)), answer))),
        run: (job, onProgress) => runJob(job, onProgress, answer),
        terminate() {},
    };
    const log = console.log; console.log = () => {};
    let result;
    try {
        result = await runGradualEvolution(design(), ops,
            { pool: POOL, maxLayers: 6, maxGeCycles: 2, targetMF: 1e-6, refineIter: 10, dMin: 15, threads: 2 },
            { makeWorkerPool: () => pool, onRow: row => rows.push(row) });
    } finally { console.log = log; }
    return { result, rows };
}
const same = (a, b) => a.length === b.length && a.every((l, i) => l.material === b[i].material && l.thickness === b[i].thickness);
const unchanged = real => ({ ...real, removed: 0, mf: Infinity, omf: Infinity });

// 1. The front pass keeps every layer and refines far below the best.
{
    let refined = null;
    const { result, rows } = await run((real, job) => {
        if (job.side !== 'front') return unchanged(real);
        const frontLayers = real.frontLayers.map((l, i) => ({ ...l, thickness: l.thickness + (i === 0 ? 1 : 0) }));
        refined = { ...real, removed: 0, mf: 1e-9, omf: 1e-9, frontLayers, nLayers: frontLayers.length + real.backLayers.length };
        return refined;
    });
    assert.ok(refined, 'setup: the run reached the front remove pass');
    assert.equal(result.mf, 1e-9, 'the run ends on the refined merit');
    assert.ok(same(result.frontLayers, refined.frontLayers), 'and on the refined front stack');
    const last = rows[rows.length - 1];
    assert.equal(last.type, 'refine', 'the last row is a Refine row');
    assert.equal(last.side, 'front', 'on the front');
    assert.equal(last.mf, 1e-9, 'with the refined merit');
    assert.ok(same(last.frontSnap, refined.frontLayers), 'and the refined design');
}

// 2. The front pass keeps every layer and does not beat the best.
{
    const base = await run(unchanged);
    const { result, rows } = await run((real, job) => ({
        ...unchanged(real),
        frontLayers: job.side === 'front' ? real.frontLayers.map(l => ({ ...l, thickness: l.thickness + 5 })) : real.frontLayers,
    }));
    assert.ok(same(result.frontLayers, base.result.frontLayers), 'a refine that does not beat the best leaves the best design');
    assert.equal(result.mf, base.result.mf, 'and its merit');
    assert.equal(rows.length, base.rows.length, 'and adds no row');
}

console.log('PASS ge_consolidate_keeps_refine');
