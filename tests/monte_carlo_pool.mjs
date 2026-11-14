/**
 * A Monte Carlo run with its trials spread over a pool of workers
 * (physics/errorAnalysis/mcPool.js): the Monte Carlo window's
 * (monteCarloRun.js) and the API's (api/monteCarloThreads.js).
 *
 * Checks:
 *   1. In the window and in the API, a pool of 1, 2, 3 or 8 gives the result
 *      the run gives on one thread with the same seed, bit for bit: with
 *      thickness and index errors drawn per material, n·d kept and a
 *      Specification check, and with index errors drawn per layer from a
 *      truncated distribution.
 *   2. Stop at a random trial keeps the result of a run of that many trials.
 *   3. A pool of 3 whose workers answer some trials late gives the same
 *      result, though the trials arrive out of order and adding them in the
 *      order they arrive gives another.
 *   4. tf.monteCarlo and tf.estimateYield give the result of the run on one
 *      thread, and a pool of no threads runs there.
 *   5. The API moves a run to threads only when they save more time than
 *      starting them takes; a run that stays and one that moves both give the
 *      result of the run on one thread, and report each trial once. On plain
 *      Node, which this test runs on, it starts no thread unless told how many.
 *   6. When one of the API's threads fails part-way, the run is made again on
 *      the calling thread and gives the whole run's result.
 *
 * Run: node tests/monte_carlo_pool.mjs
 */
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { NodeModuleWorker } from './_moduleWorker.mjs';

const api = await import('../src/api/index.js');
await api.init();

