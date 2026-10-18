// One refinement run: the layer thicknesses of a design optimized against its
// merit operands by a Refinement method, on optimizer workers. The Refinement
// window, scripts and tests all run it through runRefinement.

import { planRun } from './settings.js';
import { openRun } from './runHandle.js';
import { densifyForRun, presampleMaterials, buildPayload } from './workerInputs.js';
import { computeOperandDisplay, firstOperandErrorMessage } from './operandCheck.js';
import { runDlsPool } from './dlsPool.js';
import { runMethodsFlow } from './methodsFlow.js';

// The result of a run that ends before it starts.
const ended = (stopReason, extra = {}) => ({
    completed: false, stopReason,
    mf: null, omf: null, mfInitial: null, omfInitial: null, iter: 0,
    frontLayers: null, backLayers: null, seed: null,
    ...extra,
});

// The operands on the run's grid, the materials sampled on it and the design as
// plain data, or the reason the run cannot start.
function prepare(design, operands) {
    const enabled = operands.filter(op => op.enabled);
    if (enabled.length === 0) return { failed: ended('noOperands') };
    const check = computeOperandDisplay(design, operands);
    const message = firstOperandErrorMessage(operands, check?.errors);
    if (message) return { failed: ended('invalidOperand', { message }) };
    const ops = densifyForRun(enabled, design);
    let materials;
    try { materials = presampleMaterials(design, ops); }
    catch (err) {
        console.error('[Refine] Pre-sampling failed:', err);
        return { failed: ended('presampleFailed') };
    }
    return { ops, materials, payload: buildPayload(design) };
}

/**
 * Refines `design` against `operands` (merit operand rows; disabled rows are
 * left out, and a row that cannot be evaluated refuses the run).
 *
 * settings: { method, maxIter, nRestarts, perturbPct, seed, threads }
 *   method      a REFINE_METHODS id, or a list of ALL_ORDER ids tried one by one
 *               from the same start, keeping the best ('all' is ALL_ORDER).
 *               Exactly 'dls' or 'dls-multi' runs on the DLS worker pool.
 *   maxIter     iteration cap of a one-method run; default the method's budget
 *   nRestarts, perturbPct   multi-start restarts and their ± thickness percent
 *   seed        seed of the stochastic methods; empty draws one (result.seed)
 *   threads     workers the multi-start and parallel DE use at once; default 1
 * An unknown setting, method or value throws.
 *
 * hooks:
 *   makeWorker()       required: a new optimizer worker (postMessage, onmessage,
 *                      onerror, terminate), a module Web Worker in the browser or
 *                      an InThreadOptimizerWorker on a thread of its own
 *   makeEvalPool(size) a pool of `size` MF-evaluation workers for parallel DE on
 *                      a design with four or more free layers: map(jobs)
 *                      resolving to one { mfs } per { type: 'evalBatch', ... }
 *                      job, and terminate(); utils/workers/workerPool.js over
 *                      mfEvalWorker.js is one. Without it DE runs serially in
 *                      one optimizer worker, with the same result.
 *   signal             AbortSignal that stops the run. A worker that runs its job
 *                      on the calling thread is stopped between jobs.
 *   onStart({ seed })  the run has started; seed is null for a run that draws none
 *   onMethodStart(method, index)
 *   onProgress(patch)  readout values that changed: iter, mf, mfBest, omf, omfBest,
 *                      mfInitial, omfInitial, mfHistory, restartIdx; `design`, the
 *                      layers to show live; `best`, the best design so far
 *   onRecord(row)      a method that ran to its own end: { method, restarts?, iter,
 *                      mf, omf, frontLayers, backLayers, layerSide, mfHistory, seed? }
 * Progress, best and the iteration count can still arrive after an abort while
 * the run unwinds; a stopped method contributes to the best but records no row.
 *
 * Resolves to { completed, stopReason, mf, omf, mfInitial, omfInitial, iter,
 * frontLayers, backLayers, seed }; a run that ends before it starts has nulls
 * there. stopReason: 'target', 'maxiter', 'stalled', 'best:<method>' (a list),
 * 'restartsDone' (DLS multi-start), 'stopped', 'workerFailed' (a DLS pool
 * worker failed before any result; the design is unchanged), 'workerError' (a
 * DLS pool worker failed after progress), 'presampleFailed', 'noOperands', or
 * 'invalidOperand' with `message`. On the method flow a method whose worker
 * fails contributes nothing, and the run ends on what the others found, or on
 * the start design. Only a completed run's layers are its answer.
 */
export async function runRefinement(design, operands, settings, hooks = {}) {
    if (!design || !Array.isArray(operands)) throw new Error('runRefinement: a design and a list of operands are required');
    if (typeof hooks.makeWorker !== 'function') throw new Error('runRefinement: hooks.makeWorker is required');
    const plan = planRun(settings);
    if (hooks.signal?.aborted) return ended('stopped');
    const prep = prepare(design, operands);
    if (prep.failed) return prep.failed;
    const R = openRun(plan, design, hooks);
    try {
        return await (plan.onPool ? runDlsPool(R, prep) : runMethodsFlow(R, prep));
    } finally {
        R.close();
    }
}
