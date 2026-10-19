// One Deep Synthesis run on a design, on the calling thread. Its refinements
// and children go to a pool of synthesis workers when the caller brings one,
// and run here one after another otherwise, with the same result. The Deep
// Synthesis window runs the same run on a worker of its own
// (utils/workers/deepSynthesisWorker.js); this entry serves a script or a
// test, in Node as well.

import { planRun } from './settings.js';
import { prepareRun } from './setup.js';
import { makeRegrid } from './regrid.js';
import { makeTrace } from './trace.js';
import { makePoolRunner, makeSerialRunner } from './runner.js';
import { runDeepSynthesis } from './index.js';
import { makeRng } from '../structuralOptimizer.js';
import { randomSeed } from '../../physics/errorAnalysis/mcConfig.js';

// The result of a run that did not start.
const refused = stopReason => ({ completed: false, stopReason, mf: null, layers: null });

// What the run's result means for its caller. A run ends on its best design
// within the layer cap whether it finished, was stopped or lost a worker.
function outcomeOf(result, { stopped, seed, side }) {
    const found = Number.isFinite(result.mf);
    const base = {
        mf: found ? result.mf : null, layers: found ? result.layers : null, side, seed,
        parts: result.parts, start: result.start, search: result.search,
    };
    if (!result.stopped) return { completed: true, stopReason: found ? 'done' : 'noDesign', ...base };
    if (stopped) return { completed: false, stopReason: 'stopped', ...base };
    return { completed: false, stopReason: 'workerError', message: result.error, ...base };
}

/**
 * Synthesizes the active side of `design` against `operands` (merit rows;
 * disabled and PPEF rows are left out, MNT and MXT rows become the floor and
 * the upper bound), from the layers it holds, or from nothing when it holds
 * none.
 *
 * settings (settings.js): { pool, dMin, maxLayers, seed, threads, method }
 *   pool      required: the candidate materials, [{ id, name, mat }]
 *   seed      the random stream's seed, or null for a fresh one; with the same
 *             design and settings the run repeats, whatever the thread count
 *   threads   the size of the worker pool, when there is one
 *   method    sections of the method's constants (index.js
 *             DEEP_SYNTHESIS_DEFAULTS) to replace, e.g. { search: { rounds } }
 * An unknown setting or a value the run cannot take rejects the promise.
 *
 * hooks:
 *   makeWorkerPool(size)  a pool of `size` synthesis workers whose map(jobs)
 *                         resolves to their result messages in job order and
 *                         whose terminate() rejects the jobs in flight
 *                         (utils/workers/workerPool.js over synthesisWorker.js);
 *                         without one the jobs run on the calling thread
 *   signal                AbortSignal that stops the run
 *   onStart({ seed, parts })  the run has started; parts says which parts of
 *                         the method it uses (capabilities.js)
 *   onEvent(event, best)  the engine's events (index.js: phase, geStep, round,
 *                         best) with the run's best design at that moment
 *
 * Resolves to { completed, stopReason, mf, layers, side, seed, parts, start,
 * search }: layers are the active side's ({ material, thickness } in nm),
 * null with mf when no design within the cap was found. A completed run ends
 * 'done' or 'noDesign'. A Stop ends it 'stopped' and a failed worker
 * 'workerError' (with `message`), both on the best design so far. A run that
 * cannot start ends 'locked', 'noPool', 'noOperands', 'presampleFailed' or
 * 'workerFailed', with no design.
 */
export async function runDeepSynthesisOnDesign(design, operands, settings, hooks = {}) {
    if (!design || !Array.isArray(operands)) throw new Error('runDeepSynthesisOnDesign: a design and a list of operands are required');
    const plan = planRun(settings);
    const signal = hooks.signal;
    if (signal?.aborted) return refused('stopped');
    const prep = prepareRun(design, operands, plan);
    if (prep.failed) return refused(prep.failed);
    let pool = null;
    try { pool = hooks.makeWorkerPool ? hooks.makeWorkerPool(plan.threads) : null; }
    catch (err) {
        console.error('[DeepSynthesis] the worker pool could not be built:', err);
        return refused('workerFailed');
    }
    const shouldStop = () => !!signal?.aborted;
    const closePool = () => { try { pool?.terminate(); } catch (_) {} };
    signal?.addEventListener('abort', closePool);
    const seed = plan.seed ?? randomSeed();
    const current = { ev: prep.ev };
    const run = {
        runner: pool ? makePoolRunner(pool) : makeSerialRunner({ shouldStop }),
        log: { trace: makeTrace(), keep: null }, shouldStop,
        onEvent: event => hooks.onEvent?.(event, run.best),
        rng: makeRng(seed), regrid: makeRegrid(current, prep.source), best: null,
    };
    try {
        hooks.onStart?.({ seed, parts: prep.parts });
        const result = await runDeepSynthesis(current.ev, prep.start, plan.method, run);
        return outcomeOf(result, { stopped: shouldStop(), seed, side: prep.side });
    } finally {
        signal?.removeEventListener('abort', closePool);
        closePool();
    }
}