const { BUILTIN_COATINGS } = await import('../src/utils/coatingLibrary/builtin/index.js');
const { entryDesign } = await import('../src/utils/coatingLibrary/entryModel.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { runErrorAnalysisMC } = await import('../src/utils/physics/errorAnalysis.js');
const { makeMCConfig, openMCStatistics } = await import('../src/utils/physics/errorAnalysis/mcConfig.js');
const { foldMCTrial, finalizeMCResult } = await import('../src/utils/physics/errorAnalysis/mcResult.js');
const { makeQualifier } = await import('../src/utils/synthesis/qualifiers.js');
const { resolveEvalMode } = await import('../src/utils/physics/optimizer.js');
const { startMonteCarloRun } = await import('../src/components/windows/analysis/errorAnalysis/monteCarloRun.js');
const { runOnThreads, runMonteCarlo, threadsPayOff } = await import('../src/api/monteCarloThreads.js');

// A library coating that carries a material of its own, with a check on its
// band at 0.1 nm and an average over it.
const entry = BUILTIN_COATINGS.find(e => e.materials && Object.keys(e.materials).length > 0);
assert.ok(entry, 'the library holds a coating with an embedded material');
const [a, b] = entry.bands[0];
const qualifiers = [
    makeQualifier({ kind: 'MIN_MAX', channel: 'T', direction: 'max', cmp: 'ge', target: 0, lambdaStart: a, lambdaEnd: b, flag: 2 }),
    makeQualifier({ kind: 'T_AVG', cmp: 'ge', target: 0.5, lambdaStart: a, lambdaEnd: b }),
];
const design = { ...entryDesign(entry), qualifiers };
const params = { lambdaStart: a, lambdaEnd: b, lambdaStep: (b - a) / 20, theta: 0, polarization: 'avg' };
const RUNS = {
    'per material, n·d kept': nTrials => ({
        char: 'T', evalMode: 'front', nTrials, corridorSigma: 2, seed: 4242,
        rmsAbsNm: 0, rmsRelPct: 1, rmsReN: 0.002, rmsImN: 0, distribution: 'gaussian',
        perMaterialErrors: true, keepOpticalThickness: true,
        evaluateSpec: true, qualifiers, recordTrials: true,
    }),
    'per layer, truncated': nTrials => ({
        char: 'R', evalMode: 'front', nTrials, seed: 77,
        rmsAbsNm: 0.5, rmsRelPct: 1, rmsReN: 0.004, rmsImN: 0.0005, distribution: 'truncated',
        evaluateSpec: true, qualifiers, recordTrials: true,
    }),
};
const here = opts => runErrorAnalysisMC(design, params, designMaterialLookup(design), opts);

globalThis.Worker = NodeModuleWorker;

// ── 1. Pools of 1, 2, 3 and 8 ───────────────────────────────────────────────
for (const [label, options] of Object.entries(RUNS)) {
    const expected = await here(options(24));
    for (const threads of [1, 2, 3, 8]) {
        assert.deepStrictEqual(await startMonteCarloRun(design, params, options(24), () => {}, threads).done, expected,
            `${label}: the window's pool of ${threads} gives the run on one thread`);
        assert.deepStrictEqual(await runOnThreads(design, params, options(24), { threads }), expected,
            `${label}: the API's pool of ${threads} gives the run on one thread`);
    }
}

// ── 2. Stop at a random trial ───────────────────────────────────────────────
{
    const options = RUNS['per material, n·d kept'];
    const at = 1 + Math.floor(Math.random() * 60);
    const run = startMonteCarloRun(design, params, options(100000), ({ i }) => { if (i >= at) run.stop(); }, 3);
    const kept = await run.done;
    assert.ok(kept.nTrials >= at && kept.nTrials < 100000, `the window's Stop at trial ${at} keeps ${kept.nTrials} trials`);
    assert.deepStrictEqual(kept, await here(options(kept.nTrials)), `which are the run of ${kept.nTrials} trials`);

    const stop = new AbortController();
    const stopped = await runOnThreads(design, params, options(100000), {
        threads: 3, signal: stop.signal, onProgress: ({ trial }) => { if (trial === at) stop.abort(); },
    });
    assert.deepStrictEqual(stopped, await here(options(at)), `the API's Stop at trial ${at} keeps the run of ${at} trials`);
}

// ── 3. Trials that arrive out of order ──────────────────────────────────────
{
    // A worker that answers every third trial late, as a trial that costs more
    // would, and notes the trials in the order they arrive.
    const arrived = [];
    let spreads = null;
    class UnevenWorker extends NodeModuleWorker {
        set onmessage(handler) { this.answer = handler; }
        get onmessage() {
            return this.answer && (event => {
                const { data } = event;
                if (data?.type === 'mcReady') spreads ??= data.spreads;
                if (data?.type !== 'mcTrialDone') return this.answer(event);
                setTimeout(() => {
                    arrived.push(data);
                    this.answer(event);
                }, data.trial % 3 === 0 ? 30 : 0);
            });
        }
    }
    globalThis.Worker = UnevenWorker;
    const options = { ...RUNS['per layer, truncated'](30), recordTrials: false };
    const expected = await here(options);
    const pooled = await startMonteCarloRun(design, params, options, () => {}, 3).done;
    globalThis.Worker = NodeModuleWorker;

    const order = arrived.map(({ trial }) => trial);
    assert.deepEqual([...order].sort((x, y) => x - y), [...Array(30).keys()], 'every trial arrives once');
    assert.notDeepEqual(order, [...Array(30).keys()], `the trials arrive out of order: ${order.join(' ')}`);
    assert.deepStrictEqual(pooled, expected, 'the pool of 3 gives the run on one thread');

    const config = makeMCConfig(design, params, designMaterialLookup(design), options);
    const inArrival = openMCStatistics(config, spreads);
    for (const { outcome } of arrived) foldMCTrial(inArrival, outcome);
    assert.notDeepStrictEqual(finalizeMCResult(config, inArrival), expected,
        'adding the trials in the order they arrive gives another result, so the check above would catch it');
}

// ── 4. tf.monteCarlo and tf.estimateYield ───────────────────────────────────
{
    const evalMode = resolveEvalMode(design);
    const ERRORS = { runs: 20, thicknessRelPct: 2, indexRe: 0.003, seed: 9 };
    const same = { evalMode, nTrials: 20, rmsRelPct: 2, rmsAbsNm: 0, rmsReN: 0.003, rmsImN: 0, distribution: 'gaussian', seed: 9, evaluateSpec: true };

    const progress = [];
    const mc = await api.monteCarlo(design, { from: a, to: b, step: (b - a) / 20, quantity: 'T', ...ERRORS }, { onProgress: p => progress.push(p) });
    // eslint-disable-next-line no-unused-vars
    const { environments, ...spread } = await here({ ...same, char: 'T' });
    assert.deepStrictEqual(mc, spread, 'tf.monteCarlo gives the run on one thread');
    assert.deepEqual(progress.map(({ trial }) => trial), [...Array(20).keys()].map(i => i + 1), 'with progress after each trial');

    const at = design.referenceWavelength || 550;
    const counted = await runErrorAnalysisMC(design, { lambdaStart: at, lambdaEnd: at, lambdaStep: 1 }, designMaterialLookup(design), { ...same, char: 'R' });
    const yielded = await api.estimateYield(design, ERRORS);
    assert.deepStrictEqual([yielded.yield, yielded.passCount, yielded.evaluated, yielded.perQualifier],
        [counted.spec.yield, counted.spec.passCount, counted.spec.evaluated, counted.spec.perQualifier], 'tf.estimateYield counts the trials the run on one thread does');

    const onHere = [];
    const options = RUNS['per material, n·d kept'](12);
    assert.deepStrictEqual(await runOnThreads(design, params, options, { threads: 0, onProgress: p => onHere.push(p.trial) }), await here(options),
        'a pool of no threads runs on this thread');
    assert.equal(onHere.length, 12, 'and reports each trial');
}

// The API's threads, counted as they start. `failAfter` makes the second
// thread fail once it has answered that many trials, as one that runs out of
// memory would: it is handed no more, so it fails while idle.
const nodeThreads = createRequire(import.meta.url)('node:worker_threads');
const RealThread = nodeThreads.Worker;
let started = 0;
let failAfter = Infinity;
let lost = 0;
class CountedThread extends RealThread {
    constructor(...args) {
        super(...args);
        started++;
        this.fails = started === 2 && Number.isFinite(failAfter);
        let handed = 0;
        let answered = 0;
        this.allowed = () => !this.fails || ++handed <= failAfter;
        this.on('message', data => {
            if (this.fails && data?.type === 'mcTrialDone' && ++answered === failAfter) {
                lost++;
                setImmediate(() => this.emit('error', new Error('thread lost')));
            }
        });
    }
    postMessage(message) {
        if (message?.type !== 'mcTrial' || this.allowed()) super.postMessage(message);
    }
}
nodeThreads.Worker = CountedThread;
syncBuiltinESMExports();

// ── 5. A run moves to threads only when they save more than they cost ───────
{
    assert.ok(threadsPayOff(2, 2, 1000, 12) && !threadsPayOff(2, 2, 100, 12), 'two seconds of trials move to 12 threads, a fifth of a second does not');
    assert.ok(!threadsPayOff(120, 2, 5, 12), 'nor do 5 trials of 120 ms, which threads would make again from the start');
    assert.ok(!threadsPayOff(2, 2, 1000, 1) && !threadsPayOff(2, 2, 1000, 0), 'and none move to one thread or none');
    const wide = { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 0.5, theta: 0, polarization: 'avg' };
    // A trial here takes about 8 ms; 120 of them move to 12 threads at 3 ms or more.
    for (const [label, nTrials, moves] of [['a short run', 3, false], ['a run long enough to move', 120, true]]) {
        const options = RUNS['per layer, truncated'](nTrials);
        const reports = [];
        started = 0;
        const result = await runMonteCarlo(design, wide, options, { threads: 12, onProgress: ({ trial }) => reports.push(trial) });
        assert.equal(started > 0, moves, `${label} ${moves ? 'moves to' : 'stays off'} the threads: ${started} started`);
        assert.deepStrictEqual(result, await runErrorAnalysisMC(design, wide, designMaterialLookup(design), options), `${label} gives the run on one thread`);
        assert.deepEqual(reports, [...Array(nTrials).keys()].map(i => i + 1), 'and reports each trial once');
    }
    started = 0;
    const plain = RUNS['per layer, truncated'](120);
    assert.deepStrictEqual(await runMonteCarlo(design, wide, plain), await runErrorAnalysisMC(design, wide, designMaterialLookup(design), plain),
        'on plain Node the API gives the run on one thread');
    assert.equal(started, 0, 'and starts no thread, however long the run');
}

// ── 6. A thread that fails part-way ─────────────────────────────────────────
{
    const options = RUNS['per material, n·d kept'](40);
    started = 0;
    failAfter = 3;
    const result = await runOnThreads(design, params, options, { threads: 4 });
    failAfter = Infinity;
    assert.equal(lost, 1, 'a thread failed');
    assert.deepStrictEqual(result, await here(options), 'the API makes the run again on this thread: the whole run, not the trials done');
}

nodeThreads.Worker = RealThread;
syncBuiltinESMExports();

console.log('PASS: monte_carlo_pool');
