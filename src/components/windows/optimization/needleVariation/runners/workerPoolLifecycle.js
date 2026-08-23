/**
 * Needle worker-POOL engine — pool lifecycle: live-preview ticks, the
 * "do we still own the pool" guard, finalize/teardown, and the fallback to
 * the main-thread engine on pre-progress failure (see workerPool.js for the
 * top-level orchestrator).
 */

import { runNeedleMainThread } from './mainThread.js';
import { computePareto, minOmfOf } from '../../synthesisShared/synthesisHelpers.js';
import { activeRunNum } from '../../synthesisShared/runBlocks.js';

const sameLayers = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
const totalOf = layers => (layers || []).reduce(
    (sum, layer) => sum + (Number(layer.thickness) || 0), 0);

// Smart seeds and the pre-rescue design are valid final winners even when no
// accepted needle generation represents them. Publish such a winner as the
// closing row of this run so History, Top Designs and Best all point at the
// same snapshot the editor receives.
function ensureFinalWinnerRecorded(run, best, rescuedReturn) {
    const { ctx } = run;
    const runNum = activeRunNum(ctx.runsRef.current);
    const frontSnap = run.deep(best.frontLayers || []);
    const backSnap = run.deep(best.backLayers || []);
    const represented = ctx.gensRef.current.some(g =>
        g.runNum === runNum && Math.abs(g.mf - best.mf) < 1e-12 &&
        sameLayers(g.frontSnap, frontSnap) && sameLayers(g.backSnap, backSnap));
    if (represented) return;

    run.genNum += 1;
    const side = run.scanSides?.[0] || 'front';
    const activeLayers = side === 'back' ? backSnap : frontSnap;
    const dMF = run.prevBestMF === Infinity ? null : best.mf - run.prevBestMF;
    run.prevBestMF = Math.min(run.prevBestMF, best.mf);
    const gen = {
        id: Math.random().toString(36).slice(2),
        genNum: run.genNum,
        runNum,
        mf: best.mf,
        omf: best.omf ?? null,
        dMF,
        rescued: rescuedReturn || undefined,
        final: true,
        side,
        layerCount: activeLayers.length,
        tot: totalOf(frontSnap) + totalOf(backSnap),
        tMs: performance.now() - run.runT0,
        insertMat: null,
        layers: run.deep(activeLayers),
        frontSnap,
        backSnap,
    };
    ctx.gensRef.current = [...ctx.gensRef.current, gen];
    ctx.genCountRef.current = run.genNum;
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    ctx.setGeneration(run.genNum);
}

// Live-preview throttle: apply the worker's in-flight design tick (~≤90 ms).
export function wpOnTick(run, _i, m) {
    if (m.type !== 'tick') return;
    const t = Date.now();
    if (t - run.lastTick < 90) return;
    run.lastTick = t;
    const { ctx } = run;
    if (m.mf != null) ctx.setMf(m.mf);
    if (m.omf != null) ctx.setOmf(m.omf);
    // both_independent live preview applies both sides; other modes have one.
    const patch = {};
    if (m.frontLayers) patch.frontLayers = m.frontLayers;
    if (m.backLayers)  patch.backLayers  = m.backLayers;
    if (Object.keys(patch).length) {
        ctx.updateDesignRef.current(patch, { transient: true });
        if (m.layers) ctx.setLayerCount(m.layers.length);
    }
}

// True while this run still owns the pool (a Stop swaps workerRef → the run is
// stale and must unwind without publishing).
export const wpAlive = (run) => run.ctx.runningRef.current && run.ctx.workerRef.current === run.workerPool;

// Restore the best design, publish it, cache for tab-switch survival, and stop
// the run with a status message. No-op if the run no longer owns the pool.
export function wpFinalize(run, reason) {
    const { ctx } = run;
    if (ctx.workerRef.current !== run.workerPool) return;
    // A thin-start rescue continues from a thicker design even when that design
    // starts out worse (workerPoolRescue.js), so the run publishes whichever of
    // the two ended lower.
    const pre = run.preRescueBest;
    const rescuedReturn = !!(pre && pre.mf < run.best.mf);
    const best = rescuedReturn ? pre : run.best;
    if (best.frontLayers || best.backLayers) {
        ensureFinalWinnerRecorded(run, best, rescuedReturn);
        const patch = {};
        if (best.frontLayers) patch.frontLayers = best.frontLayers;
        if (best.backLayers)  patch.backLayers  = best.backLayers;
        ctx.updateDesignRef.current(patch, { transient: true });
        ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
        ctx.setMf(best.mf);
        ctx.setOmf(best.omf ?? null);
        ctx.setMfBest(Math.min(...ctx.gensRef.current.map(g => g.mf)));
        ctx.setOmfBest(minOmfOf(ctx.gensRef.current));
        // Display layer count of whichever side was most recently active; for
        // both_independent show the total across both sides.
        const bothIndependent = (run.curDes?.surfaceMode || 'front_only') === 'both_independent';
        const activeSide = run.scanSides?.[0] || 'front';
        ctx.setLayerCount(bothIndependent
            ? (best.frontLayers?.length || 0) + (best.backLayers?.length || 0)
            : (activeSide === 'back' ? best.backLayers?.length : best.frontLayers?.length) || 0);
    }
    ctx.setCachedOptState(ctx.designRef.current?.id, {
        generations: ctx.gensRef.current,
        runs:        ctx.runsRef.current,
        savedDesign: ctx.savedDesignRef.current,
        baseDesign:  ctx.baseDesignRef.current,
    });
    ctx.runningRef.current = false;
    // The engine stopped on its own, so this run block is finished: the next Run
    // press opens a new one. A user Stop leaves it open, so Run carries on in the
    // same block (synthesisShared/runBlocks.js).
    ctx.runOpenRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(reason || '');
    ctx.setCanReset(true);
    try { run.workerPool.terminate(); } catch (_) {}
    if (ctx.workerRef.current === run.workerPool) ctx.workerRef.current = null;
}

// Tear down the pool and hand off to the identical-math main-thread loop.
export function wpFallback(run, why, err) {
    const { ctx } = run;
    console.error(`[Needle] Pool ${why}, main-thread fallback:`, err);
    try { run.workerPool.terminate(); } catch (_) {}
    if (ctx.workerRef.current === run.workerPool) ctx.workerRef.current = null;
    ctx.runningRef.current = false;
    runNeedleMainThread(ctx);
}

// Expected teardown vs a real error: a Stop rejects the in-flight job with
// 'pool terminated' (clean stop, stopOpt already ran) → bail silently.
export function wpHandleLoopError(run, err) {
    if (!wpAlive(run) || String(err && err.message) === 'pool terminated') return;
    if (!run.gotProgress) { wpFallback(run, 'errored before progress', err); return; }
    console.error('[Needle] Pool error:', err);
    run.ctx.stopOpt(String(err && err.message || err));
}
