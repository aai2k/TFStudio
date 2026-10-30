// One Structural run: simulated annealing over the structure of a design.
// Each iteration proposes needle insertions and random mutations (add, remove,
// split, merge, perturb), refines each on its own optimizer worker, and takes
// one into the chain by the Metropolis test while the best design so far is
// kept; Deep search reheats into another basin when the chain stalls. The
// Structural Optimizer window runs it through runStructural, and so can a
// script or a test, in Node as well.

import { planRun } from './settings.js';
import { prepare } from './setup.js';
import { makeRun, alive } from './runState.js';
import { buildWorkers } from './workers.js';
import { runToEnd } from './loop.js';
import { runOnPool } from '../synthesis/poolRun.js';

// The result of a run that ends without an answer.
const ended = (stopReason, extra = {}) => ({
    completed: false, stopReason, mf: null, omf: null, frontLayers: null, backLayers: null, ...extra,
});

// The result of a run that ended on its own with `end`.
function finish(S, end) {
    const { best } = S;
    const hasBest = !!(best.frontLayers || best.backLayers);
    return {
        completed: true, ...end,
        mf: hasBest ? best.mf : null, omf: hasBest ? best.omf : null,
        frontLayers: best.frontLayers, backLayers: best.backLayers,
        iters: S.iteration, reheats: S.reheatCount, seed: S.seed,
    };
}

// The run from its seed to its end. An error a Stop did not cause ends the
// run with its message.
async function drive(S) {
    try {
        S.emit({ seed: S.seed });
        const end = await runToEnd(S);
        return end && alive(S) ? finish(S, end) : ended('stopped');
    } catch (err) {
        console.error('[Structural] run error:', err);
        if (!alive(S)) return ended('stopped');
        return ended('workerError', { message: String((err && err.message) || err) });
    }
}

const STRUCTURAL_RUN = { tag: 'Structural', firstReport: { activity: { id: 'baseline' } }, makeRun, drive, ended };

/**
 * Searches the structure of `design` against `operands` (merit operand rows;
 * disabled rows and PPEF rows are left out, MNT and MXT rows set the thickness
 * bounds and are scored).
 *
 * settings (settings.js): { pool, maxIter, targetMF, T0, jitterPct,
 * refineIter, dMin, addMaxNm, maxLayers, kinds, deepSearch, deepMaxMin, seed,
 * innerEngine, smartSeed, threads, history }
 *   pool        required: the candidate materials, [{ id, name, mat }]
 *   threads     how many proposals an iteration refines at once, one worker
 *               each; the answer depends on it. Default: the machine's
 *               default thread count (synthesisConfig/threads.js)
 *   seed        the random stream's seed, or null for a fresh one; the same
 *               seed, design, settings and thread count repeat the run
 *   history     { genNum, hasRows, elapsedMs, trendIter } of the history this
 *               run continues, for a window that keeps one across runs
 * Every other setting defaults to STRUCTURAL_DEFAULTS and the run defaults in
 * settings.js. An unknown setting or a value the run cannot take rejects the
 * returned promise.
 *
 * hooks:
 *   makeWorker()      required: an optimizer worker (utils/workers/
 *                     optimizerWorker.js, or InThreadOptimizerWorker on the
 *                     calling thread): postMessage, onmessage, onerror,
 *                     terminate, and onmessageerror where the worker has it.
 *                     A job has no time limit: it ends when its worker
 *                     answers, when the worker fails (an error event, or a
 *                     message that cannot be read; the worker is then
 *                     replaced) or on Stop
 *   signal            AbortSignal that stops the run
 *   onStart()         the run has started: its workers are built
 *   onProgress(patch) what changed:
 *                     activity  what the run is doing: { id: 'baseline' },
 *                               { id: 'smartSeeding', count }, { id:
 *                               'refining', count } or { id: 'reheat', count }
 *                     seed      the seed the run draws from
 *                     iter, temp, accRate, reheats
 *                               the iteration under way, its temperature, the
 *                               share of iterations whose move was taken, and
 *                               the reheats so far
 *                     design    the best { frontLayers, backLayers }, with mf,
 *                               omf, layerCount, and mfBest and omfBest at the
 *                               start
 *                     trend     a point { iter, cur, best } of the merit trend;
 *                               redraw is true on even iterations and on a new
 *                               best
 *                     live      a refine's in-flight { mf, omf }
 *   onRow(row)        a history row: { id, genNum, seed, kind ('seed',
 *                     'baseline' or the mutation kind), mf, omf, dMF, side,
 *                     layerCount, tot, tMs, insertMat, layers, frontSnap,
 *                     backSnap }. The starting design's row (genNum 0) comes
 *                     only when the history has no rows
 *
 * Resolves to { completed, stopReason, mf, omf, frontLayers, backLayers }. A
 * completed run ends on 'maxIter', 'iterationCap' (Deep search's iteration
 * limit), 'target' (with stopMF, the best merit then), 'patience' (with
 * patience, the iterations without a new best it waited), 'budget' (the Deep
 * search time limit), 'layerCap' (no kind left to propose at the layer limit),
 * 'noMutation' (nothing could be proposed) or 'refineFailed' (the starting
 * design could not be refined, with the refine's error as `message`: then the
 * layers and merit are null), with iters, reheats and seed. Otherwise
 * stopReason is 'stopped', 'workerFailed' (the workers could not be built),
 * 'workerError' (the run failed, with `message`), 'noOperands', 'noMaterials'
 * or 'presampleFailed', and the layers are null. A hook that
 * throws from one of the run's steps ends the run the way an error does. A live
 * report (onProgress with `live`) is made from the worker's own message
 * handling, so what a throw there does is up to the worker. onStart or the
 * first onProgress throwing rejects the promise.
 */
export async function runStructural(design, operands, settings, hooks = {}) {
    if (!design || !Array.isArray(operands)) throw new Error('runStructural: a design and a list of operands are required');
    if (typeof hooks.makeWorker !== 'function') throw new Error('runStructural: hooks.makeWorker is required');
    const plan = planRun(settings);
    if (hooks.signal?.aborted) return ended('stopped');
    const prep = prepare(design, operands, plan);
    if (prep.failed) return ended(prep.failed);
    return runOnPool(STRUCTURAL_RUN, design, plan, prep, {
        ...hooks, makeWorkerPool: size => buildWorkers(hooks.makeWorker, size),
    });
}
