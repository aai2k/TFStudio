// Shared low-level helpers for the worker-pool Gradual-Evolution engine
// (workerPool.js + its phase modules): design snapshotting, liveness checks,
// live-preview throttling, cycle recording, and the main-thread fallback
// trigger. See workerPool.js for the engine overview.

import { minOmfOf } from '../../synthesisShared/synthesisHelpers.js';
import { setCached } from '../geCache.js';
import { runGeMainThread } from './mainThread.js';

export const deep = x => JSON.parse(JSON.stringify(x));
export const mkLayers = arr => (arr || []).map(l => ({
    id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));

// Build a full design from the given both-side layer state. In both_independent
// each cycle re-snaps both sides from `best` so both evolve through the run.
export const designSnap = (S, front, back) => ({ ...S.media, frontLayers: mkLayers(front), backLayers: mkLayers(back) });

// The run is live only while this exact pool is the window's current pool.
export const alive = (ctx, S) => ctx.runningRef.current && ctx.workerRef.current === S.workerPool;

// Throttled live-preview push of an in-worker tick (mf / omf / layers).
export function onTick(ctx, S, _i, m) {
    if (!m || m.type !== 'tick') return;
    const now = Date.now();
    if (now - S.lastTick < 90) return;
    S.lastTick = now;
    if (m.mf != null) ctx.setMf(m.mf);
    if (m.omf != null) ctx.setOmf(m.omf);
    const patch = {};
    if (m.frontLayers) patch.frontLayers = m.frontLayers;
    if (m.backLayers)  patch.backLayers  = m.backLayers;
    if (Object.keys(patch).length) {
        ctx.updateDesignRef.current(patch, { transient: true });
        if (m.layers) ctx.setLayerCount(m.layers.length);
    }
}

export function applyDesignPatch(ctx, S, frontLayers, backLayers) {
    const patch = {};
    if (frontLayers) patch.frontLayers = frontLayers;
    if (backLayers)  patch.backLayers  = backLayers;
    ctx.updateDesignRef.current(patch, { transient: true });
    ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
}

export function recordCycle(ctx, S, { type, mf, layerCount, insertMat, side, activeLayers, omf }) {
    S.genNum += 1;
    const dMF = S.prevBestMF === Infinity ? null : mf - S.prevBestMF;
    S.prevBestMF = Math.min(S.prevBestMF, mf);
    const fSnap = deep(S.work.frontLayers);
    const bSnap = deep(S.work.backLayers);
    // Total physical thickness (nm) of the whole design — the "TOT" column
    // (cf. OTF needle history): the thick seed holds the bulk budget and needles
    // redistribute it, so TOT should stay roughly flat (≈ seed), not balloon. A
    // runaway TOT signals over-forcing.
    const sumD = arr => (arr || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);
    const tot = sumD(fSnap) + sumD(bSnap);
    const cy = {
        id: Math.random().toString(36).slice(2),
        genNum: S.genNum, type, mf, omf, dMF, layerCount, insertMat, side, tot,
        tMs: performance.now() - S.runT0,
        layers:    deep(activeLayers),                 // active-side snapshot
        frontSnap: fSnap,
        backSnap:  bSnap,
    };
    ctx.cyclesRef.current   = [...ctx.cyclesRef.current, cy];
    ctx.genCountRef.current = S.genNum;
    ctx.setCycles(ctx.cyclesRef.current.slice());
    ctx.setGeneration(S.genNum);
    ctx.setLayerCount(layerCount);
    ctx.setMfBest(Math.min(S.best.mf, S.prevBestMF));
    if (omf != null) ctx.setOmf(omf);
    ctx.setOmfBest(minOmfOf(ctx.cyclesRef.current));
    setCached(ctx.designRef.current?.id, {
        cycles: ctx.cyclesRef.current, geSteps: S.geSteps,
        savedDesign: ctx.savedDesignRef.current, baseDesign: ctx.baseDesignRef.current,
    });
}

export function fallback(ctx, S, why, err) {
    console.error(`[GE] Pool ${why}, main-thread fallback:`, err);
    window.electronAPI?.diagLog?.(`GE pool ${why} → main-thread fallback: ${err?.message || err}`);
    try { S.workerPool.terminate(); } catch (_) {}
    if (ctx.workerRef.current === S.workerPool) ctx.workerRef.current = null;
    ctx.runningRef.current = false;
    runGeMainThread(ctx);
}
