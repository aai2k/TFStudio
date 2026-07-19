// Needle-optimization phases of the main-thread Gradual-Evolution engine: scan
// for improving needle insertions, then DLS-refine each candidate (DLS-1 to
// convergence/cap, DLS-2 accept-or-try-next). See mainThread.js.

import {
    scanNeedlesPFunction, findOptimalNeedleThickness,
    insertNeedle, insertNeedleIntra, cleanupLayers,
} from '../../../../../utils/physics/optimizer.js';
import { makeEngine } from '../../../../../utils/optimizers/index.js';
import { getNeedleSensFloor, cullMarginalNeedles } from '../../../../../utils/synthesis/synthesisConfig.js';
import { resolveMat } from '../../synthesisShared/synthesisHelpers.js';
import { gentleIter, scheduleTick, deepActive, setBase, recordCycle, finalize } from './mainThreadCore.js';

// Insert queue[idx] into `work` at its optimal thickness, spin up DLS1.
function startNeedleCandidate(ctx, S, idx) {
    setBase(ctx, S, S.work.front);
    const design = ctx.baseDesignRef.current;
    const cand   = S.queue[idx];
    cand._mat    = S.pool.find(p => p.id === cand.materialId)?.mat;
    S.lastInsert.mat = cand.materialId;

    let dOpt = ctx.dMinRef.current;
    try {
        dOpt = findOptimalNeedleThickness({
            operands: S.operands, design, resolveMat,
            candidate: cand, deltaNm: ctx.dMinRef.current, maxNm: 500, tol: 0.5, side: S.side,
        });
        if (!(dOpt >= ctx.dMinRef.current)) dOpt = ctx.dMinRef.current;
    } catch (e) { dOpt = ctx.dMinRef.current; }

    const posLabel = cand.intra
        ? `layer${cand.layerK}_f${cand.frac.toFixed(2)}` : `gap${cand.pos}`;
    console.log(`[GE Insert #${idx + 1}/${S.queue.length}] NEEDLE ${cand.materialId} at ${posLabel} d=${dOpt.toFixed(1)}nm (ΔMF=${cand.dMF.toFixed(5)})`);

    const newDesign = cand.intra
        ? insertNeedleIntra(design, cand, dOpt, S.side)
        : insertNeedle(design, cand.pos, cand.materialId, dOpt, S.side);
    ctx.baseDesignRef.current = newDesign;
    ctx.updateDesignRef.current({ [S.LK]: newDesign[S.LK] }, { transient: true });

    try {
        ctx.dlsRef.current = makeEngine(S.innerEngine, S.operands, newDesign, resolveMat, { dMin: ctx.dMinRef.current });
        S.dlsIter1 = 0;
    } catch (err) {
        console.error('[GE] DLS1 init failed:', err);
        finalize(ctx, S, 'DLS init failed'); return;
    }
    S.phase = 'dls1';
    ctx.setPhase('refining');
    ctx.setStatusMsg('DLS refine 1…');
    scheduleTick(ctx, S);
}

// ── Needle scan phase (inner needle-optimization loop) ────────────────────────
export function phaseNeedleScan(ctx, S) {
    setBase(ctx, S, S.work.front);                     // operate on current work
    const design = ctx.baseDesignRef.current;
    const layers = design[S.LK] || [];

    if (layers.length >= ctx.maxLayersRef.current) {
        console.log(`[GE] Max layers reached (${layers.length}) — restoring best MF=${S.best.mf.toFixed(6)}`);
        finalize(ctx, S, 'Max layers reached'); return;
    }

    const thickStr = layers.map(l => `${(l.thickness||0).toFixed(1)}nm ${l.material}`).join(', ');
    console.log(`[GE NeedleScan] geStep=${ctx.geStepsRef.current} workMF=${S.work.mf.toFixed(6)} bestMF=${S.best.mf.toFixed(6)} layers=${layers.length} [${thickStr}]`);

    S.pool = ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current);
    console.log(`[GE NeedleScan] pool=[${S.pool.map(p => p.name).join(', ')}]`);
    ctx.setStatusMsg('Needle scan…');
    if (!S.pool.length) { finalize(ctx, S, 'No candidate materials'); return; }

    const { candidates } = scanNeedlesPFunction({
        operands: S.operands, design, resolveMat, candidateMats: S.pool, deltaNm: 0.5, side: S.side,
    });
    // All improving needles, best (most negative ΔMF) first, then cull the
    // marginal tail (H1 — needle sensitivity; no-op when 'off').
    S.queue = cullMarginalNeedles(
        candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF),
        getNeedleSensFloor());
    S.qIdx  = 0;

    if (S.queue.length === 0) {
        console.log('[GE] Needle-optimal (no improving needle) → forced GE step');
        S.phase = 'ge_step';
        scheduleTick(ctx, S);
        return;
    }
    startNeedleCandidate(ctx, S, 0);
}

