/**
 * One single-start refinement job, with any makeEngine method (DLS unless the
 * job names another). The optimizer Web Worker (optimizerWorker.js) runs it off
 * the UI thread for the Refinement window, the Structural Optimizer's proposal
 * refines, the Design Cleaner's post-clean pass and the Needle Manual refine
 * after an insertion; the benchmark runs the same job on its own thread through
 * InThreadOptimizerWorker. Multi-start is a worker POOL: the main thread
 * (Refinement.js) spawns several workers, hands each a perturbed-design job,
 * and aggregates the global best. A job only ever does "optimize this design,
 * stream progress, report the best you found"; orchestration lives with the
 * caller.
 *
 * Cross-thread materials = Approach A (pre-sampled): the caller samples every
 * referenced material's [n,k] on the EXACT union of operand wavelengths
 * (`requiredLambdas` ← `operandSampleLambdas`, the same helper `evalOperand`
 * uses) and ships plain arrays. Here we rebuild a table-lookup `getNK` that
 * returns those exact stored values, so optimizer output is bit-identical to
 * the main-thread path. No math change. A run sends its tables to each worker
 * once (jobTables.js): `tablesOf` is the worker's table holder.
 *
 * Messages go out through `post`: 'init', throttled 'progress', then 'done',
 * or 'error'. A 'score' job runs no optimizer: it posts one 'score' message
 * with the merit and optical merit of its design, or 'error'. A Structural
 * run's refine jobs also have their 'done' carry the full merit of the design
 * the run keeps, and its needle jobs post one 'structural' message
 * (structural/workerJobs.js). A 'needleProfile' or 'needleStart' job runs
 * Needle Manual's profile scan or the starting thickness of a picked needle
 * (needleManual/insertion.js) and posts one message of its own type with the
 * answer, or 'error'.
 */

import { makeEngine } from '../optimizers/index.js';
import { DLSOptimizer } from '../physics/optimizer.js';
import { noteTmmWasmBytes, awaitTmmWasmReady } from '../../tmmcore.js';
import { profileScanJob, startingThicknessJob } from '../../components/windows/optimization/needleManual/insertion.js';
import { makeResolveMat } from './resolveMat.js';
import { makeTableHolder } from './jobTables.js';
import { STRUCTURAL_JOBS, withStructuralScore } from '../structural/workerJobs.js';

const POST_MS = 80;     // progress-message rate limit (wall clock)

const now = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now()
    : () => Date.now();

// opt.applyToDesign uses opt.thicknesses; capture the best-thickness layers
// without leaving the optimizer mutated (safe, since it runs synchronously).
function appliedAt(opt, thicks, design) {
    const saved = opt.thicknesses;
    opt.thicknesses = thicks;
    const d = opt.applyToDesign(design);
    opt.thicknesses = saved;
    return { frontLayers: d.frontLayers, backLayers: d.backLayers };
}

// Why a finished run stopped: 'maxiter' when the iteration cap cut it off,
// otherwise the stopping test the DLS engine names ('target', 'damping',
// 'reduction' or 'step', physics/optimizer/lmStopping.js), or 'converged' for
// an engine that names none. The Newton and SQP engines carry the field too,
// from their Levenberg-Marquardt fallback steps, but stop on tests of their own.
function stopReasonOf(opt) {
    if (!opt.isConverged()) return 'maxiter';
    return (opt instanceof DLSOptimizer && opt.convergedBy) || 'converged';
}

// ── Single-start run ──────────────────────────────────────────────────────────

