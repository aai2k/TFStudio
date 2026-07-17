/**
 * Needle worker-POOL engine — refine phase: parallel batch refinement of the
 * top improving candidates, best-of-batch acceptance, and generation
 * recording (see workerPool.js for the top-level orchestrator; workerPoolScan.js
 * for the scan phase that produces the candidate queue).
 */

import { computePareto, minOmfOf } from '../../synthesisShared/synthesisHelpers.js';
import { wpOnTick, wpAlive } from './workerPoolLifecycle.js';

// Index of the lowest post-refine MF in a candidate batch (−1 if none valid).
export function wpBestOfBatch(results) {
    let idx = -1, mf = Infinity;
    for (let r = 0; r < results.length; r++) {
        const a = results[r].mfAfter;
        if (a != null && a < mf) { mf = a; idx = r; }
    }
    return { idx, mf };
}

// Record an accepted generation: append to history, recompute Pareto + best,
// push display state, and cache for tab-switch survival.
export function wpRecordGeneration(run, res, cand, candSide, candLK) {
    const { ctx, best } = run;
    run.genNum += 1;
    const dMF = run.prevBestMF === Infinity ? null : best.mf - run.prevBestMF;
    run.prevBestMF = Math.min(run.prevBestMF, best.mf);
    const activeLayers = best[candLK];
    const sumD = arr => (arr || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);
    const gen = {
        id: Math.random().toString(36).slice(2),
        genNum: run.genNum, mf: best.mf, omf: res.omf, dMF,
        side:       candSide,
        layerCount: activeLayers.length,
        tot:        sumD(best.frontLayers) + sumD(best.backLayers),
        tMs:        performance.now() - run.runT0,
        insertMat:  cand.materialId ?? null,
        layers:     run.deep(activeLayers),         // active-side snapshot
        frontSnap:  run.deep(best.frontLayers),     // full-design snapshot
        backSnap:   run.deep(best.backLayers),
    };
    ctx.gensRef.current     = [...ctx.gensRef.current, gen];
    ctx.genCountRef.current = run.genNum;
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    ctx.setGeneration(run.genNum);
    ctx.setLayerCount(activeLayers.length);
    ctx.setMfBest(Math.min(...ctx.gensRef.current.map(g => g.mf)));
    ctx.setOmf(res.omf ?? null);
    ctx.setOmfBest(minOmfOf(ctx.gensRef.current));
    ctx.setCachedOptState(ctx.designRef.current?.id, {
        generations: ctx.gensRef.current,
        savedDesign: ctx.savedDesignRef.current,
        baseDesign:  ctx.baseDesignRef.current,
    });
}

// Accept the best-of-batch candidate as the new global best: publish the full
// post-DLS+prune design, record the generation, and report a convergence reason
// (or null to keep going).
export function wpAcceptCandidate(run, batch, results, pick) {
    const { ctx, best } = run;
    const res  = results[pick.idx];
    const cand = batch[pick.idx];
    const candSide = cand.side || run.scanSides[0];
    const candLK   = candSide === 'back' ? 'backLayers' : 'frontLayers';
    best.mf = pick.mf;
    // Worker returns the full post-DLS+prune design; accept both sides.
    best.frontLayers = run.deep(res.frontLayers || best.frontLayers);
    best.backLayers  = run.deep(res.backLayers  || best.backLayers);
    const patch = { frontLayers: best.frontLayers, backLayers: best.backLayers };
    ctx.updateDesignRef.current(patch, { transient: true });
    ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
    wpRecordGeneration(run, res, cand, candSide, candLK);
    console.log(`[Needle] ACCEPT (best of ${batch.length}, side=${candSide}): MF=${best.mf.toFixed(6)} layers=${best[candLK].length} mat=${cand.materialId}`);
    if (best.mf < ctx.targetMFRef.current) {
        console.log(`[Needle] Converged: MF=${best.mf.toFixed(6)} < target=${ctx.targetMFRef.current}`);
        return `Converged MF=${best.mf.toFixed(6)}`;
    }
    return null;
}

// Refine up to maxBatches batches of the top-K improving candidates in
// parallel, accepting the first batch that beats the best. Returns a signal for
// wpRun ({done+reason} on convergence, {accepted} otherwise).
export async function wpRefineBatches(run, queue) {
    const { ctx, best } = run;
    let accepted = false, batchN = 0;
    for (let i = 0; i < queue.length && batchN < run.maxBatches && wpAlive(run); i += run.K, batchN++) {
        const batch = queue.slice(i, i + run.K);
        ctx.setPhase('refining');
        ctx.setStatusMsg(`Refining ${batch.length} candidate${batch.length > 1 ? 's' : ''} (parallel)…`);
        const bsnap = run.designSnap(run.deep(best.frontLayers), run.deep(best.backLayers));
        const results = await run.workerPool.map(batch.map((cand, bi) => ({
            type: 'candidate', pipeline: 'needle',
            operands: run.operands, design: bsnap, materials: run.materials,
            cand: { ...cand, _cid: bi },
            dMin: run.dMin, dlsIter: run.stepIter, jobId: `n${i}_${bi}`, engine: run.innerEngine,
            // The worker honors cand.side; job.side is the fallback for legacy
            // single-side mode.
            side: cand.side || run.scanSides[0],
        })), (idx, m) => wpOnTick(run, idx, m));
        if (!wpAlive(run)) return { aborted: true };

        const pick = wpBestOfBatch(results);
        if (pick.idx >= 0 && pick.mf < best.mf - 1e-9) {
            const conv = wpAcceptCandidate(run, batch, results, pick);
            accepted = true;
            if (conv) return { done: true, reason: conv };
            break;
        }
        console.log(`[Needle] batch ${i}-${i + batch.length - 1}: none beat best=${best.mf.toFixed(6)} → next batch`);
    }
    return { accepted };
}
