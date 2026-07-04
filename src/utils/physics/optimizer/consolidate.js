/**
 * Merit-aware layer removal / consolidation.
 *
 * Macleod, Thin-Film Optical Filters 5th ed., "Automatic Design": the needle
 * method "introduces … thin layers as a necessary part of the process, and they
 * may remain at termination … [and] must then be processed to remove them."
 *
 * Plain `cleanupLayers` only drops layers BELOW dMin. When a min-thickness merit
 * term (MNT) is active the refiner PARKS redundant layers at ≈dMin instead of
 * collapsing them to zero, so `cleanupLayers` never fires and needle/GE leave a
 * bloated stack (e.g. a 23-layer result for a true 3-layer optimum). This pass
 * removes those parked-but-redundant layers by trying each deletion and keeping
 * it only when a RE-REFINE of the remainder does not worsen the merit.
 *
 * The function is engine-agnostic: the caller injects `refineFn`, so it works
 * with any makeEngine refiner (DLS/CG/…) on the main thread or inside a worker
 * without this module importing the engine layer (keeps the physics DAG acyclic).
 */

import { cleanupLayers } from './layerOps.js';

const sideKey = (side) => (side === 'back' ? 'backLayers' : 'frontLayers');
const deep = (x) => JSON.parse(JSON.stringify(x));

/**
 * Greedily remove redundant layers from one side of a design.
 *
 * Each round: trial-delete every non-locked layer on `side` (merging
 * same-material neighbours via cleanupLayers), RE-REFINE each remainder, and
 * keep the single deletion whose re-refined merit is lowest — accepting it only
 * if that merit does not exceed the running best by more than `tol` (relative).
 * The acceptance bar tracks the BEST merit seen (not the immediately-previous
 * one), so a chain of individually-neutral removals cannot drift the merit
 * upward without bound. Stops when no deletion is acceptable or `minLayers` is
 * reached.
 *
 * @param {Object}   opts
 * @param {Object}   opts.design     full design { frontLayers, backLayers, … }
 * @param {string}   [opts.side]     'front' | 'back'
 * @param {number}   [opts.dMin]     prune/merge floor passed to cleanupLayers
 * @param {number}   [opts.tol]      relative merit slack to still drop a layer
 *                                   (0 = strict non-worsening; 0.02 = allow +2%)
 * @param {number}   [opts.minLayers]stop once the side reaches this many layers
 * @param {number}   [opts.maxIter]  re-refine iteration cap per trial
 * @param {Function} opts.refineFn   (design, maxIter) → { mf, design, omf? };
 *                                   MUST return a design with thicknesses applied
 * @param {Function} [opts.onProgress] called with the current accepted state
 * @param {Function} [opts.alive]    () → bool; abort early when it returns false
 * @returns {{ design, mf, omf, removed, baseMf, baseLayers, trail }}
 */
export function removeRedundantLayers({
    design,
    side = 'front',
    dMin = 1e-3,
    tol = 0.02,
    minLayers = 1,
    maxIter = 40,
    refineFn,
    onProgress,
    alive,
}) {
    if (typeof refineFn !== 'function') throw new Error('removeRedundantLayers: refineFn required');
    const key = sideKey(side);

    // Refined baseline so trial comparisons are apples-to-apples (the incoming
    // design may already be refined, but one cheap pass guarantees it and gives
    // us omf consistently).
    let cur = refineFn(deep(design), maxIter);
    const baseMf = cur.mf;
    const baseLayers = (cur.design[key] || []).length;
    let baseline = cur.mf;                 // acceptance bar tracks the best MF seen
    let removed = 0;
    const trail = [{ layers: baseLayers, mf: cur.mf, removedIdx: null }];

    while ((cur.design[key] || []).length > minLayers) {
        if (alive && !alive()) break;
        const layers = cur.design[key] || [];
        const idxs = [];
        for (let i = 0; i < layers.length; i++) if (!layers[i].locked) idxs.push(i);
        if (idxs.length === 0) break;

        let best = null;                   // { mf, design, omf, i }
        for (const i of idxs) {
            if (alive && !alive()) break;
            const trimmed = layers.filter((_, j) => j !== i);
            const cleaned = cleanupLayers(trimmed, dMin);
            const cand = { ...cur.design, [key]: cleaned };
            const r = refineFn(cand, maxIter);
            if (!best || r.mf < best.mf) best = { mf: r.mf, design: r.design, omf: r.omf, i };
        }
        if (!best) break;

        const threshold = baseline * (1 + tol);
        if (best.mf <= threshold) {
            cur = { mf: best.mf, design: best.design, omf: best.omf };
            baseline = Math.min(baseline, best.mf);
            removed++;
            trail.push({ layers: (cur.design[key] || []).length, mf: cur.mf, removedIdx: best.i });
            onProgress?.(cur);
        } else {
            break;                         // best possible removal still hurts → done
        }
    }

    return {
        design: cur.design,
        mf: cur.mf,
        omf: cur.omf,
        removed,
        baseMf,
        baseLayers,
        trail,
    };
}
