// One Gradual Evolution run: a design grown by needle insertion with forced
// increases of total optical thickness between needle optimizations
// (Tikhonravov et al., Appl. Opt. 46, 704 (2007)), on a pool of synthesis
// workers. Each cycle scans every scanned side for improving needles and
// refines the best of them in parallel; when none improves, a structural step
// (a forced thickness step, or a layer swap at the layer limit) moves the
// design on. The Gradual Evolution window runs it through runGradualEvolution,
// and so can a script or a test, in Node as well.

import { planRun } from './settings.js';
import { prepare } from './setup.js';
import { makeRun, alive } from './runState.js';
import { runOnPool, failedRun } from '../synthesis/poolRun.js';
import { regridIfGrown } from './core.js';
import { seedPhase } from './seed.js';
import { tryAcceptOnSide } from './needle.js';
import { stallStep } from './geStep.js';
import { finish } from './finish.js';

// The result of a run that ends without an answer.
const ended = (stopReason, extra = {}) => ({
    completed: false, stopReason, mf: null, frontLayers: null, backLayers: null, ...extra,
});

// Try every scanned side (smaller side first, so growth stays balanced) for an
// improving needle. Returns 'stop' if the run was stopped, the run's end if it
// reached the target, 'continue' if any side accepted a needle, or 'none' if
// none did (the caller takes a structural step).
async function tryEachSide(S, orderedSides) {
    let needleAccepted = false;
    for (const sd of orderedSides) {
        if (!alive(S)) return 'stop';
        if (!(await tryAcceptOnSide(S, sd))) continue;
        needleAccepted = true;
        if (S.best.mf < S.targetMF) {
            console.log(`[GE] Converged: best MF=${S.best.mf.toFixed(6)} < tol=${S.targetMF}`);
            return { end: { stopReason: 'target', stopMF: S.best.mf } };
        }
    }
    return needleAccepted ? 'continue' : 'none';
}

// One outer-loop iteration: try every scan side for an improving needle that
// fits the layer limit; if none improve, take a structural step (stallStep).
async function runGeCycle(S) {
    // Smaller side first (tiebreak: front).
    const orderedSides = [...S.scanSides].sort((a, b) => {
        const la = (a === 'front' ? S.work.frontLayers : S.work.backLayers).length;
        const lb = (b === 'front' ? S.work.frontLayers : S.work.backLayers).length;
        return (la - lb) || (a === 'front' ? -1 : 1);
    });
    regridIfGrown(S);
    const sideOutcome = await tryEachSide(S, orderedSides);
    if (sideOutcome !== 'none') return sideOutcome;
    console.log('[GE] Needle-optimal on all sides');
    return stallStep(S);
}

// Cycles until the run ends on its own (its end) or is stopped (null). Each
// outer iteration processes every scanned side; a structural step is taken
// only when NO side found an improving needle.
async function cycleUntilEnd(S) {
    while (alive(S)) {
        const outcome = await runGeCycle(S);
        if (outcome === 'stop') return null;
        if (outcome.end) return outcome.end;
    }
    return null;
}

// The seed, then the cycles, then the end.
async function drive(S) {
    try {
        if (await seedPhase(S) == null) return ended('stopped');
        const end = await cycleUntilEnd(S);
        const result = end && alive(S) ? await finish(S, end) : null;
        return result || ended('stopped');
    } catch (err) {
        return failedRun(GE_RUN, S, err);
    }
}

const GE_RUN = { tag: 'GE', firstReport: { phase: 'refining', activity: null }, makeRun, drive, ended };