// ── DLS-1 refinement phase ────────────────────────────────────────────────────
export function phaseDls1(ctx, S) {
    const dls     = ctx.dlsRef.current;
    const maxIter = S.preserveBulk ? gentleIter(ctx) : ctx.dlsIterRef.current;

    dls.step();
    S.dlsIter1++;
    ctx.setMf(dls.mf);
    ctx.setOmf(dls.mfOpticalAt(dls.thicknesses));

    const done = dls.isConverged() || S.dlsIter1 >= maxIter;
    if (!done) { scheduleTick(ctx, S); return; }

    console.log(`[GE DLS1] ${S.dlsIter1} iters, MF=${dls.mf.toFixed(6)} layers=${dls.thicknesses.length}`);

    const postDls1 = dls.applyToDesign(ctx.baseDesignRef.current);
    const prePruneCount = (postDls1[S.LK] || []).length;
    const pruned   = cleanupLayers(postDls1[S.LK] || [], ctx.dMinRef.current);
    if (pruned.length < prePruneCount) {
        console.log(`[GE Prune] ${prePruneCount}→${pruned.length} layers (removed ${prePruneCount - pruned.length})`);
    }
    if (pruned.length === 0) { finalize(ctx, S, 'All layers pruned'); return; }

    const prunedDesign = { ...postDls1, [S.LK]: pruned };
    ctx.baseDesignRef.current = prunedDesign;
    ctx.updateDesignRef.current({ [S.LK]: pruned }, { transient: true });

    try {
        ctx.dlsRef.current = makeEngine(S.innerEngine, S.operands, prunedDesign, resolveMat, { dMin: ctx.dMinRef.current });
        S.dlsIter2 = 0;
    } catch (err) {
        console.error('[GE] DLS2 init failed:', err);
        finalize(ctx, S, 'DLS init failed'); return;
    }
    S.phase = 'dls2';
    ctx.setStatusMsg('DLS refine 2…');
    scheduleTick(ctx, S);
}

// ── DLS-2 refinement phase (accept-or-revert) ─────────────────────────────────
export function phaseDls2(ctx, S) {
    const dls     = ctx.dlsRef.current;
    const maxIter = Math.max(1, Math.floor((S.preserveBulk ? gentleIter(ctx) : ctx.dlsIterRef.current) / 2));

    dls.step();
    S.dlsIter2++;
    ctx.setMf(dls.mf);
    ctx.setOmf(dls.mfOpticalAt(dls.thicknesses));

    const done = dls.isConverged() || S.dlsIter2 >= maxIter;
    if (!done) { scheduleTick(ctx, S); return; }

    const mfNow       = dls.mf;
    const mfNowOmf    = dls.mfOpticalAt(dls.thicknesses);
    const finalDesign = dls.applyToDesign(ctx.baseDesignRef.current);
    const nLayers     = (finalDesign[S.LK] || []).length;
    console.log(`[GE DLS2] ${S.dlsIter2} iters, MF=${mfNow.toFixed(6)} layers=${nLayers}`);
    ctx.dlsRef.current = null;

    // Accept if this needle improves the CURRENT working design (needle-opt
    // progresses even when work is above the global best — e.g. just after a
    // forced TOT step).
    if (mfNow < S.work.mf - 1e-9) {
        S.work.mf    = mfNow;
        S.work.front = deepActive(S, finalDesign);
        S.curMF.v    = mfNow;
        ctx.baseDesignRef.current = finalDesign;
        ctx.updateDesignRef.current({ [S.LK]: finalDesign[S.LK] }, { transient: true });

        const newGlobalBest = mfNow < S.best.mf - 1e-9;
        if (newGlobalBest) {
            S.best.mf = mfNow;
            S.best.front = deepActive(S, finalDesign);
            S.geStagn.n = 0;
        }
        recordCycle(ctx, S, { type: 'needle', mf: mfNow, layerCount: nLayers, insertMat: S.lastInsert.mat, omf: mfNowOmf });
        console.log(`[GE] ACCEPT needle: workMF=${mfNow.toFixed(6)} ${newGlobalBest ? '(new global best)' : `(best=${S.best.mf.toFixed(6)})`} layers=${nLayers}`);
        console.log('');

        if (S.best.mf < ctx.targetMFRef.current) {
            console.log(`[GE] Converged: best MF=${S.best.mf.toFixed(6)} < tol=${ctx.targetMFRef.current}`);
            finalize(ctx, S, `Converged MF=${S.best.mf.toFixed(6)}`); return;
        }
        S.phase = 'needle_scan';
        ctx.setPhase('scanning');
        ctx.setStatusMsg('');
        scheduleTick(ctx, S);
    } else {
        // This needle didn't help the working design → try the next-best
        // candidate; only when all fail is `work` needle-optimal and we do the
        // forced TOT step.
        S.qIdx += 1;
        if (S.qIdx < S.queue.length) {
            console.log(`[GE] REJECT needle: MF=${mfNow.toFixed(6)} ≥ workMF=${S.work.mf.toFixed(6)} → try next (${S.qIdx + 1}/${S.queue.length})`);
            startNeedleCandidate(ctx, S, S.qIdx);
            return;
        }
        console.log(`[GE] All ${S.queue.length} needles failed → needle-optimal → forced GE step`);
        console.log('');
        setBase(ctx, S, S.work.front);
        S.curMF.v = S.work.mf;
        S.phase = 'ge_step';
        ctx.setPhase('scanning');
        scheduleTick(ctx, S);
    }
}
