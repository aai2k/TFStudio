/**
 * Optimizer Web Worker — runs ONE single-start DLS refinement off the UI
 * thread. Multi-start is a worker POOL: the main thread (Refinement.js)
 * spawns several of these, hands each a perturbed-design job, and aggregates
 * the global best. Perturbation + aggregation live on the main thread (one
 * place); each worker only ever does "optimize this design, stream progress,
 * report the best you found". This file is a pure single-start runner;
 * orchestration lives main-thread-side. Needle/GE run on the main thread.
 *
 * Cross-thread materials = Approach A (pre-sampled): the main thread samples
 * every referenced material's [n,k] on the EXACT union of operand wavelengths
 * (`requiredLambdas` ← `operandSampleLambdas`, the same helper `evalOperand`
 * uses) and ships plain arrays. Here we rebuild a table-lookup `getNK` that
 * returns those exact stored values, so optimizer output is bit-identical to
 * the main-thread path. No math change.
 *
 * Lifecycle: the main thread `worker.terminate()`s every pool worker on stop /
 * all-done / unmount / design-switch. A terminated worker cannot zombie-step
 * or push background design mutations — this removes the zombie-loop class.
 */

import { makeEngine } from '../optimizers/index.js';
import { noteTmmWasmBytes, awaitTmmWasmReady } from './tmmWasm.js';
import { makeResolveMat } from './resolveMat.js';

const POST_MS = 80;     // progress-message rate limit (wall clock)

const now = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now()
    : () => Date.now();

// ── Table-lookup material factory (Approach A) ────────────────────────────────
//
// `materials[id] = { lambdas:[], n:[], k:[] }` sampled on requiredLambdas().
// getNK(λ) is an exact Map lookup keyed by the λ float. Because the optimizer
// (running here) derives its λ from the same `operandSampleLambdas` the main
// thread pre-sampled with, the floats match bit-for-bit and the lookup is
// exact. A nearest-λ fallback exists only as defense-in-depth; if it ever
// fires it means the centralized-λ guard was violated, so we report it.
// opt.applyToDesign uses opt.thicknesses; capture the best-thickness layers
// without leaving the optimizer mutated (synchronous — safe).
function appliedAt(opt, thicks, design) {
    const saved = opt.thicknesses;
    opt.thicknesses = thicks;
    const d = opt.applyToDesign(design);
    opt.thicknesses = saved;
    return { frontLayers: d.frontLayers, backLayers: d.backLayers };
}

// ── Single-start DLS run ──────────────────────────────────────────────────────

function runSingle(job, resolveMat) {
    const { operands, design, opts } = job;
    const MAX_ITER = opts.maxIter ?? 500;
    // restartIdx/nRestarts are pool bookkeeping — echoed back so the main
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
            reason: final ? (opt.isConverged() ? 'converged' : 'maxiter') : undefined,
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

// ── Message entry point ───────────────────────────────────────────────────────

onmessage = async (e) => {
    const job = e.data;
    if (!job) return;
    // One-time WASM kernel init (bytes may arrive as a dedicated message or ride
    // on the 'start' job). Enabling is per-worker; falls back to JS on failure.
    if (job.type === 'wasmInit') { noteTmmWasmBytes(job.wasmBytes); return; }
    if (job.type !== 'start') return;
    try {
        noteTmmWasmBytes(job.wasmBytes);
        await awaitTmmWasmReady();
        const resolveMat = makeResolveMat(job.materials || {}, 'optimizerWorker');
        runSingle(job, resolveMat);
    } catch (err) {
        postMessage({
            type: 'error',
            message: (err && err.stack) || String(err),
            restartIdx: job.restartIdx, nRestarts: job.nRestarts,
        });
    }
};
