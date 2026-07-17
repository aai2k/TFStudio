/**
 * Needle worker-POOL engine — pool lifecycle: live-preview ticks, the
 * "do we still own the pool" guard, finalize/teardown, and the fallback to
 * the main-thread engine on pre-progress failure (see workerPool.js for the
 * top-level orchestrator).
 */

import { runNeedleMainThread } from './mainThread.js';

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
    const { ctx, best } = run;
    if (ctx.workerRef.current !== run.workerPool) return;
    if (best.frontLayers || best.backLayers) {
        const patch = {};
        if (best.frontLayers) patch.frontLayers = best.frontLayers;
        if (best.backLayers)  patch.backLayers  = best.backLayers;
        ctx.updateDesignRef.current(patch, { transient: true });
        ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
        ctx.setMfBest(best.mf);
        // Display layer count of whichever side was most recently active; for
        // both_independent show the total across both sides.
        ctx.setLayerCount((best.frontLayers ? best.frontLayers.length : 0) +
                          (best.backLayers  ? best.backLayers.length  : 0));
    }
    ctx.setCachedOptState(ctx.designRef.current?.id, {
        generations: ctx.gensRef.current,
        savedDesign: ctx.savedDesignRef.current,
        baseDesign:  ctx.baseDesignRef.current,
    });
    ctx.runningRef.current = false;
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
