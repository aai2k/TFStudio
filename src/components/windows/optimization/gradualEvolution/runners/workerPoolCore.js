// Shared low-level helpers for the worker-pool Gradual-Evolution engine
// (workerPool.js + its phase modules): design snapshotting, liveness checks,
// live-preview throttling, cycle recording, and the main-thread fallback
// trigger. See workerPool.js for the engine overview.

import {
    minOmfOf, materialLookup, regridForDesign, meritOf, presampleSynthesisMaterials,
} from '../../synthesisShared/synthesisHelpers.js';
import { activeRunNum } from '../../synthesisShared/runBlocks.js';
import { setCached } from '../sessionState.js';
import { runGeMainThread } from './mainThread.js';

export const deep = x => JSON.parse(JSON.stringify(x));
export const mkLayers = arr => (arr || []).map(l => ({
    id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));

// Build a full design from the given both-side layer state. In both_independent
// each cycle re-snaps both sides from `best` so both evolve through the run.
export const designSnap = (S, front, back) => ({ ...S.media, frontLayers: mkLayers(front), backLayers: mkLayers(back) });

// The run is live only while this exact pool is the window's current pool.
export const alive = (ctx, S) => ctx.runningRef.current && ctx.workerRef.current === S.workerPool;

// When `work` has outgrown the run's sampling grid (runGrid.js), move the run
// onto a grid for it: new operands, material tables sampled on them, and
// `work`, `best` and the ΔMF baseline re-scored so the next comparisons are
// made on one grid.
export function regridIfGrown(S) {
    const resolveMat = materialLookup(S.curDes);
    const work = designSnap(S, S.work.frontLayers, S.work.backLayers);
    const operands = regridForDesign(S.operands, work, resolveMat);
    if (!operands) return;
    S.operands = operands;
    S.materials = presampleSynthesisMaterials(S.curDes, operands, S.pool);
    S.work.mf = meritOf(operands, work, resolveMat);
    if (S.best.frontLayers || S.best.backLayers) {
        S.best.mf = meritOf(operands, designSnap(S, S.best.frontLayers, S.best.backLayers), resolveMat);
    }
    S.prevBestMF = Math.min(S.work.mf, S.best.mf);
    S.foldRowId = null;             // earlier rows keep the merit of the old grid
    console.log(`[GE] Grid re-sampled for the grown design: workMF=${S.work.mf.toFixed(6)} bestMF=${S.best.mf.toFixed(6)}`);
}

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

// The fields of a history row that describe `work` as it stands: merit, elapsed
// time and snapshots, and the total physical thickness (nm) of the whole
// design, the "TOT" column (cf. OTF needle history): the thick seed holds the
// bulk budget and needles redistribute it, so TOT should stay roughly flat
// (≈ seed), not balloon. A runaway TOT signals over-forcing.
function workRowFields(S, { mf, omf, activeLayers }) {
    const fSnap = deep(S.work.frontLayers);
    const bSnap = deep(S.work.backLayers);
    const sumD = arr => (arr || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);
    return {
        mf, omf, tot: sumD(fSnap) + sumD(bSnap),
        tMs: performance.now() - S.runT0,
        layers:    deep(activeLayers),                 // active-side snapshot
        frontSnap: fSnap,
        backSnap:  bSnap,
    };
}

// Show the history in the window and keep it in the design's run cache.
function publishCycles(ctx, S, { layerCount, omf }) {
    ctx.setCycles(ctx.cyclesRef.current.slice());
    ctx.setLayerCount(layerCount);
    ctx.setMfBest(Math.min(S.best.mf, S.prevBestMF));
    if (omf != null) ctx.setOmf(omf);
    ctx.setOmfBest(minOmfOf(ctx.cyclesRef.current));
    setCached(ctx.designRef.current?.id, {
        cycles: ctx.cyclesRef.current, geSteps: S.geSteps,
        runs: ctx.runsRef.current,
        savedDesign: ctx.savedDesignRef.current, baseDesign: ctx.baseDesignRef.current,
        baseRev: ctx.baseRevRef?.current,
    });
}

export function recordCycle(ctx, S, { type, mf, layerCount, insertMat, side, activeLayers, omf }) {
    S.genNum += 1;
    const dMF = S.prevBestMF === Infinity ? null : mf - S.prevBestMF;
    S.prevBestMF = Math.min(S.prevBestMF, mf);
    const cy = {
        id: Math.random().toString(36).slice(2),
        genNum: S.genNum, type, dMF, layerCount, insertMat, side,
        runNum: activeRunNum(ctx.runsRef.current),
        ...workRowFields(S, { mf, omf, activeLayers }),
    };
    ctx.cyclesRef.current   = [...ctx.cyclesRef.current, cy];
    ctx.genCountRef.current = S.genNum;
    ctx.setGeneration(S.genNum);
    // A refine step may fold only into a Needle or Refine row this run
    // recorded (recordRefine).
    S.foldRowId = (type === 'needle' || type === 'refine') ? cy.id : null;
    publishCycles(ctx, S, { layerCount, omf });
}

// An accepted step that only changed the thicknesses of the existing layers
// (its needle merged into a neighbour of the same material) is not a Needle
// row. It folds into the last row when that is the Needle or Refine row this
// engine run (since the last Run press or resume) recorded just before it, on
// the current wavelength grid: the row then shows its design refined further.
// Otherwise it is a Refine row when it is a new best, so the lowest merit
// reached is always a row the window can restore, and no row when it is not.
// A GE row keeps the design the forced step made.
export function recordRefine(ctx, S, { mf, layerCount, side, activeLayers, omf, newBest }) {
    const cycles = ctx.cyclesRef.current;
    const last = cycles[cycles.length - 1];
    if (!last || last.id !== S.foldRowId) {
        if (newBest) recordCycle(ctx, S, { type: 'refine', mf, layerCount, insertMat: null, side, activeLayers, omf });
        return;
    }
    S.prevBestMF = Math.min(S.prevBestMF, mf);
    ctx.cyclesRef.current = [...cycles.slice(0, -1), {
        ...last,
        dMF: last.dMF == null ? null : last.dMF + (mf - last.mf),
        ...workRowFields(S, { mf, omf, activeLayers: last.side === 'back' ? S.work.backLayers : S.work.frontLayers }),
    }];
    publishCycles(ctx, S, { layerCount: last.layerCount, omf });
}

export function fallback(ctx, S, why, err) {
    console.error(`[GE] Pool ${why}, main-thread fallback:`, err);
    window.electronAPI?.diagLog?.(`GE pool ${why} → main-thread fallback: ${err?.message || err}`);
    try { S.workerPool.terminate(); } catch (_) {}
    if (ctx.workerRef.current === S.workerPool) ctx.workerRef.current = null;
    ctx.runningRef.current = false;
    runGeMainThread(ctx);
}
