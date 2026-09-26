// Shared low-level helpers for the main-thread Gradual-Evolution engine
// (mainThread.js + its phase modules): tick scheduling, ctx/S bookkeeping,
// cycle recording, and run finalization. See mainThread.js for the engine
// overview.

import { PRESERVE_BULK_GENTLE_ITER } from '../../../../../utils/synthesis/synthesisConfig.js';
import { minOmfOf, regridForDesign, meritOf } from '../../synthesisShared/synthesisHelpers.js';
import { activeRunNum } from '../../synthesisShared/runBlocks.js';
import { setCached } from '../sessionState.js';

// Per-step inner-refine cap when seed mode = 'preserve-bulk' (see synthesisConfig).
export const gentleIter = (ctx) => Math.min(ctx.dlsIterRef.current, PRESERVE_BULK_GENTLE_ITER);
export const scheduleTick = (ctx, S) => { ctx.timerRef.current = setTimeout(S.tick, 0); };
export const deepActive = (S, d) => JSON.parse(JSON.stringify(d[S.LK] || []));

// When the work design has outgrown the run's sampling grid (runGrid.js), move
// the run onto a grid for it and re-score `work` and `best` on that grid.
export function regridIfGrown(S, design, resolveMat) {
    const operands = regridForDesign(S.operands, design, resolveMat);
    if (!operands) return;
    S.operands = operands;
    S.work.mf = meritOf(operands, design, resolveMat);
    if (S.best.front) S.best.mf = meritOf(operands, { ...design, [S.LK]: S.best.front }, resolveMat);
    S.foldRowId = null;             // earlier rows keep the merit of the old grid
    console.log(`[GE] Grid re-sampled for the grown design: workMF=${S.work.mf.toFixed(6)} bestMF=${S.best.mf.toFixed(6)}`);
}

// Write `front` into both the base-design ref and the live (transient) design.
export function setBase(ctx, S, front) {
    ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || {}), [S.LK]: JSON.parse(JSON.stringify(front)) };
    ctx.updateDesignRef.current({ [S.LK]: JSON.parse(JSON.stringify(front)) }, { transient: true });
}

// Show the history in the window and keep it in the design's run cache.
function publishCycles(ctx, S, { layerCount, omf }) {
    ctx.setCycles(ctx.cyclesRef.current.slice());
    ctx.setLayerCount(layerCount);
    ctx.setMfBest(Math.min(S.best.mf, ...ctx.cyclesRef.current.map(c => c.mf)));
    if (omf != null) ctx.setOmf(omf);
    ctx.setOmfBest(minOmfOf(ctx.cyclesRef.current));
    setCached(ctx.designRef.current?.id, {
        cycles: ctx.cyclesRef.current, geSteps: ctx.geStepsRef.current,
        runs: ctx.runsRef.current,
        savedDesign: ctx.savedDesignRef.current, baseDesign: ctx.baseDesignRef.current,
        baseRev: ctx.baseRevRef?.current,
    });
}

export function recordCycle(ctx, S, { type, mf, layerCount, insertMat, omf }) {
    ctx.genCountRef.current += 1;
    const genNum = ctx.genCountRef.current;
    const prevBest = ctx.cyclesRef.current.length ? Math.min(...ctx.cyclesRef.current.map(c => c.mf)) : Infinity;
    const id = Math.random().toString(36).slice(2);
    ctx.cyclesRef.current = [...ctx.cyclesRef.current, {
        id,
        genNum, type, mf, omf,
        runNum: activeRunNum(ctx.runsRef.current),
        dMF: prevBest === Infinity ? null : mf - prevBest,
        layerCount, insertMat,
        tMs: performance.now() - S.runT0,
        layers: JSON.parse(JSON.stringify(ctx.baseDesignRef.current[S.LK] || [])),
    }];
    ctx.setGeneration(genNum);
    // A refine step may fold only into a Needle or Refine row this run
    // recorded (recordRefine).
    S.foldRowId = (type === 'needle' || type === 'refine') ? id : null;
    publishCycles(ctx, S, { layerCount, omf });
}

// An accepted step whose needle merged into a neighbour only changed the
// thicknesses of the existing layers, and is not a Needle row. As in the
// worker path (workerPoolCore.js, recordRefine): it folds into the last row
// when that is the Needle or Refine row this engine run recorded just before
// it on the current wavelength grid, is a Refine row when it is a new best,
// and leaves no row otherwise.
export function recordRefine(ctx, S, { mf, layerCount, omf, newBest }) {
    const cycles = ctx.cyclesRef.current;
    const last = cycles[cycles.length - 1];
    if (!last || last.id !== S.foldRowId) {
        if (newBest) recordCycle(ctx, S, { type: 'refine', mf, layerCount, insertMat: null, omf });
        return;
    }
    ctx.cyclesRef.current = [...cycles.slice(0, -1), {
        ...last, mf, omf,
        dMF: last.dMF == null ? null : last.dMF + (mf - last.mf),
        tMs: performance.now() - S.runT0,
        layers: JSON.parse(JSON.stringify(ctx.baseDesignRef.current[S.LK] || [])),
    }];
    publishCycles(ctx, S, { layerCount: last.layerCount, omf });
}

// Restore the global best design and finish.
export function finalize(ctx, S, msg) {
    if (S.best.front) {
        ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || {}), [S.LK]: JSON.parse(JSON.stringify(S.best.front)) };
        ctx.updateDesignRef.current({ [S.LK]: JSON.parse(JSON.stringify(S.best.front)) }, { transient: true });
        ctx.setMfBest(S.best.mf);
        ctx.setLayerCount(S.best.front.length);
    }
    ctx.runningRef.current = false;
    // The engine stopped on its own, so this run block is finished and the next
    // Run press opens a new one; a user Stop leaves it open (runBlocks.js).
    ctx.runOpenRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(msg);
}
