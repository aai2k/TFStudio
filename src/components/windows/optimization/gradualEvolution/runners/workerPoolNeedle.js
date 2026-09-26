// Needle-optimization phase of the worker-pool Gradual-Evolution engine: scan
// one side for improving needle insertions, then DLS-refine top candidates in
// parallel batches until one beats the working design. See workerPool.js.

import {
    getNeedleSensFloor, cullMarginalNeedles, SYNTHESIS_INTRA_SAMPLES,
} from '../../../../../utils/synthesis/synthesisConfig.js';
import { deep, designSnap, alive, onTick, applyDesignPatch, recordCycle, recordRefine } from './workerPoolCore.js';
import { noteNeedleStep, fitsLayerLimit } from './undoneSteps.js';

// Scan side `sd` on the current `work` and return the improving-needle queue
// of needles that fit the layer limit (best ΔMF first, marginal tail culled
// per H1 — needle sensitivity). Returns [] both when the pool died mid-scan
// and when nothing improves — both cases leave the caller with nothing to
// refine, and neither logs a distinguishing message in the original engine.
async function scanSideQueue(ctx, S, sd, timing) {
    const snap = designSnap(S, S.work.frontLayers, S.work.backLayers);
    const sideScanJobs = S.poolSlices.map(slice => ({
        type: 'scan', operands: S.operands, design: snap,
        materials: S.materials, poolSlice: slice, deltaNm: 0.5, side: sd,
        dMin: S.dMin, nIntra: SYNTHESIS_INTRA_SAMPLES }));
    const sideScanRes = await S.workerPool.map(sideScanJobs);
    if (!alive(ctx, S)) return [];
    timing.scanMs = performance.now() - timing.genT0;
    let candidates = [];
    for (const r of sideScanRes) candidates = candidates.concat(r.candidates || []);
    const layers = sd === 'back' ? S.work.backLayers : S.work.frontLayers;
    // Improving needles that fit best-first, then cull the marginal tail (H1 —
    // needle sensitivity; no-op when 'off' ⇒ bit-identical).
    return cullMarginalNeedles(
        candidates.filter(c => c.dMF < 0 && fitsLayerLimit(c, layers, S.maxLayers)).sort((a, b) =>
            (a.dMF - b.dMF) || ((a.pos ?? 0) - (b.pos ?? 0)) ||
            (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0)),
        getNeedleSensFloor());
}

// Commit the batch's winning candidate: accept it into `work` (and `best` if
// it's a new global best), apply the design patch, and record the cycle. A
// winner whose needle merged into a neighbour only refined the existing layers:
// it is taken the same way but is not a Needle row (recordRefine).
function acceptBatchWinner(ctx, S, win, timing) {
    const { sd, cand, res, batchSize, bMf } = win;
    const candSide = cand.side || sd;
    S.work.mf = bMf;
    S.work.frontLayers = deep(res.frontLayers || S.work.frontLayers);
    S.work.backLayers  = deep(res.backLayers  || S.work.backLayers);
    applyDesignPatch(ctx, S, S.work.frontLayers, S.work.backLayers);
    ctx.setMf(bMf);
    if (res.omf != null) ctx.setOmf(res.omf);
    const newGlobalBest = bMf < S.best.mf - 1e-9;
    if (newGlobalBest) {
        S.best.mf = bMf;
        S.best.frontLayers = deep(S.work.frontLayers);
        S.best.backLayers  = deep(S.work.backLayers);
    }
    const activeLayers = candSide === 'back' ? S.work.backLayers : S.work.frontLayers;
    noteNeedleStep(S, res.needleKept, newGlobalBest);
    const row = { mf: bMf, layerCount: res.nLayers, side: candSide, activeLayers, omf: res.omf };
    if (res.needleKept) recordCycle(ctx, S, { ...row, type: 'needle', insertMat: cand.materialId });
    else recordRefine(ctx, S, { ...row, newBest: newGlobalBest });
    console.log(`[GE] ACCEPT ${res.needleKept ? 'needle' : 'refine (needle merged into a neighbour)'} (best of ${batchSize}, side=${candSide}): workMF=${bMf.toFixed(6)} ${newGlobalBest ? '(new global best)' : `(best=${S.best.mf.toFixed(6)})`} layers=${res.nLayers}`);
    console.log(`[GE timing] engine=${S.innerEngine} ACCEPT layers=${res.nLayers} scan=${timing.scanMs.toFixed(0)}ms refine=${timing.refMs.toFixed(0)}ms cands=${timing.nCand} gen=${(performance.now() - timing.genT0).toFixed(0)}ms (scan ${(100*timing.scanMs/Math.max(1,timing.scanMs+timing.refMs)).toFixed(0)}% / refine ${(100*timing.refMs/Math.max(1,timing.scanMs+timing.refMs)).toFixed(0)}%)`);
}

