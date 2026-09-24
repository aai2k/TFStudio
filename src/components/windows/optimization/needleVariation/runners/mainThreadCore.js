/**
 * Shared low-level helpers for the Needle main-thread engine (see mainThread.js
 * and mainThreadScan.js): reverting the live design to the best-so-far, and
 * finalizing a run by restoring the best design and stopping.
 */

import { materialLookup, regridForDesign, meritOf } from '../../synthesisShared/synthesisHelpers.js';

export const deepCopy = (x) => JSON.parse(JSON.stringify(x));

// When the design about to be scanned has outgrown the run's sampling grid
// (runGrid.js), move the run onto a grid for it and re-score `best` on it.
export function mtRegridIfGrown(run) {
    const design = run.ctx.baseDesignRef.current;
    const resolveMat = materialLookup(design);
    const operands = regridForDesign(run.operands, design, resolveMat);
    if (!operands) return;
    run.operands = operands;
    if (run.best.front) run.best.mf = meritOf(operands, { ...design, [run.LK]: run.best.front }, resolveMat);
    console.log(`[Needle] Grid re-sampled for the grown design: bestMF=${run.best.mf.toFixed(6)}`);
}

// Restore the active-side layers of the running design to the best-so-far.
// transient: a live synthesis preview, not a user commit — no undo entry per
// rejected candidate, and it does not bump the M12 user-edit revision mid-run.
export function mtRevertToBest(run) {
    const { ctx, LK, best } = run;
    ctx.baseDesignRef.current = { ...ctx.baseDesignRef.current, [LK]: deepCopy(best.front) };
    ctx.updateDesignRef.current({ [LK]: deepCopy(best.front) }, { transient: true });
}

// Restore the best design, publish it, and stop the run with a status message.
export function mtFinalize(run, msg) {
    const { ctx, LK, best } = run;
    if (best.front) {
        ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || {}), [LK]: deepCopy(best.front) };
        ctx.updateDesignRef.current({ [LK]: deepCopy(best.front) }, { transient: true });
        ctx.setMf(best.mf);
        ctx.setMfBest(best.mf);
        if (best.omf != null) ctx.setOmf(best.omf);
        ctx.setLayerCount(best.front.length);
    }
    ctx.setCachedOptState?.(ctx.designRef.current?.id, {
        generations: ctx.gensRef.current,
        runs:        ctx.runsRef.current,
        savedDesign: ctx.savedDesignRef.current,
        baseDesign:  ctx.baseDesignRef.current,
    });
    ctx.runningRef.current = false;
    ctx.runOpenRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(msg);
}
