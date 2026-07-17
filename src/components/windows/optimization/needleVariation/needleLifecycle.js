/**
 * Needle Variation design-switch lifecycle: stop any running optimization for
 * the previous design, then restore or clear the per-session cache for the
 * newly active one.
 */

import { sideKeyFor, minOmfOf, computePareto } from '../synthesisShared/synthesisHelpers.js';
import { getCachedOptState } from './needleCache.js';

// Stop the run loop, clear its timer, and terminate any live worker pool.
export function teardownRun({ runningRef, timerRef, workerRef }) {
    runningRef.current = false;
    clearTimeout(timerRef.current);
    if (workerRef.current) {
        try { workerRef.current.terminate(); } catch (_) {}
        workerRef.current = null;
    }
}

// Stop a running optimization only on an actual design switch (prevId set and
// different from newId) — not on initial mount, where prevId is still null.
function stopIfDesignChanged(ctx, prevId, newId) {
    if (!prevId || prevId === newId) return;
    teardownRun(ctx);
    ctx.setPhase('idle');
    ctx.setStatusMsg('');
}

// Restore generations/topDesigns/metrics from the per-session cache for the
// newly active design.
function applyCachedState(ctx, cached) {
    const gens     = cached.generations;
    const lastGen  = gens[gens.length - 1];
    const bestMF   = gens.length ? Math.min(...gens.map(g => g.mf)) : null;
    const bestOMFv = minOmfOf(gens);
    ctx.gensRef.current        = gens;
    ctx.genCountRef.current    = lastGen?.genNum ?? 0;
    ctx.lastBestRef.current    = null;
    ctx.savedDesignRef.current = cached.savedDesign;
    ctx.baseDesignRef.current  = cached.baseDesign;
    ctx.setGenerations(gens.slice());
    ctx.setTopDesigns(computePareto(gens));
    ctx.setMf(lastGen?.mf ?? null);
    ctx.setMfBest(bestMF);
    ctx.setOmf(lastGen?.omf ?? null);
    ctx.setOmfBest(bestOMFv);
    ctx.setGeneration(lastGen?.genNum ?? 0);
    ctx.setLayerCount(lastGen?.layerCount ?? 0);
    ctx.setCanReset(!!cached.savedDesign);
}

// Clear all optimization display/refs state for a design with no cached run.
function clearOptState(ctx, design) {
    ctx.gensRef.current        = [];
    ctx.genCountRef.current    = 0;
    ctx.lastBestRef.current    = null;
    ctx.savedDesignRef.current = null;
    ctx.baseDesignRef.current  = null;
    ctx.setGenerations([]);
    ctx.setTopDesigns([]);
    ctx.setMf(null);
    ctx.setMfBest(null);
    ctx.setOmf(null);
    ctx.setOmfBest(null);
    ctx.setGeneration(0);
    ctx.setLayerCount((design?.[sideKeyFor(design)] || []).length);
    ctx.setCanReset(false);
}

// Restore/clear cached optimization state when the active design changes, and
// stop any running optimization from the previous design. Runs on every
// design?.id change (including initial mount, where the stop-block is a no-op).
export function syncOnDesignSwitch(ctx, design, getDesignRevision) {
    const prevId = ctx.lastDesignId.current;
    const newId  = design?.id ?? null;
    ctx.lastDesignId.current = newId;

    stopIfDesignChanged(ctx, prevId, newId);

    const cached = getCachedOptState(newId);
    if (cached) applyCachedState(ctx, cached);
    else clearOptState(ctx, design);

    // Sync the M12 edit-revision baseline to the design we just switched to,
    // so switching designs doesn't read as a "manual edit" on the next Run.
    ctx.baseRevRef.current = getDesignRevision?.(newId) ?? 0;
}