/**
 * Grows `design` against `operands` (merit operand rows; disabled rows and
 * PPEF rows are left out, MNT and MXT rows kept).
 *
 * settings (settings.js): { pool, maxLayers, maxGeCycles, targetMF,
 * refineIter, dMin, deepSearch, innerEngine, candidateSearch, sensitivity,
 * smartSeed, seedMode, consolidate, consolidateTol, threads, history }
 *   pool        required: the candidate materials, [{ id, name, mat }]
 *   threads     the pool size, which is also how many candidates a batch
 *               refines; the answer depends on it. Default: the machine's
 *               default thread count (synthesisConfig/threads.js)
 *   history     { genNum, geSteps, bestMF, elapsedMs, hasRows } of the history
 *               this run continues, for a window that keeps one across runs
 * Every other setting defaults to GE_DEFAULTS. An unknown setting or a value
 * the run cannot take rejects the returned promise.
 *
 * hooks:
 *   makeWorkerPool(size)  required: a pool of `size` synthesis workers, with
 *                         map(jobs, onProgress) and run(job, onProgress)
 *                         resolving to each job's result, and terminate(), which
 *                         must reject the jobs in flight: Stop waits on them.
 *                         utils/workers/workerPool.js over synthesisWorker.js
 *                         is one
 *   signal                AbortSignal that stops the run
 *   onStart()             the run has started: its pool is built
 *   onProgress(patch)     what changed:
 *                         phase     'scanning' | 'refining'
 *                         activity  what the run is doing, or null: { id:
 *                                   'smartSeeding', count }, { id:
 *                                   'seedKeptBulk' }, { id: 'seedRefining' },
 *                                   { id: 'scanning', side }, { id:
 *                                   'refiningCandidates', count, side }, { id:
 *                                   'geScanning' }, { id: 'freeing' }, { id:
 *                                   'perturbing' } or { id: 'consolidating' };
 *                                   side is 'front' or 'back' when both sides
 *                                   are scanned, else null
 *                         design    the { frontLayers, backLayers } the run
 *                                   goes on from, with mf, and omf, mfBest,
 *                                   omfBest, layerCount and geSteps when they
 *                                   change with it
 *                         live      a worker's in-flight { mf, omf, frontLayers,
 *                                   backLayers, layers }
 *   onRow(row, info)      a history row: { id, genNum, type ('seed',
 *                         'baseline', 'needle', 'refine', 'ge', 'clean' or
 *                         'perturb'), mf, omf, dMF, side, layerCount, tot, tMs,
 *                         insertMat, layers, frontSnap, backSnap }. With
 *                         info.replacesLast it is the run's last row again,
 *                         refined further (same id). info.layerCount,
 *                         info.mfBest and info.omf are the readout that goes
 *                         with it
 *
 * Resolves to { completed, stopReason, mf, frontLayers, backLayers }. A
 * completed run ends on 'target' (with stopMF, the merit that reached it),
 * 'maxGeCycles' or 'stuck' (no step left), its best design consolidated, and
 * its layers are its answer (also geSteps, the run's GE-step count).
 * Otherwise stopReason is 'stopped', 'workerFailed' (the pool could not be
 * built, or failed before the run reported a design; the design is as it
 * was), 'workerError' (the pool failed later, with `message`), 'noOperands',
 * 'noMaterials' or 'presampleFailed', and the layers are null. A hook that
 * throws from one of the run's steps ends the run the way a failing pool does.
 * A live report (onProgress with `live`) is made from the pool's own message
 * handling, so what a throw there does is up to the pool. onStart or the first
 * onProgress throwing rejects the promise.
 */
export async function runGradualEvolution(design, operands, settings, hooks = {}) {
    if (!design || !Array.isArray(operands)) throw new Error('runGradualEvolution: a design and a list of operands are required');
    if (typeof hooks.makeWorkerPool !== 'function') throw new Error('runGradualEvolution: hooks.makeWorkerPool is required');
    const plan = planRun(settings);
    if (hooks.signal?.aborted) return ended('stopped');
    const prep = prepare(design, operands, plan.pool);
    if (prep.failed) return ended(prep.failed);
    return runOnPool(GE_RUN, design, plan, prep, hooks);
}
