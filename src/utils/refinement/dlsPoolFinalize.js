// How a DLS pool run ends: its result, and the Design History row of a run
// that got to the end of its restarts.

import { endReasonFor } from './methods.js';

// The run's result: the best design found so far, whatever ended the run.
export function resultOf(S, completed, stopReason) {
    const best = S.best;
    return {
        completed, stopReason,
        mf: best?.mf ?? null, omf: best?.omf ?? null,
        mfInitial: S.mfInitial, omfInitial: S.omfInitial,
        iter: S.cumIter,
        frontLayers: best?.frontLayers ?? null, backLayers: best?.backLayers ?? null,
        seed: S.seed,
    };
}

// Ends the run once: stops its workers and resolves its promise.
export function endRun(R, S, result) {
    if (S.ended) return;
    S.ended = true;
    R.stopAll();
    S.resolve(result);
}

// Every restart has reported. A single run says how it ended; a multi-start
// ends when its last restart does, which says nothing about the others.
export function finalizeDlsRun(R, S) {
    if (S.finished) return;
    S.finished = true;
    const best = S.best;
    if (best) {
        R.onRecord({
            method: S.isMulti ? 'dls-multi' : 'dls',
            ...(S.isMulti ? { restarts: S.N } : {}),
            iter: S.cumIter, mf: best.mf, omf: best.omf,
            frontLayers: best.frontLayers, backLayers: best.backLayers, layerSide: S.layerSide,
            mfHistory: [...S.mfHistory],
            ...(S.seed != null ? { seed: S.seed } : {}),
        });
        logCompletion(S, best.mf);
    }
    const reason = best && (S.isMulti ? 'restartsDone' : endReasonFor(best.mf, S.lastReason));
    endRun(R, S, resultOf(S, true, reason || null));
}

function logCompletion(S, mf) {
    if (S.isMulti)
        console.log(`[Multi-start pool] Done: ${S.N} restarts on ${S.K} workers, best MF=${mf.toFixed(6)} (mode=${S.surfMode}, seed ${S.seed})`);
    else
        console.log(`[DLS] done: best MF=${mf.toFixed(6)} (${S.lastReason})`);
}
