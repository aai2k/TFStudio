/**
 * Needle main-thread engine — scan phase (see mainThread.js for the refine
 * phase and the tick dispatcher). Scans all insertion positions × pool
 * materials, builds the improving-needle queue, and inserts the first
 * candidate at its optimal thickness (Sullivan & Dobrowolski 1996 §3).
 */

import {
    scanNeedlesPFunction, findOptimalNeedleThickness, insertNeedle, insertNeedleIntra,
} from '../../../../../utils/physics/optimizer.js';
import { resolveMat } from '../../synthesisShared/synthesisHelpers.js';
import { makeEngine } from '../../../../../utils/optimizers/index.js';
import { getNeedleSensFloor, cullMarginalNeedles } from '../../../../../utils/synthesis/synthesisConfig.js';
import { deepCopy, mtRevertToBest, mtFinalize } from './mainThreadCore.js';

// Insert queue[idx] into the (reverted) best design at its optimal thickness
// (findOptimalNeedleThickness — golden-section MF minimum, Sullivan §3), spin up
// DLS, and hand off to the refine phase.
export function mtStartCandidate(run, idx) {
    const { ctx, operands, side, LK, innerEngine, queue, pool } = run;
    mtRevertToBest(run);
    const cand = queue[idx];
    cand._mat = pool.find(p => p.id === cand.materialId)?.mat;

    let dOpt = ctx.dMinRef.current;
    try {
        dOpt = findOptimalNeedleThickness({
            operands, design: ctx.baseDesignRef.current, resolveMat,
            candidate: cand, deltaNm: ctx.dMinRef.current, maxNm: 500, tol: 0.5, side,
        });
        if (!(dOpt >= ctx.dMinRef.current)) dOpt = ctx.dMinRef.current;
    } catch (e) { dOpt = ctx.dMinRef.current; }

    const posLabel = cand.intra
        ? `layer${cand.layerK}_f${cand.frac.toFixed(2)}` : `gap${cand.pos}`;
    console.log(`[Needle Insert #${idx + 1}/${queue.length}] ${cand.materialId} at ${posLabel} d=${dOpt.toFixed(1)}nm (ΔMF=${cand.dMF.toFixed(5)})`);

    const newDesign = cand.intra
        ? insertNeedleIntra(ctx.baseDesignRef.current, cand.layerK, cand.frac, cand.materialId, dOpt, side)
        : insertNeedle(ctx.baseDesignRef.current, cand.pos, cand.materialId, dOpt, side);
    ctx.baseDesignRef.current = newDesign;
    ctx.updateDesignRef.current({ [LK]: newDesign[LK] }, { transient: true });

    try {
        ctx.dlsRef.current  = makeEngine(innerEngine, operands, newDesign, resolveMat, { dMin: ctx.dMinRef.current });
        ctx.lastBestRef.current = cand;
    } catch (err) {
        console.error('[Needle] DLS init failed:', err);
        ctx.dlsRef.current = null;
        mtFinalize(run, 'DLS init failed');
        return;
    }
    ctx.setPhase('refining');
    ctx.setStatusMsg('Refining…');
    ctx.timerRef.current = setTimeout(() => run.tick(), 0);
}

// Scanning phase: scan all insertion positions × pool materials, build the
// improving-needle queue (best ΔMF first, marginal tail culled), and start the
// first candidate — or finalize if max-layers reached / no improving needle.
export function mtScanStep(run) {
    const { ctx, operands, side, LK, best } = run;
    const layerCount = (ctx.baseDesignRef.current[LK] || []).length;

    if (layerCount >= ctx.maxLayersRef.current) {
        console.log(`[Needle] Max layers reached (${layerCount}) — restoring best`);
        mtFinalize(run, 'Max layers reached');
        return;
    }

    run.pool = ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current);
    if (!run.pool.length) {
        ctx.runningRef.current = false;
        ctx.setPhase('idle');
        ctx.setStatusMsg('No candidate materials');
        return;
    }

    console.log(`[Needle Scan] layers=${layerCount} pool=[${run.pool.map(p => p.name).join(', ')}]`);
    ctx.setPhase('scanning');
    ctx.setStatusMsg('Scanning needles…');

    const { candidates, mf0 } = scanNeedlesPFunction({
        operands, design: ctx.baseDesignRef.current, resolveMat,
        candidateMats: run.pool, deltaNm: ctx.deltaNmRef.current, side,
    });

    // First scan establishes the baseline best (current design).
    if (best.front === null) {
        best.mf    = mf0;
        best.front = deepCopy(ctx.baseDesignRef.current[LK] || []);
        ctx.setMfBest(mf0);
    }

    // All improving needles, best (most negative ΔMF) first, then cull the
    // marginal tail (H1 — needle sensitivity; no-op when 'off').
    run.queue = cullMarginalNeedles(
        candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF),
        getNeedleSensFloor());
    run.qIdx = 0;

    if (run.queue.length === 0) {
        console.log('[Needle Scan] No improving needle — needle-optimal, restoring best');
        mtFinalize(run, 'Needle-optimal (no improving needle)');
        return;
    }
    mtStartCandidate(run, 0);
}
