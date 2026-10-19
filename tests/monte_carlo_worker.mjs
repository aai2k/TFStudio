/**
 * The Monte Carlo window's run on the analysis worker (monteCarloRun.js).
 *
 * Checks:
 *   1. A run on the worker gives the result the same run gives on this thread,
 *      on a coating whose materials are embedded records, with thickness and
 *      index errors, n·d kept and a Specification check at a Step of its own.
 *   2. Stop ends the worker at once and keeps the result reported so far: the
 *      result of a run of that many trials with the same seed. Stop without
 *      keeping it gives none.
 *   3. A material that resolves nowhere fails the run with the message it
 *      fails with on this thread.
 *   4. Where no worker can be made the run stays on this thread, with the same
 *      result.
 *
 * Run: node tests/monte_carlo_worker.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';

// WASM on this thread, its bytes kept for the worker, so both run one kernel.
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);

const { BUILTIN_COATINGS } = await import('../src/utils/coatingLibrary/builtin/index.js');
const { entryDesign } = await import('../src/utils/coatingLibrary/entryModel.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { runErrorAnalysisMC } = await import('../src/utils/physics/errorAnalysis.js');
const { makeQualifier } = await import('../src/utils/synthesis/qualifiers.js');
const { startMonteCarloRun } = await import('../src/components/windows/analysis/errorAnalysis/monteCarloRun.js');

// A library coating that carries a material of its own, with a check on its
// band at 0.1 nm and an average over it.
const entry = BUILTIN_COATINGS.find(e => e.materials && Object.keys(e.materials).length > 0);
assert.ok(entry, 'the library holds a coating with an embedded material');
const [a, b] = entry.bands[0];
const qualifiers = [
    makeQualifier({ kind: 'MIN_MAX', channel: 'T', direction: 'max', cmp: 'ge', target: 0, lambdaStart: a, lambdaEnd: b, flag: 2 }),
    makeQualifier({ kind: 'T_AVG', cmp: 'ge', target: 0, lambdaStart: a, lambdaEnd: b }),
];
const design = { ...entryDesign(entry), qualifiers };
const params = { lambdaStart: a, lambdaEnd: b, lambdaStep: (b - a) / 20, theta: 0, polarization: 'avg' };
const options = nTrials => ({
    char: 'T', evalMode: 'front', nTrials, corridorSigma: 2, seed: 4242,
    rmsAbsNm: 0, rmsRelPct: 1, rmsReN: 0.002, rmsImN: 0, distribution: 'gaussian',
    perMaterialErrors: true, keepOpticalThickness: true,
    evaluateSpec: true, qualifiers, recordTrials: true,
});
const here = (d, opts) => runErrorAnalysisMC(d, params, designMaterialLookup(d), opts);

globalThis.Worker = NodeModuleWorker;

// ── 1. The same result as on this thread ────────────────────────────────────
{
    const progress = [];
    const run = startMonteCarloRun(design, params, options(40), p => progress.push(p));
    const result = await run.done;
    assert.deepStrictEqual(result, await here(design, options(40)), 'the worker gives the result of the run on this thread');
    assert.equal(result.trials.length, 40, 'with every trial\'s record');
    assert.deepEqual(progress.at(-1), { i: 40, total: 40 }, 'and the progress ends at the last trial');
}

// ── 2. Stop ─────────────────────────────────────────────────────────────────
{
    let stopNow;
    const reported = new Promise(resolve => { stopNow = resolve; });
    const run = startMonteCarloRun(design, params, options(100000), p => { if (p.i > 0) stopNow(); });
    await reported;
    run.stop();
    const kept = await run.done;
    assert.ok(kept.nTrials > 0 && kept.nTrials < 100000, `Stop keeps the trials reported: ${kept.nTrials}`);
    assert.deepStrictEqual(kept, await here(design, options(kept.nTrials)),
        'which is the result of a run of that many trials with the same seed');
    assert.equal(kept.trials.length, kept.nTrials, 'with their records');

    let again;
    const second = new Promise(resolve => { again = resolve; });
    const dropped = startMonteCarloRun(design, params, options(100000), p => { if (p.i > 0) again(); });
    await second;
    dropped.stop({ keep: false });
    assert.equal(await dropped.done, null, 'Stop without keeping the result gives none');
}

// ── 3. A material that resolves nowhere ─────────────────────────────────────
{
    const broken = { ...design, frontLayers: [...design.frontLayers, { id: 'x', material: 'user:nowhere', thickness: 50, locked: false }] };
    const message = await here(broken, options(3)).then(() => null, error => error.message);
    assert.ok(message, 'on this thread the run fails');
    const failed = await startMonteCarloRun(broken, params, options(3)).done.then(() => null, error => error.message);
    assert.equal(failed, message, 'and on the worker with the same message');
}

// ── 4. No worker ────────────────────────────────────────────────────────────
{
    globalThis.Worker = class { constructor() { throw new Error('no workers here'); } };
    const result = await startMonteCarloRun(design, params, options(10)).done;
    assert.deepStrictEqual(result, await here(design, options(10)), 'without a worker the run stays on this thread');

    // A worker that fails to load says nothing and fires an error.
    globalThis.Worker = class {
        postMessage() { setTimeout(() => this.onerror?.({}), 0); }
        terminate() {}
    };
    const loaded = await startMonteCarloRun(design, params, options(10)).done;
    assert.deepStrictEqual(loaded, await here(design, options(10)), 'and so it does when the worker fails to load');
}

console.log('PASS: monte_carlo_worker');