// DLS-refine one batch of top candidates in parallel and keep the best (not
// first-improving in ΔMF order). Returns `{ stopped: true }` if the pool died
// mid-refine, `{ accepted: true }` if a candidate beat work.mf (recorded via
// acceptBatchWinner), or `{}` if none beat it (caller tries the next batch).
async function refineOneBatch(ctx, S, req, timing) {
    const { sd, batch, i } = req;
    ctx.setPhase('refining');
    ctx.setStatusMsg(S.tg.status.refiningCandidates(batch.length, S.scanSides.length > 1 ? sd : null));
    const bsnap = designSnap(S, deep(S.work.frontLayers), deep(S.work.backLayers));
    const _rT0 = performance.now();
    const results = await S.workerPool.map(batch.map((cand, bi) => ({
        type: 'candidate', pipeline: 'ge',
        operands: S.operands, design: bsnap, materials: S.materials,
        cand: { ...cand, _cid: bi },
        dMin: S.dMin, dlsIter: S.stepIter, jobId: `g_${sd}_${i}_${bi}`,
        side: cand.side || sd, engine: S.innerEngine,
    })), (bi, m) => onTick(ctx, S, bi, m));
    timing.refMs += performance.now() - _rT0;
    timing.nCand += batch.length;
    if (!alive(ctx, S)) return { stopped: true };

    let bIdx = -1, bMf = Infinity;
    for (let r = 0; r < results.length; r++) {
        const rr = results[r];
        if (rr.allPruned || rr.mfNow == null) continue;
        if (rr.mfNow < bMf) { bMf = rr.mfNow; bIdx = r; }
    }
    if (bIdx >= 0 && bMf < S.work.mf - 1e-9) {
        acceptBatchWinner(ctx, S, { sd, cand: batch[bIdx], res: results[bIdx], batchSize: batch.length, bMf }, timing);
        return { accepted: true };
    }
    console.log(`[GE] side=${sd} batch ${i}-${i + batch.length - 1}: none beat workMF=${S.work.mf.toFixed(6)} → next`);
    return {};
}

// Per-side accept helper. Scans ONE side on the current `work`, top-K DLS-refines
// improving candidates that fit the layer limit until one beats work.mf or the
// queue is exhausted. At the limit only needles that merge into a neighbour
// fit, so the stack is still refined there. Returns true if a needle was
// accepted (work + best updated, cycle recorded). For both_independent this is
// called once per side per outer iteration so both stacks grow; for
// single-side modes it is called once with the forced side.
export async function tryAcceptOnSide(ctx, S, sd) {
    ctx.setPhase('scanning');
    ctx.setStatusMsg(S.scanSides.length > 1 ? S.tg.status.scanningSide(sd) : S.tg.status.scanning);
    // ── timing (per-generation cost breakdown) ──
    const genT0 = performance.now();
    const timing = { genT0, scanMs: 0, refMs: 0, nCand: 0 };
    const queue = await scanSideQueue(ctx, S, sd, timing);
    if (queue.length === 0) return false;

    // Cap how many K-batches we refine per step. The long tail of marginal
    // P-candidates was the 9–21 s/gen stall cost (45–56 candidates = 6–7 rounds);
    // OTF inserts the best few and moves on. When the capped batches don't
    // improve we fall through to forced-TOT (which re-scans) sooner.
    let _batchN = 0;
    for (let i = 0; i < queue.length && _batchN < S.maxBatches && alive(ctx, S); i += S.K, _batchN++) {
        const batch = queue.slice(i, i + S.K);
        const outcome = await refineOneBatch(ctx, S, { sd, batch, i }, timing);
        if (outcome.stopped) return false;
        if (outcome.accepted) return true;
    }
    // Distinguish a TRUE needle-optimum (queue exhausted) from a batch-CAP early
    // exit (more candidates remain, but the cap reached → go to forced-TOT, which
    // re-scans).
    const _capped = _batchN >= S.maxBatches && _batchN * S.K < queue.length;
    console.log(`[GE timing] ${_capped ? `CAPPED@${S.maxBatches}b` : 'NEEDLE-OPTIMAL'} side=${sd} scan=${timing.scanMs.toFixed(0)}ms refine=${timing.refMs.toFixed(0)}ms cands=${timing.nCand}/${queue.length}`);
    return false;
}
