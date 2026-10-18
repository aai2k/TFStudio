// DLS multi-start as one method of a method list (methodsFlow.js): N perturbed
// single-DLS runs in batches of K, keeping the best. A run of 'dls-multi' alone
// takes the DLS worker pool instead (dlsPool.js).

import { perturbPayload, restartRng } from './restarts.js';
import { runEngineP } from './engineRun.js';

// run: { ops, payload, materials, N, pct, alive, onProg, seed }
function makeMultiBatch(R, run, start, count) {
    const batch = [];
    for (let i = 0; i < count && start + i < run.N; i++) {
        const restart = start + i;
        batch.push(runEngineP(R, 'dls', {
            ops: run.ops, payload: perturbPayload(run.payload, run.pct, restart, restartRng(run.seed, restart)),
            materials: run.materials, alive: run.alive, onProg: null, preview: false,
        }));
    }
    return batch;
}

// A restart whose worker failed still offers what it found before failing. The
// live design follows the best restart only while the run goes on: after a Stop
// the design stays where the user stopped it.
function collectMultiResult(R, state, result, run) {
    if (!result) return;
    const { failed, ...found } = result;
    if (failed) state.failed += 1; else state.ok += 1;
    if (found.mf == null) return;
    const n = Number(found.iters);
    state.totalIters += Number.isFinite(n) ? Math.max(0, n) : 0;
    if (!state.best || found.mf < state.best.mf) {
        state.best = { ...found };
        if (run.alive()) R.onProgress({ design: { frontLayers: state.best.frontLayers, backLayers: state.best.backLayers } });
    }
    if (run.onProg && state.best) run.onProg(state.best.mf, state.totalIters, state.best.omf);
}

// Resolves to the best restart, null when a Stop came before any result, or a
// result marked `failed` when every restart's worker failed.
export async function runMultiP(R, run) {
    const K = R.plan.threads;
    const state = { best: null, totalIters: 0, ok: 0, failed: 0 };
    for (let start = 0; start < run.N && run.alive(); start += K) {
        const results = await Promise.all(makeMultiBatch(R, run, start, K));
        for (const result of results) collectMultiResult(R, state, result, run);
    }
    const best = state.best && { ...state.best, iters: state.totalIters };
    if (state.ok > 0 || state.failed === 0) return best;
    return best ? { ...best, failed: true } : { failed: true };
}
