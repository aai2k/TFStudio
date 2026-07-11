/**
 * Needle Variation optimization engine (main-thread path).
 *
 * The standalone-needle synthesis loop, extracted from the window component so
 * the component holds only React state + render. The heavy default path runs on
 * a worker pool; this is the identical-math main-thread FALLBACK used only if
 * the worker pool fails before any progress. It blocks the UI thread, so it is
 * the fallback, not the default.
 *
 * All React state is reached through a `ctx` bundle of refs + setters + a few
 * window-specific helpers, supplied by the component. Per-run state lives on a
 * plain `run` object so the phase machine can be split into small module
 * functions instead of one nested closure.
 *
 * Phase machine (Sullivan & Dobrowolski 1996; Tikhonravov 1996):
 *   'scanning'  → needle scan → pick best improving needle → insert → make DLS.
 *   'refining'  → DLS.step() to convergence → accept-or-revert. A needle is
 *                 accepted only if it lowers the merit function after refinement;
 *                 otherwise revert to the best so far and try the next candidate.
 *                 With no outer forced-TOT loop (that is Gradual Evolution's
 *                 job), "no improving needle" is the correct stop condition.
 */

import {
    scanNeedlesPFunction, findOptimalNeedleThickness,
    insertNeedle, insertNeedleIntra, cleanupLayers, isConstraint,
} from '../../../utils/physics/optimizer.js';
import { densifyForRun, activeSide, resolveMat, computePareto, minOmfOf } from './synthesisHelpers.js';
import { makeEngine } from '../../../utils/optimizers/index.js';
import { getSynthesisInnerEngine, getNeedleSensFloor, cullMarginalNeedles } from '../../../utils/synthesis/synthesisConfig.js';

const deepCopy = (x) => JSON.parse(JSON.stringify(x));

// Restore the active-side layers of the running design to the best-so-far.
// transient: a live synthesis preview, not a user commit — no undo entry per
// rejected candidate, and it does not bump the M12 user-edit revision mid-run.
function mtRevertToBest(run) {
    const { ctx, LK, best } = run;
    ctx.baseDesignRef.current = { ...ctx.baseDesignRef.current, [LK]: deepCopy(best.front) };
    ctx.updateDesignRef.current({ [LK]: deepCopy(best.front) }, { transient: true });
}

// Restore the best design, publish it, and stop the run with a status message.
function mtFinalize(run, msg) {
    const { ctx, LK, best } = run;
    if (best.front) {
        ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || {}), [LK]: deepCopy(best.front) };
        ctx.updateDesignRef.current({ [LK]: deepCopy(best.front) }, { transient: true });
        ctx.setMfBest(best.mf);
        ctx.setLayerCount(best.front.length);
    }
    ctx.runningRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(msg);
}

// Insert queue[idx] into the (reverted) best design at its optimal thickness
// (findOptimalNeedleThickness — golden-section MF minimum, Sullivan §3), spin up
// DLS, and hand off to the refine phase.
function mtStartCandidate(run, idx) {
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
    ctx.timerRef.current = setTimeout(() => mtTick(run), 0);
}

