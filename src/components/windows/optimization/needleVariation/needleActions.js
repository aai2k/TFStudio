/**
 * Needle Variation user actions: Reset (full or per-side), jump to the best
 * generation seen, and restore an arbitrary generation from history.
 */

import { sideKeyFor, minOmfOf, computePareto } from '../synthesisShared/synthesisHelpers.js';
import { activeBaseline, undoRunBlock } from '../synthesisShared/runBlocks.js';
import { clearCachedOptState, setCachedOptState } from './sessionState.js';

// Push the current generations + run blocks into the per-design cache so they
// survive a dock, a tab switch or a reopen.
function cacheRun(ctx) {
    setCachedOptState(ctx.designRef.current?.id, {
        generations: ctx.gensRef.current,
        runs:        ctx.runsRef.current,
        savedDesign: ctx.savedDesignRef.current,
        baseDesign:  ctx.baseDesignRef.current,
    });
}

// Push the display state that follows from the current generation list.
function syncFromGens(ctx) {
    const gens = ctx.gensRef.current;
    ctx.setGenerations(gens.slice());
    ctx.setTopDesigns(computePareto(gens));
    ctx.setMfBest(gens.length ? Math.min(...gens.map(g => g.mf)) : null);
    ctx.setOmfBest(minOmfOf(gens));
}

// Undo the newest Run press: restore the design it started from, drop its rows,
// and hand the previous block back to Reset. Earlier runs keep their rows, so
// pressing Reset again steps back one more run.
function undoCurrentRun(ctx, updateDesign, undone) {
    ctx.runsRef.current = undone.runs;
    ctx.gensRef.current = undone.gens;
    updateDesign({
        frontLayers: undone.baseline.frontLayers,
        backLayers:  undone.baseline.backLayers,
    });
    const prev = activeBaseline(ctx.runsRef.current);
    ctx.savedDesignRef.current = prev;
    ctx.baseDesignRef.current  = null;
    ctx.runOpenRef.current     = false;
    ctx.lastBestRef.current    = null;
    const last = ctx.gensRef.current[ctx.gensRef.current.length - 1] || null;
    ctx.genCountRef.current = last?.genNum ?? 0;
    syncFromGens(ctx);
    ctx.setMf(last?.mf ?? null);
    ctx.setOmf(last?.omf ?? null);
    ctx.setGeneration(last?.genNum ?? 0);
    ctx.setLayerCount(last?.layerCount
        ?? (undone.baseline.frontLayers.length + undone.baseline.backLayers.length));
    ctx.setCanReset(!!prev);
    ctx.setStatusMsg(ctx.t.needle.runSeparator(undone.runNum) + ' ✕');
    if (ctx.runsRef.current.length) cacheRun(ctx); else clearCachedOptState(ctx.designRef.current?.id);
}

// Clear history: forget every run block and every row, and leave the design
// exactly where it is. This is how a synthesis result is kept and the timeline
// started over from it.
export function clearRunHistory(ctx) {
    ctx.stopOpt('');
    ctx.dlsRef.current         = null;
    clearCachedOptState(ctx.designRef.current?.id);
    ctx.runsRef.current        = [];
    ctx.gensRef.current        = [];
    ctx.runOpenRef.current     = false;
    ctx.savedDesignRef.current = null;
    ctx.baseDesignRef.current  = null;
    ctx.genCountRef.current    = 0;
    ctx.lastBestRef.current    = null;
    syncFromGens(ctx);
    ctx.setMf(null);
    ctx.setOmf(null);
    ctx.setGeneration(0);
    ctx.setLayerCount((ctx.designRef.current?.[sideKeyFor(ctx.designRef.current)] || []).length);
    ctx.setCanReset(false);
    ctx.setStatusMsg('');
}

// Per-side reset: restore one side from the current run's baseline and drop that
// side's generations, keeping the other side's timeline and the block itself so
// subsequent runs continue against the unreset side (both_independent only).
function resetSide(ctx, updateDesign, side) {
    const baseline = activeBaseline(ctx.runsRef.current);
    if (baseline) {
        updateDesign(side === 'front'
            ? { frontLayers: baseline.frontLayers }
            : { backLayers:  baseline.backLayers });
    }
    ctx.gensRef.current = ctx.gensRef.current.filter(g => g.side !== side);
    syncFromGens(ctx);
    ctx.setStatusMsg(`${side === 'front' ? 'Front' : 'Back'} side reset`);
    cacheRun(ctx);
}

// Reset undoes ONE Run press. Without a `side` it restores the design that press
// started from and drops that press's rows, leaving every earlier run intact; a
// side ('front'|'back') restores only that side of the current run's baseline
// and drops that side's rows (both_independent).
export function performReset(ctx, updateDesign, side) {
    ctx.stopOpt('');
    ctx.dlsRef.current = null;
    if (side) { resetSide(ctx, updateDesign, side); return; }
    const undone = undoRunBlock(ctx.runsRef.current, ctx.gensRef.current);
    if (undone) undoCurrentRun(ctx, updateDesign, undone);
}

export function findBestGeneration(gens) {
    if (!gens.length) return null;
    return gens.reduce((a, b) => (a.mf <= b.mf ? a : b));
}

// Apply a generation's snapshot to the design. New generations carry the full
// both-side snapshot (frontSnap + backSnap); legacy ones only had the
// active-side `layers` — for those we write to the surface-mode-active side
// and leave the other side untouched.
function applyGenSnapshot(ctx, updateDesign, gen) {
    const patch = {};
    if (gen.frontSnap || gen.backSnap) {
        if (gen.frontSnap) patch.frontLayers = JSON.parse(JSON.stringify(gen.frontSnap));
        if (gen.backSnap)  patch.backLayers  = JSON.parse(JSON.stringify(gen.backSnap));
    } else {
        const LK = gen.side === 'back' ? 'backLayers' : sideKeyFor(ctx.designRef.current);
        patch[LK] = JSON.parse(JSON.stringify(gen.layers || []));
    }
    updateDesign(patch);
    ctx.baseDesignRef.current = { ...(ctx.baseDesignRef.current || ctx.designRef.current), ...patch };
}

// Jump the display state + design to a specific generation (used by both the
// history table's Restore action and the "Best" button).
export function jumpToGeneration(ctx, updateDesign, gen) {
    applyGenSnapshot(ctx, updateDesign, gen);
    ctx.setMf(gen.mf);
    ctx.setOmf(gen.omf ?? null);
    ctx.setLayerCount(gen.layerCount);
    ctx.setGeneration(gen.genNum);
}
