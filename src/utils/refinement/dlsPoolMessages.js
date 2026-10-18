// Worker message handling for the DLS pool run (runDlsPool, see dlsPool.js).
// One handler per message type, driven off the shared run-state object `S`,
// reporting through the run's hooks.

import { makeJob } from './dlsPoolJobs.js';
import { appendMfSample } from './meritTrend.js';
import { endRun, finalizeDlsRun, resultOf } from './dlsPoolFinalize.js';

// Whether messages still belong to a run that is going on.
export const isLive = (R, S) => !S.ended && !R.aborted();

// Monotonic cumulative iteration counter across ALL workers/restarts. A pooled
// worker's reported iter resets to 0 when it picks up the next restart, so we
// accumulate per-worker DELTAS instead of summing last-reported iters (which was
// non-monotonic and made the MF-trend plot zig-zag / collapse).
function bumpCum(S, wid, it) {
    const prev = S.prevIterByW.get(wid) ?? 0;
    S.cumIter += (it >= prev) ? (it - prev) : it;   // it < prev ⇒ restart reset
    S.prevIterByW.set(wid, it);
    return S.cumIter;
}

function addTrendPoint(S, patch, iter, mf) {
    S.mfHistory = appendMfSample(S.mfHistory, iter, mf);
    patch.mfHistory = S.mfHistory;
}

// A worker that cannot be built, or fails before its first progress message,
// ends the run with the design as it was, and the result says why. A failing
// worker can report by message and by onerror both, so this acts once.
export function failRun(R, S, why, err) {
    if (S.failed) return;
    S.failed = true;
    console.error(`[DLS] Worker ${why}:`, err);
    endRun(R, S, resultOf(S, false, 'workerFailed'));
}

// A worker that fails after it has reported progress, by an error message or
// by its onerror event (`how`), stops the run; the best design so far stays the
// run's result.
export function failAfterProgress(R, S, how, message) {
    console.error(`[DLS] Worker ${how}:`, message);
    endRun(R, S, resultOf(S, false, 'workerError'));
}

function onProgressMsg(R, S, m, wid) {
    S.gotProgress = true;
    const ci = bumpCum(S, wid, m.iter);
    const patch = { iter: ci };
    if (m.mfBest != null && m.mfBest < S.globalBest) {
        S.globalBest = m.mfBest;
        S.globalBestOMF = m.omfBest ?? S.globalBestOMF;
        patch.mfBest = S.globalBest;
        patch.omfBest = S.globalBestOMF;
        if (m.bestFrontLayers) {
            S.best = { mf: S.globalBest, omf: S.globalBestOMF ?? null, frontLayers: m.bestFrontLayers, backLayers: m.bestBackLayers, iter: ci };
            patch.best = S.best;
            if (S.isMulti) patch.design = { frontLayers: m.bestFrontLayers, backLayers: m.bestBackLayers };
        }
    }
    if (!S.isMulti) {
        // Single-start: live MF trajectory (per-progress) + live design.
        patch.mf = m.mf;
        if (m.omf != null) patch.omf = m.omf;
        addTrendPoint(S, patch, ci, m.mf);
        patch.design = { frontLayers: m.frontLayers, backLayers: m.backLayers };
    } else {
        // Multi-start pool: a point on EVERY progress so the plot renders,
        // plotting best-so-far vs. monotonic cumulative iterations (clean
        // staircase across all restarts).
        const y = (S.globalBest === Infinity) ? m.mf : S.globalBest;
        patch.mf = y;
        patch.omf = (S.globalBest === Infinity) ? (m.omf ?? null) : S.globalBestOMF;
        addTrendPoint(S, patch, ci, y);
    }
    R.onProgress(patch);
}

function takeDoneBest(S, m, ci, patch) {
    const mfB = m.mfBest ?? m.mf;
    const omfB = m.omfBest ?? m.omf;
    if (!(mfB < S.globalBest)) return mfB;
    S.globalBest = mfB;
    S.globalBestOMF = omfB ?? S.globalBestOMF;
    patch.mfBest = S.globalBest;
    patch.mf = S.globalBest;
    patch.omfBest = S.globalBestOMF;
    patch.omf = S.globalBestOMF;
    S.best = {
        mf: S.globalBest, omf: S.globalBestOMF ?? null,
        frontLayers: m.bestFrontLayers || m.frontLayers,
        backLayers:  m.bestBackLayers  || m.backLayers,
        iter: ci,
    };
    patch.best = S.best;
    return mfB;
}

function onDoneMsg(R, S, w, m, wid) {
    S.gotProgress = true;
    S.lastReason = m.reason;
    const ci = bumpCum(S, wid, m.iter);
    const patch = {};
    const mfB = takeDoneBest(S, m, ci, patch);
    S.completed++;
    patch.iter = ci;
    if (S.isMulti) {
        addTrendPoint(S, patch, ci, S.globalBest === Infinity ? mfB : S.globalBest);
        patch.restartIdx = S.completed;
    } else {
        // A fast DLS run often finishes before the progress throttle emits
        // anything after iteration 0. The done message carries both the real
        // final iteration count and the sample needed to display its plot.
        addTrendPoint(S, patch, ci, m.mf);
    }
    R.onProgress(patch);
    if (S.nextJob < S.nJobs) {
        const r = S.nextJob++;
        w.postMessage(makeJob(S, S.isMulti ? r + 1 : 0));
        return;
    }
    try { w.terminate(); } catch (_) {}
    S.untrack.get(w)?.();
    if (S.completed >= S.nJobs) finalizeDlsRun(R, S);
}

function onErrorMsg(R, S, m) {
    if (!S.gotProgress) failRun(R, S, 'errored before progress', m.message);
    else failAfterProgress(R, S, 'error', m.message);
}

export function handleMsg(R, S, w, wid, e) {
    const m = e.data;
    if (!m || !isLive(R, S)) return;   // empty / stale post-stop message
    if (m.type === 'warn')  { console.warn(m.message); return; }
    if (m.type === 'error') { onErrorMsg(R, S, m); return; }
    // 'init' is a no-op (mfInitial is computed on the calling thread).
    if (m.type === 'progress') onProgressMsg(R, S, m, wid);
    else if (m.type === 'done') onDoneMsg(R, S, w, m, wid);
}