function runSingle(job, resolveMat, postMessage) {
    const { operands, design, opts } = job;
    const MAX_ITER = opts.maxIter ?? 500;
    // restartIdx/nRestarts are pool bookkeeping, echoed back so the main
    // thread can attribute this worker's messages to a restart slot. They are
    // undefined for a plain single-start (non-pool) run.
    const rIdx = job.restartIdx, nR = job.nRestarts;

    // Engine method: 'dls' (default, used by the Local Refinement pool) or one
    // of the Global-Refinement engines 'de' / 'sa' / 'cg'. All share the same
    // step()/isConverged()/applyToDesign()/mf/mfBest/iter interface, so the
    // run loop below is method-agnostic.
    const opt = makeEngine(job.method || 'dls', operands, design, resolveMat, {
        maxIter: MAX_ITER,
        // Standalone Refinement: let CG persist past the first trapped line
        // search (auto-restart + plateau auto-relaunch) so one run goes as deep
        // as the user's old ~5× manual re-launches. Ignored by non-CG engines.
        // Synthesis uses its own makeEngine('cg') WITHOUT this flag (validated).
        persistent: true,
        ...(job.engineOpts || {}),
    });
    postMessage({ type: 'init', mfInitial: opt.mf, mfBest: opt.mfBest,
        omfInitial: opt.mfOpticalAt(opt.thicknesses), omfBest: opt.mfOpticalAt(opt.thickBest),
        restartIdx: rIdx, nRestarts: nR });

    let last = now();
    const post = (final) => {
        const cur  = opt.applyToDesign(design);
        const best = appliedAt(opt, opt.thickBest, design);
        postMessage({
            type: final ? 'done' : 'progress',
            reason: final ? stopReasonOf(opt) : undefined,
            iter: opt.iter, mf: opt.mf, mfBest: opt.mfBest,
            omf: opt.mfOpticalAt(opt.thicknesses), omfBest: opt.mfOpticalAt(opt.thickBest),
            restartIdx: rIdx, nRestarts: nR,
            frontLayers: cur.frontLayers,  backLayers: cur.backLayers,
            bestFrontLayers: best.frontLayers, bestBackLayers: best.backLayers,
        });
    };

    post(false);   // iter-0 frame
    while (!opt.isConverged() && opt.iter < MAX_ITER) {
        opt.step();
        const t = now();
        if (t - last >= POST_MS) { post(false); last = t; }
    }
    post(true);
}

// ── Start score ───────────────────────────────────────────────────────────────

// The merit and optical merit of the design as posted, from the DLS evaluator
// every engine scores with. A refinement run takes its start values from this
// job when its jobs' 'init' does not report them (methodsFlow.js
// INIT_IS_START, dlsPool.js startJobs).
function scoreDesign(job, resolveMat, postMessage) {
    const opt = new DLSOptimizer(job.operands, job.design, resolveMat);
    postMessage({ type: 'score', mf: opt.mf, omf: opt.mfOpticalAt(opt.thicknesses) });
}

// ── Message entry point ───────────────────────────────────────────────────────

const isStructuralJob = type => Object.hasOwn(STRUCTURAL_JOBS, type);

// Needle Manual's jobs, each answered by one message of its own type.
const NEEDLE_JOBS = {
    needleProfile: (job, resolveMat) => ({ type: 'needleProfile', scan: profileScanJob(job, resolveMat) }),
    needleStart: (job, resolveMat) => ({ type: 'needleStart', dNew: startingThicknessJob(job, resolveMat) }),
};
const isNeedleJob = type => Object.hasOwn(NEEDLE_JOBS, type);

function runJob(job, resolveMat, postMessage) {
    if (job.type === 'score') scoreDesign(job, resolveMat, postMessage);
    else if (isStructuralJob(job.type)) postMessage({ type: 'structural', result: STRUCTURAL_JOBS[job.type](job, resolveMat) });
    else if (isNeedleJob(job.type)) postMessage(NEEDLE_JOBS[job.type](job, resolveMat));
    else runSingle(job, resolveMat, job.structuralScore ? withStructuralScore(job, resolveMat, postMessage) : postMessage);
}

export async function handleOptimizerMessage(job, postMessage, tablesOf = makeTableHolder()) {
    if (!job) return;
    // One-time WASM kernel init (bytes may arrive as a dedicated message or ride
    // on any job). Each worker instantiates its own module.
    if (job.type === 'wasmInit') { noteTmmWasmBytes(job.wasmBytes); return; }
    if (job.type !== 'start' && job.type !== 'score' && !isStructuralJob(job.type) && !isNeedleJob(job.type)) return;
    try {
        const materials = tablesOf(job);
        noteTmmWasmBytes(job.wasmBytes);
        await awaitTmmWasmReady();
        runJob(job, makeResolveMat(materials, 'optimizerWorker', postMessage), postMessage);
    } catch (err) {
        postMessage({
            type: 'error',
            message: (err && err.stack) || String(err),
            restartIdx: job.restartIdx, nRestarts: job.nRestarts,
        });
    }
}
