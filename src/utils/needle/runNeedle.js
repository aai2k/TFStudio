// One Needle Automatic run: a design grown by needle insertion against its
// merit operands (Tikhonravov et al., Appl. Opt. 35, 5493 (1996); Sullivan and
// Dobrowolski, Appl. Opt. 35, 5484 (1996)), on a pool of synthesis workers.
// Each cycle scans every insertion position and pool material for the needles
// that lower the merit, refines the best of them in parallel, and keeps the
// best refined design when it beats the best so far. The Needle window runs
// it through runNeedle, and so can a script or a test, in Node as well.

import { planRun } from './settings.js';
import { prepare, regridIfGrown } from './setup.js';
import { makeRun, alive, closePool } from './runState.js';
import { smartSeed, scanCycle } from './scan.js';
import { refineBatches } from './refine.js';
import { thinStartRescue } from './rescue.js';
import { recordFinalWinner } from './generations.js';

// The result of a run that ends without an answer.
const ended = (stopReason, extra = {}) => ({
    completed: false, stopReason, mf: null, omf: null, frontLayers: null, backLayers: null, ...extra,
});

// One scan and refine cycle. Returns 'abort' (a Stop tore the run down), the
// end of the run ({ stopReason, stopMF? }), or null (keep cycling).
async function runCycle(run) {
    const { best, curDes } = run;
    regridIfGrown(run,
        best.frontLayers || run.mkLayers(curDes.frontLayers),
        best.backLayers  || run.mkLayers(curDes.backLayers));
    const scan = await scanCycle(run);
    if (scan.aborted) return 'abort';
    if (scan.done) return scan.end;

    const ref = await refineBatches(run, scan.queue);
    if (ref.aborted) return 'abort';
    if (ref.done) return ref.end;
    return ref.accepted ? null : { stopReason: 'needleOptimal' };
}

// The run ended on its own. A thin-start rescue continues from a thicker
// design even when that design starts out worse (rescue.js), so the run ends
// on whichever of the two is lower.
function finish(run, end) {
    const pre = run.preRescueBest;
    const rescuedReturn = !!(pre && pre.mf < run.best.mf);
    const best = rescuedReturn ? pre : run.best;
    if (!best.frontLayers && !best.backLayers) return { ...ended(end.stopReason), ...end, completed: true };
    recordFinalWinner(run, best, rescuedReturn);
    return {
        completed: true, ...end,
        mf: best.mf, omf: best.omf ?? null, frontLayers: best.frontLayers, backLayers: best.backLayers,
    };
}

// A Stop rejects the in-flight jobs with 'pool terminated'; any other error
// ends the run. Before the run has shown anything the design is as it was.
function failed(run, err) {
    if (!alive(run) || String(err && err.message) === 'pool terminated') return ended('stopped');
    console.error('[Needle] Pool error:', err);
    if (!run.gotProgress) return ended('workerFailed');
    return ended('workerError', { message: String(err && err.message || err) });
}

// Scan and refine cycles until the run ends on its own (its end) or is
// stopped (null). The first needle-optimal end gets one thicker start before
// it is taken at face value (rescue.js).
async function cycleUntilEnd(run) {
    while (alive(run)) {
        const end = await runCycle(run);
        if (end === 'abort') return null;
        if (end === null) continue;
        if (end.stopReason === 'needleOptimal' && await thinStartRescue(run)) continue;
        return end;
    }
    return null;
}

// Optional smart seed, then the cycles.
async function drive(run) {
    try {
        if (run.smartSeed && !(await smartSeed(run))) return ended('stopped');
        const end = await cycleUntilEnd(run);
        return end && alive(run) ? finish(run, end) : ended('stopped');
    } catch (err) {
        return failed(run, err);
    }
}