// Scanning phase: scan all insertion positions × pool materials, build the
// improving-needle queue (best ΔMF first, marginal tail culled), and start the
// first candidate — or finalize if max-layers reached / no improving needle.
function mtScanStep(run) {
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

// Record an accepted generation: append to history, recompute Pareto + best,
// push the display state, and cache for tab-switch survival.
function mtRecordGeneration(run, dls, prunedLayers, mfAfter) {
    const { ctx } = run;
    ctx.genCountRef.current += 1;
    const genNum     = ctx.genCountRef.current;
    const prevBestMF = ctx.gensRef.current.length ? Math.min(...ctx.gensRef.current.map(g => g.mf)) : Infinity;
    const dMF        = prevBestMF === Infinity ? null : mfAfter - prevBestMF;
    const gen = {
        id:         Math.random().toString(36).slice(2),
        genNum,
        mf:         mfAfter,
        omf:        dls.mfOpticalAt(dls.thicknesses),
        dMF,
        layerCount: prunedLayers.length,
        tMs:        performance.now() - run.runT0,
        insertMat:  ctx.lastBestRef.current?.materialId ?? null,
        layers:     deepCopy(prunedLayers),
    };
    ctx.gensRef.current = [...ctx.gensRef.current, gen];
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    ctx.setGeneration(genNum);
    ctx.setLayerCount(prunedLayers.length);
    ctx.setMfBest(Math.min(...ctx.gensRef.current.map(g => g.mf)));
    ctx.setOmf(gen.omf);
    ctx.setOmfBest(minOmfOf(ctx.gensRef.current));
    ctx.setCachedOptState(ctx.designRef.current?.id, {
        generations: ctx.gensRef.current,
        savedDesign: ctx.savedDesignRef.current,
        baseDesign:  ctx.baseDesignRef.current,
    });
}

// Refining phase: one DLS step, then on convergence prune thin layers and
// accept (new global best → record generation) or reject (try next candidate,
// else needle-optimal).
function mtRefineStep(run) {
    const { ctx, LK, best } = run;
    const dls = ctx.dlsRef.current;
    if (!dls) { ctx.dlsRef.current = null; ctx.timerRef.current = setTimeout(() => mtTick(run), 0); return; }

    dls.step();
    ctx.setMf(dls.mf);
    ctx.setOmf(dls.mfOpticalAt(dls.thicknesses));
    ctx.setLayerCount(dls.thicknesses.length);

    const converged = dls.isConverged() || dls.iter >= ctx.dlsIterRef.current;
    if (!converged) { ctx.timerRef.current = setTimeout(() => mtTick(run), 0); return; }

    // DLS done — prune thin layers (on the active side).
    const preDesign    = dls.applyToDesign(ctx.baseDesignRef.current);
    const prunedLayers = cleanupLayers(preDesign[LK] || [], ctx.dMinRef.current);
    const prunedDesign = { ...preDesign, [LK]: prunedLayers };
    const mfAfter      = dls.mf;
    console.log(`[Needle DLS] ${dls.iter} iters, MF=${mfAfter.toFixed(6)} layers=${prunedLayers.length}`);

    if (!(mfAfter < best.mf - 1e-9)) {
        // This needle didn't help → try the next-best candidate.
        ctx.dlsRef.current = null;
        run.qIdx += 1;
        if (run.qIdx < run.queue.length) {
            console.log(`[Needle] REJECT: MF=${mfAfter.toFixed(6)} ≥ best=${best.mf.toFixed(6)} → try next candidate (${run.qIdx + 1}/${run.queue.length})`);
            mtStartCandidate(run, run.qIdx);
            return;
        }
        console.log(`[Needle] All ${run.queue.length} improving candidates failed → needle-optimal, restoring best`);
        mtFinalize(run, 'Needle-optimal (all candidates exhausted)');
        return;
    }

    // Accept: new global best.
    best.mf    = mfAfter;
    best.front = deepCopy(prunedLayers);
    ctx.baseDesignRef.current = prunedDesign;
    ctx.updateDesignRef.current({ [LK]: prunedLayers }, { transient: true });

    mtRecordGeneration(run, dls, prunedLayers, mfAfter);

    if (best.mf < ctx.targetMFRef.current) {
        console.log(`[Needle] Converged: MF=${best.mf.toFixed(6)} < target=${ctx.targetMFRef.current}`);
        mtFinalize(run, `Converged MF=${best.mf.toFixed(6)}`);
        return;
    }

    // Next iteration: fresh scan on the improved design.
    ctx.dlsRef.current = null;
    ctx.setPhase('scanning');
    ctx.setStatusMsg('');
    ctx.timerRef.current = setTimeout(() => mtTick(run), 0);
}

// One phase-machine step, scheduled via setTimeout so the UI thread can breathe.
function mtTick(run) {
    if (!run.ctx.runningRef.current) return;
    if (run.ctx.dlsRef.current) mtRefineStep(run);
    else mtScanStep(run);
}

// Entry point: set up the run (snapshot + checkpoint on first run) and kick the
// phase machine. Standalone Needle is a SYNTHESIS step — thickness constraints
// are dropped (the caller re-enables them for the post-synthesis Refinement).
export function runNeedleMainThread(ctx) {
    if (ctx.runningRef.current) return;
    ctx.reconcileBaseWithEdits();

    const curDes  = ctx.baseDesignRef.current || ctx.designRef.current;
    const enabled = ctx.operandsRef.current.filter(op => op.enabled);
    const operands = densifyForRun(enabled.filter(op => !isConstraint(op.type)), curDes);
    if (!curDes || operands.length === 0) return;
    const innerEngine = getSynthesisInnerEngine('needle');   // Needle default 'cg'

    // Which layer array this run targets (forced by surfaceMode; for
    // both_independent defaults to 'front'). insertNeedle handles symmetric
    // mirroring automatically.
    const side = activeSide(curDes);
    const LK   = side === 'back' ? 'backLayers' : 'frontLayers';

    // Snapshot on first run + one undo checkpoint for the whole synthesis run
    // (per-iteration design writes are transient previews).
    if (!ctx.savedDesignRef.current) {
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.savedDesignRef.current = { frontLayers: ctx.designRef.current.frontLayers, backLayers: ctx.designRef.current.backLayers };
        ctx.baseDesignRef.current  = curDes;
        ctx.setCanReset(true);
    }

    ctx.runningRef.current = true;
    ctx.setPhase('scanning');

    // Cumulative wallclock, continuous across stop/resume.
    const prevElapsed = ctx.gensRef.current.length
        ? (ctx.gensRef.current[ctx.gensRef.current.length - 1].tMs || 0) : 0;
    const run = {
        ctx, operands, innerEngine, side, LK,
        best: { mf: Infinity, front: null },
        queue: [], qIdx: 0, pool: [],
        runT0: performance.now() - prevElapsed,
    };
    ctx.timerRef.current = setTimeout(() => mtTick(run), 0);
}
