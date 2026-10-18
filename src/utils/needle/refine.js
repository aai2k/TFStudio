// The refine phase of a Needle run: the top improving candidates of a scan
// refined in parallel batches, the best of a batch accepted when it beats the
// best so far. Keeping the best of the top K candidates, rather than the first
// that improves in ΔMF order, uses every thread; it is not the same answer a
// one-at-a-time run gives.

import { withoutWins } from '../physics/optimizer/parkedLayers.js';
import { alive } from './runState.js';
import { recordGeneration } from './generations.js';

// Index of the lowest post-refine MF in a candidate batch (−1 if none valid).
function bestOfBatch(results) {
    let idx = -1, mf = Infinity;
    for (let r = 0; r < results.length; r++) {
        const a = results[r].mfAfter;
        if (a != null && a < mf) { mf = a; idx = r; }
    }
    return { idx, mf };
}

// Accept the best-of-batch candidate as the new global best: take the full
// post-refine design, record the generation, and report the target being
// reached (or null to keep going).
function acceptCandidate(run, batch, results, pick) {
    const { best } = run;
    const res  = results[pick.idx];
    const cand = batch[pick.idx];
    const candSide = cand.side || run.scanSides[0];
    const candLK   = candSide === 'back' ? 'backLayers' : 'frontLayers';
    best.mf = pick.mf;
    best.omf = res.omf ?? null;
    // Worker returns the full post-refine design; accept both sides.
    best.frontLayers = run.deep(res.frontLayers || best.frontLayers);
    best.backLayers  = run.deep(res.backLayers  || best.backLayers);
    recordGeneration(run, { omf: res.omf, side: candSide, insertMat: cand.materialId ?? null });
    console.log(`[Needle] ACCEPT (best of ${batch.length}, side=${candSide}): MF=${best.mf.toFixed(6)} layers=${best[candLK].length} mat=${cand.materialId}`);
    if (best.mf < run.targetMF) {
        console.log(`[Needle] Converged: MF=${best.mf.toFixed(6)} < target=${run.targetMF}`);
        return { stopReason: 'target', stopMF: best.mf };
    }
    return null;
}

// The candidate a generation accepts, refined again without the layers its
// refine parked on the floor, with half the iterations (parkedLayers.js). One
// job per generation, not one per candidate: the batch waits for its slowest
// candidate, and a trial in any of them held the whole batch. Returns the
// result to accept in place of `res` when the stack without them has a merit
// no higher, else null.
async function withoutParked(run, res, cand) {
    const [r] = await run.workerPool.map([{
        type: 'dropParked', operands: run.operands, materials: run.materials,
        design: run.designSnap(res.frontLayers, res.backLayers),
        dMin: run.dMin, dlsIter: Math.max(1, Math.floor(run.refineIter / 2)),
        jobId: 'parked', side: cand.side || run.scanSides[0], engine: run.innerEngine,
    }], run.onTick);
    if (!r || !r.removed || !withoutWins(res.mfAfter, r.mf)) return null;
    return { ...res, mfAfter: r.mf, omf: r.omf, frontLayers: r.frontLayers, backLayers: r.backLayers };
}

// The batch's best candidate, when it beats the best so far: tried without its
// parked layers, then accepted. Returns refineBatches' signal, or null when
// the batch has nothing to accept.
async function acceptBest(run, batch, results) {
    const pick = bestOfBatch(results);
    if (pick.idx < 0 || !(pick.mf < run.best.mf - 1e-9)) return null;
    const trimmed = await withoutParked(run, results[pick.idx], batch[pick.idx]);
    if (!alive(run)) return { aborted: true };
    if (trimmed) { results[pick.idx] = trimmed; pick.mf = trimmed.mfAfter; }
    const end = acceptCandidate(run, batch, results, pick);
    return end ? { done: true, end } : { accepted: true };
}

// Refine up to maxBatches batches of the top-K improving candidates in
// parallel, accepting the first batch that beats the best. Returns a signal for
// the cycle loop ({done, end} on reaching the target, {accepted} otherwise).
export async function refineBatches(run, queue) {
    const { best } = run;
    let batchN = 0;
    for (let i = 0; i < queue.length && batchN < run.maxBatches && alive(run); i += run.K, batchN++) {
        const batch = queue.slice(i, i + run.K);
        run.emit({ phase: 'refining', activity: { id: 'refiningCandidates', count: batch.length } });
        const bsnap = run.designSnap(run.deep(best.frontLayers), run.deep(best.backLayers));
        const results = await run.workerPool.map(batch.map((cand, bi) => ({
            type: 'candidate', pipeline: 'needle',
            operands: run.operands, design: bsnap, materials: run.materials,
            cand: { ...cand, _cid: bi },
            dMin: run.dMin, dlsIter: run.refineIter, jobId: `n${i}_${bi}`, engine: run.innerEngine,
            // The worker honors cand.side; job.side is the fallback for legacy
            // single-side mode.
            side: cand.side || run.scanSides[0],
        })), run.onTick);
        if (!alive(run)) return { aborted: true };

        const outcome = await acceptBest(run, batch, results);
        if (outcome) return outcome;
        console.log(`[Needle] batch ${i}-${i + batch.length - 1}: none beat best=${best.mf.toFixed(6)} → next batch`);
    }
    return { accepted: false };
}
