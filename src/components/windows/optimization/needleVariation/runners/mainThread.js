/**
 * Needle Variation optimization engine (main-thread path).
 *
 * The standalone-needle synthesis loop, extracted from the window component so
 * the component holds only React state + render. The heavy default path runs on
 * a worker pool (workerPool.js); this is the identical-math main-thread FALLBACK
 * used only if the worker pool fails before any progress. It blocks the UI
 * thread, so it is the fallback, not the default.
 *
 * All React state is reached through a `ctx` bundle of refs + setters + a few
 * window-specific helpers, supplied by the component. Per-run state lives on a
 * plain `run` object so the phase machine can be split into small module
 * functions instead of one nested closure (see mainThreadScan.js for the scan
 * + candidate-insertion phase; mainThreadCore.js for shared revert/finalize).
 *
 * Phase machine (Sullivan & Dobrowolski 1996; Tikhonravov 1996):
 *   'scanning'  → needle scan → pick best improving needle → insert → make DLS.
 *   'refining'  → DLS.step() to convergence → accept-or-revert. A needle is
 *                 accepted only if it lowers the merit function after refinement;
 *                 otherwise revert to the best so far and try the next candidate.
 *                 With no outer forced-TOT loop (that is Gradual Evolution's
 *                 job), "no improving needle" is the correct stop condition.
 */

import { cleanupLayers, isConstraint } from '../../../../../utils/physics/optimizer.js';
import { densifyForRun, activeSide, computePareto, minOmfOf } from '../../synthesisShared/synthesisHelpers.js';
import { getSynthesisInnerEngine } from '../../../../../utils/synthesis/synthesisConfig.js';
import { deepCopy, mtFinalize } from './mainThreadCore.js';
import { mtStartCandidate, mtScanStep } from './mainThreadScan.js';

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
    if (!dls) { ctx.dlsRef.current = null; ctx.timerRef.current = setTimeout(run.tick, 0); return; }

    dls.step();
    ctx.setMf(dls.mf);
    ctx.setOmf(dls.mfOpticalAt(dls.thicknesses));
    ctx.setLayerCount(dls.thicknesses.length);

    const converged = dls.isConverged() || dls.iter >= ctx.dlsIterRef.current;
    if (!converged) { ctx.timerRef.current = setTimeout(run.tick, 0); return; }

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
    ctx.timerRef.current = setTimeout(run.tick, 0);
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
        tick: null,
    };
    run.tick = () => mtTick(run);
    ctx.timerRef.current = setTimeout(run.tick, 0);
}
