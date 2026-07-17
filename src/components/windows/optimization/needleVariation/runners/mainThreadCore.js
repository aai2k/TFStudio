/**
 * Shared low-level helpers for the Needle main-thread engine (see mainThread.js
 * and mainThreadScan.js): reverting the live design to the best-so-far, and
 * finalizing a run by restoring the best design and stopping.
 */

export const deepCopy = (x) => JSON.parse(JSON.stringify(x));

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
        ctx.setMfBest(best.mf);
        ctx.setLayerCount(best.front.length);
    }
    ctx.runningRef.current = false;
    ctx.setPhase('idle');
    ctx.setStatusMsg(msg);
}
