// DLS worker-pool run (method 'dls' or 'dls-multi'). Each worker runs ONE
// single-start DLS job; multi-start is a POOL of workers pulling restarts off a
// queue, with the perturbation and the global-best aggregation done here.
// Per-restart job construction lives in dlsPoolJobs.js and the worker message
// handlers in dlsPoolMessages.js.

import { randomSeed } from '../physics/errorAnalysis/mcConfig.js';
import { makeJob } from './dlsPoolJobs.js';
import { handleMsg, failRun, failAfterProgress, isLive, showStart } from './dlsPoolMessages.js';
import { endRun, resultOf } from './dlsPoolFinalize.js';
import { scoreStartP } from './engineRun.js';

function spawnWorker(R, S) {
    let w;
    try { w = R.makeWorker(); }
    catch (_) { return null; }
    // Per-run sequential id, not Math.random: worker ids must not draw from the
    // RNG, or the pool size (= core count) would shift the seeded perturbation
    // stream and make multi-start results depend on the machine's thread budget.
    const wid = 'w' + (++S.widSeq);
    S.prevIterByW.set(wid, 0);
    S.untrack.set(w, R.track(() => w.terminate()));
    w.onmessage = (e) => handleMsg(R, S, w, wid, e);
    w.onerror = (e) => {
        // An error a stopped or finished run's worker still delivers is not this run's to act on.
        if (!isLive(R, S)) return;
        if (!S.gotProgress) failRun(R, S, 'threw before progress', e.message || e);
        else failAfterProgress(R, S, 'onerror', e.message || e);
    };
    return w;
}

// Whether the surface mode exposes optimization variables for multi-start.
function isMultiEligible(surfMode, hasFront, hasBack) {
    if (surfMode === 'back_only') return hasBack;
    if (surfMode === 'both_independent') return hasFront || hasBack;
    return hasFront;
}

// Up to K workers, one per job to start with; fewer when some cannot be built.
function buildWorkers(R, S) {
    const workers = [];
    for (let i = 0; i < S.K && i < S.nJobs; i++) {
        const w = spawnWorker(R, S);
        if (!w) break;
        workers.push(w);
    }
    return workers;
}

// Hand each worker its first restart job.
function postFirstJobs(S, workers) {
    for (const w of workers) {
        if (S.nextJob >= S.nJobs) break;
        const r = S.nextJob++;
        w.postMessage(makeJob(S, S.isMulti ? r + 1 : 0));
    }
}

// Starts the restarts. A single run's job reports the start values in its
// 'init' (dlsPoolMessages.js). A multi-start's jobs all start from perturbed
// designs, so a scoring job in a worker of its own scores the start first, and
// the restarts follow it. A hook that throws on the way fails the run.
function startJobs(R, S, prep, workers) {
    if (!S.isMulti) { postFirstJobs(S, workers); return; }
    scoreStartP(R, prep).then((start) => {
        if (isLive(R, S)) showStart(R, S, start);
        if (isLive(R, S)) postFirstJobs(S, workers);
    }).catch(S.reject);
}

// The run state the message handlers share: config plus the aggregation.
function poolState(R, prep) {
    const { plan } = R;
    const { payload } = prep;
    const surfMode = payload.surfaceMode;
    const wantMulti = plan.methods[0] === 'dls-multi';
    const eligible = isMultiEligible(surfMode, payload.frontLayers.length > 0, payload.backLayers.length > 0);
    const N = (wantMulti && eligible) ? Math.max(1, Math.floor(plan.nRestarts)) : 1;
    const isMulti = wantMulti && eligible && N > 1;   // N==1 multi ≡ single
    return {
        surfMode, isMulti, N,
        layerSide: surfMode === 'back_only' ? 'backLayers' : 'frontLayers',
        seed: isMulti ? (plan.seed ?? randomSeed()) : null,
        perturbPct: plan.perturbPct,
        ops: prep.ops, materials: prep.materials, payload,
        maxIter: plan.maxIter,
        nJobs: isMulti ? N : 1,
        K: isMulti ? Math.max(1, Math.min(N, plan.threads)) : 1,
        nextJob: 0, completed: 0,
        globalBest: Infinity, globalBestOMF: null, best: null,
        mfInitial: null, omfInitial: null,
        finished: false, ended: false, gotProgress: false, failed: false,
        cumIter: 0, prevIterByW: new Map(), widSeq: 0, untrack: new Map(), mfHistory: [],
        resolve: null, reject: null,
    };
}

/**
 * Runs `prep` (runRefinement's prepared operands, materials and payload) on the
 * DLS worker pool. Resolves when every restart has reported, when a worker
 * fails, or when the run is aborted. A run whose workers cannot be built ends
 * before it starts.
 */
export function runDlsPool(R, prep) {
    const S = poolState(R, prep);
    return new Promise((resolve, reject) => {
        S.resolve = resolve;
        S.reject = reject;
        const workers = buildWorkers(R, S);
        if (workers.length === 0) { failRun(R, S, 'construction failed', 'new Worker threw'); return; }
        R.onStart({ seed: S.seed });
        R.onMethodStart(S.isMulti ? 'dls-multi' : 'dls', 0);
        R.onProgress({ mfHistory: [], restartIdx: 0 });
        R.whenAborted(() => endRun(R, S, resultOf(S, false, 'stopped')));
        if (!S.ended) startJobs(R, S, prep, workers);
    });
}
