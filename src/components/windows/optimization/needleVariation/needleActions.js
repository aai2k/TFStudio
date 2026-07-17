/**
 * Needle Variation user actions: Reset (full or per-side), jump to the best
 * generation seen, and restore an arbitrary generation from history.
 */

import { sideKeyFor, minOmfOf, computePareto } from '../synthesisShared/synthesisHelpers.js';
import { clearCachedOptState, setCachedOptState } from './needleCache.js';

function restoreSavedSnapshot(ctx, updateDesign, side) {
    if (!ctx.savedDesignRef.current) return;
    const patch = {};
    if (!side || side === 'front') patch.frontLayers = ctx.savedDesignRef.current.frontLayers;
    if (!side || side === 'back')  patch.backLayers  = ctx.savedDesignRef.current.backLayers;
    updateDesign(patch);
}

// Full reset: clear cache, history, and all in-memory state.
function resetAll(ctx) {
    clearCachedOptState(ctx.designRef.current?.id);
    ctx.savedDesignRef.current = null;
    ctx.baseDesignRef.current  = null;
    ctx.gensRef.current        = [];
    ctx.genCountRef.current    = 0;
    ctx.lastBestRef.current    = null;
    ctx.setGenerations([]);
    ctx.setTopDesigns([]);
    ctx.setMf(null);
    ctx.setMfBest(null);
    ctx.setOmf(null);
    ctx.setOmfBest(null);
    ctx.setGeneration(0);
    ctx.setLayerCount((ctx.designRef.current?.[sideKeyFor(ctx.designRef.current)] || []).length);
    ctx.setCanReset(false);
    ctx.setStatusMsg('');
}

// Per-side reset: drop this side's generations, keep the other (and keep the
// saved snapshot + baseDesign so subsequent runs can continue against the
// unreset side).
function resetSide(ctx, side) {
    ctx.gensRef.current = ctx.gensRef.current.filter(g => g.side !== side);
    ctx.setGenerations(ctx.gensRef.current.slice());
    ctx.setTopDesigns(computePareto(ctx.gensRef.current));
    const remainBest = ctx.gensRef.current.length
        ? Math.min(...ctx.gensRef.current.map(g => g.mf)) : null;
    ctx.setMfBest(remainBest);
    ctx.setOmfBest(minOmfOf(ctx.gensRef.current));
    ctx.setStatusMsg(`${side === 'front' ? 'Front' : 'Back'} side reset`);
    setCachedOptState(ctx.designRef.current?.id, {
        generations: ctx.gensRef.current,
        savedDesign: ctx.savedDesignRef.current,
        baseDesign:  ctx.baseDesignRef.current,
    });
}

// Reset the running optimization. No `side` wipes everything (full restore +
// clear history); a side ('front'|'back') restores only that side and drops
// its generations, leaving the other side's timeline alone (both_independent).
export function performReset(ctx, updateDesign, side) {
    ctx.stopOpt('');
    ctx.dlsRef.current = null;
    restoreSavedSnapshot(ctx, updateDesign, side);
    if (!side) resetAll(ctx); else resetSide(ctx, side);
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