/**
 * Grows `design` by needle insertion against `operands` (merit operand rows;
 * disabled rows, MNT and MXT rows and PPEF rows are left out).
 *
 * settings (settings.js): { pool, maxLayers, targetMF, deltaNm, dMin,
 * refineIter, innerEngine, candidateSearch, sensitivity, smartSeed, threads,
 * history }
 *   pool        required: the candidate materials, [{ id, name, mat }]
 *   threads     the pool size, which is also how many candidates a batch
 *               refines; the answer depends on it. Default: the machine's
 *               default thread count (synthesisConfig/threads.js)
 *   history     { genNum, bestMF, elapsedMs, rows } of the generations this
 *               run continues, for a window that keeps them across runs
 * Every other setting defaults to NEEDLE_DEFAULTS. An unknown setting or a
 * value the run cannot take rejects the returned promise.
 *
 * hooks:
 *   makeWorkerPool(size)  required: a pool of `size` synthesis workers, with
 *                         map(jobs, onProgress) resolving to one result per job,
 *                         and terminate(), which must reject the map calls in
 *                         flight: Stop waits on them. utils/workers/workerPool.js
 *                         over synthesisWorker.js is one
 *   signal                AbortSignal that stops the run
 *   onStart()             the run has started: its pool is built
 *   onProgress(patch)     what changed:
 *                         phase     'scanning' | 'refining'
 *                         activity  what the run is doing, or null: { id:
 *                                   'scanning' }, { id: 'refiningCandidates',
 *                                   count }, { id: 'smartSeeding', count },
 *                                   { id: 'rescueTrying', count }, or
 *                                   { id: 'rescueApplied', factor, totalNm }
 *                         design, mf, layerCount
 *                                   the start the run goes on from, after a
 *                                   smart seed (which also sends mfBest) or a
 *                                   thin-start rescue
 *                         live      a worker's in-flight { mf, omf, frontLayers,
 *                                   backLayers, layers }
 *   onGeneration(row)     an accepted generation: { genNum, mf, omf, dMF, side,
 *                         layerCount, tot, tMs, insertMat, layers, frontSnap,
 *                         backSnap, rescued? }, or the closing row of a final
 *                         winner no accepted generation shows (final: true)
 *
 * Resolves to { completed, stopReason, mf, omf, frontLayers, backLayers }. A
 * completed run ends on 'maxLayers', 'needleOptimal' or 'target' (with stopMF,
 * the merit that reached it), and its layers are its answer; without a smart
 * seed, a design that already holds maxLayers layers on every side it scans
 * ends 'maxLayers' at once, with null layers and merit, as it was. Otherwise
 * stopReason is 'stopped', 'workerFailed' (the pool could not be built, or
 * failed before the first scan finished and before the run reported a design;
 * the design is as it was), 'workerError' (the pool failed later, with
 * `message`), 'noOperands', 'noMaterials' or 'presampleFailed', and the layers
 * are null. A hook that throws while the run is going ends it the way a
 * failing pool does; onStart or the first onProgress throwing rejects the
 * promise.
 */
export async function runNeedle(design, operands, settings, hooks = {}) {
    if (!design || !Array.isArray(operands)) throw new Error('runNeedle: a design and a list of operands are required');
    if (typeof hooks.makeWorkerPool !== 'function') throw new Error('runNeedle: hooks.makeWorkerPool is required');
    const plan = planRun(settings);
    if (hooks.signal?.aborted) return ended('stopped');
    const prep = prepare(design, operands, plan.pool);
    if (prep.failed) return ended(prep.failed);
    let workerPool;
    try { workerPool = hooks.makeWorkerPool(plan.threads); }
    catch (err) {
        console.error('[Needle] WorkerPool construction failed:', err);
        return ended('workerFailed');
    }
    const run = makeRun(design, plan, prep, workerPool, hooks);
    const stop = () => closePool(run);
    hooks.signal?.addEventListener('abort', stop);
    try {
        hooks.onStart?.();
        run.emit({ phase: 'scanning', activity: null });
        return await drive(run);
    } finally {
        hooks.signal?.removeEventListener('abort', stop);
        closePool(run);
    }
}
