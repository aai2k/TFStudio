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

import { cleanupLayers, mirrorLayers } from './layerOps.js';

const sideKey = (side) => (side === 'back' ? 'backLayers' : 'frontLayers');
const deep = (x) => JSON.parse(JSON.stringify(x));

// Indices of the non-locked (removable) layers.
function _removableIndices(layers) {
    const idxs = [];
    for (let i = 0; i < layers.length; i++) if (!layers[i].locked) idxs.push(i);
    return idxs;
}

function _deleteLayer(design, side, index, dMin) {
    const key = sideKey(side);
    const layers = design[key] || [];
    const cleaned = cleanupLayers(layers.filter((_, i) => i !== index), dMin);
    const next = { ...design, [key]: cleaned };
    if (design.surfaceMode === 'symmetric' && side === 'front') {
        next.backLayers = mirrorLayers(cleaned);
    }
    return next;
}

function _finiteResult(result) {
    return result && Number.isFinite(result.mf) && result.design;
}

// Trial-delete each removable layer (merging same-material neighbours via
// cleanupLayers), RE-REFINE the remainder, and return the single deletion whose
// re-refined merit is lowest — { mf, design, omf, i }, or null. `cfg` bundles
// the per-round-invariant context { key, dMin, maxIter, refineFn, alive }.
function _bestTrialDeletion(design, layers, idxs, cfg) {
    const { side, dMin, maxIter, refineFn, alive } = cfg;
    let best = null;
    for (const i of idxs) {
        if (alive && !alive()) break;
        const r = refineFn(_deleteLayer(design, side, i, dMin), maxIter);
        if (_finiteResult(r) && (!best || r.mf < best.mf)) {
            best = { mf: r.mf, design: r.design, omf: r.omf, i };
        }
    }
    return best;
}

/**
 * Rank every unlocked single-layer deletion by its re-refined merit cost.
 * Candidate designs are retained so a UI can apply the exact geometry it
 * scored. Adjacent equal-material layers are merged by cleanupLayers, and a
 * symmetric back stack is regenerated whenever its front stack changes.
 */
export function rankLayerDeletions({
    design,
    sides = ['front'],
    dMin = 1e-3,
    maxIter = 40,
    refineFn,
    baselineResult = null,
    onProgress,
    alive,
}) {
    if (typeof refineFn !== 'function') throw new Error('rankLayerDeletions: refineFn required');
    const baseline = baselineResult || refineFn(deep(design), maxIter);
    if (!_finiteResult(baseline)) throw new Error('rankLayerDeletions: baseline refinement failed');

    const normalizedSides = [...new Set(sides)].filter(side => side === 'front' || side === 'back');
    const work = [];
    for (const side of normalizedSides) {
        const key = sideKey(side);
        const layers = baseline.design[key] || [];
        for (const index of _removableIndices(layers)) work.push({ side, key, index, layer: layers[index] });
    }

    const candidates = [];
    let done = 0;
    for (const item of work) {
        if (alive && !alive()) break;
        try {
            const result = refineFn(_deleteLayer(baseline.design, item.side, item.index, dMin), maxIter);
            if (_finiteResult(result)) {
                candidates.push({
                    side: item.side,
                    layerIndex: item.index,
                    layerId: item.layer.id,
                    materialId: item.layer.material,
                    thickness: item.layer.thickness,
                    mfBefore: baseline.mf,
                    mfAfter: result.mf,
                    deltaMF: result.mf - baseline.mf,
                    design: result.design,
                });
            }
        } catch {
            // Singular candidates are omitted without aborting the remaining
            // ranking; the caller still receives accurate progress.
        }
        done++;
        onProgress?.({ phase: 'candidate', done, total: work.length, candidates: candidates.length });
    }
    candidates.sort((a, b) => a.deltaMF - b.deltaMF
        || a.side.localeCompare(b.side) || a.layerIndex - b.layerIndex);
    return { mfBefore: baseline.mf, baselineDesign: baseline.design, candidates };
}

/**
 * Greedily remove the cheapest layer while the cumulative absolute increase
 * from the once-refined baseline stays within `budget`.
 */
export function eliminateWithinMeritBudget({
    design,
    sides = ['front'],
    dMin = 1e-3,
    budget = 0,
    maxRemovals = 1000,
    maxIter = 40,
    refineFn,
    onProgress,
    alive,
}) {
    if (typeof refineFn !== 'function') throw new Error('eliminateWithinMeritBudget: refineFn required');
    let current = refineFn(deep(design), maxIter);
    if (!_finiteResult(current)) throw new Error('eliminateWithinMeritBudget: baseline refinement failed');
    const baseline = current.mf;
    const removed = [];
    const limit = Math.max(0, Math.min(1000, Math.floor(Number(maxRemovals) || 0)));
    const allowance = Math.max(0, Number(budget) || 0);

    for (let round = 0; round < limit; round++) {
        if (alive && !alive()) break;
        const analysis = rankLayerDeletions({
            design: current.design, sides, dMin, maxIter, refineFn,
            baselineResult: current, alive,
            onProgress: progress => onProgress?.({ ...progress, phase: 'ranking', round, removed: removed.length }),
        });
        const best = analysis.candidates[0];
        if (!best || best.mfAfter - baseline > allowance + 1e-12) break;
        removed.push({
            side: best.side,
            layerIndex: best.layerIndex,
            layerId: best.layerId,
            materialId: best.materialId,
            thickness: best.thickness,
            deltaMF: best.mfAfter - current.mf,
        });
        current = { mf: best.mfAfter, design: best.design };
        onProgress?.({ phase: 'accepted', round, removed: removed.length, mf: current.mf });
    }
    return { design: current.design, baseline, mfAfter: current.mf, removed };
}

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
    const trialCfg = { side, dMin, maxIter, refineFn, alive };

    while ((cur.design[key] || []).length > minLayers) {
        if (alive && !alive()) break;
        const layers = cur.design[key] || [];
        const idxs = _removableIndices(layers);
        if (idxs.length === 0) break;

        const best = _bestTrialDeletion(cur.design, layers, idxs, trialCfg);
        if (!best) break;

        const threshold = baseline * (1 + tol);
        if (best.mf > threshold) break;    // best possible removal still hurts → done

        cur = { mf: best.mf, design: best.design, omf: best.omf };
        baseline = Math.min(baseline, best.mf);
        removed++;
        trail.push({ layers: (cur.design[key] || []).length, mf: cur.mf, removedIdx: best.i });
        onProgress?.(cur);
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
