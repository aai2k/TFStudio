/**
 * Design Cleaner — structural cleanup of a layer stack.
 *
 * Two operations, both optional:
 *
 *   1. **Merge same-material adjacent layers**
 *      `[A 12 nm, A 8 nm, B 50 nm]` → `[A 20 nm, B 50 nm]`
 *      Useful after needle insertion left a same-material pair, or after
 *      Gradual Evolution forced a thin segment between two equal halves.
 *
 *   2. **Remove layers below a thickness threshold**
 *      `[A 100 nm, B 0.3 nm, C 80 nm]` → `[A 100 nm + B's, C 80 nm]`
 *      The removed layer's optical thickness at the design's reference
 *      wavelength goes to the unlocked neighbour with the closer index, so
 *      the total optical thickness is kept. Only between layers with n > k
 *      there; a metal is taken out alone.
 *      Useful for the *Thin Layer Removal* use case — list of
 *      sub-N nm layers and a one-click drop. The merit function typically
 *      degrades slightly after removal, so the *Re-optimize* option runs a
 *      short pass of the default refiner on the cleaned design (the caller
 *      runs it, in the optimizer worker).
 *
 * Locked layers are always preserved:
 *   - never merged into a neighbor
 *   - never removed
 *   - never given the thickness a removed layer hands over
 *
 * The function returns BOTH a cleaned design AND a structured report so the
 * UI can preview the operations before applying them.
 *
 * Equivalent to the lower-level `cleanupLayers`
 * used internally by needle/GE, but lifted to the design level and with a
 * report instead of a silent rewrite.
 */

import { mirrorLayers } from '../physics/optimizer/layerOps.js';
import { designMaterialLookup } from '../materials/designMaterials.js';

const DEFAULT_REFERENCE_NM = 550;   // nm, the reference wavelength of a design that sets none

// Each operation in the report:
//   { side: 'front'|'back', kind: 'remove'|'merge', srcIdx, dstIdx?, materialId, thickness, mergedInto? }
// Indices refer to the *original* layer indices.
//
// One merge pass over `stage`. Same-material *unlocked* neighbours combine
// their thicknesses; locked layers break the merge chain.
function mergePass(stage, side, ops) {
    if (stage.length < 2) return stage;
    const merged = [];
    for (const layer of stage) {
        const prev = merged[merged.length - 1];
        if (prev && !prev.locked && !layer.locked && prev.material === layer.material) {
            ops.push({
                side, kind: 'merge',
                srcIdx: layer._origIdx,
                dstIdx: prev._origIdx,
                materialId: layer.material,
                thickness: layer.thickness,
                mergedInto: prev._origIdx,
            });
            merged[merged.length - 1] = {
                ...prev,
                thickness: prev.thickness + layer.thickness,
            };
        } else {
            merged.push(layer);
        }
    }
    return merged;
}

// The index a removal is judged on: the real part of the material's index at
// the design's reference wavelength, or null for a material that has none to
// hand on, whose layer is then taken out without handing its thickness on, or
// is not given one. That is a material the design cannot resolve and a metal:
// where n does not exceed k, n d is not the phase thickness of the layer.
function indexReader(design) {
    const lookup = designMaterialLookup(design);
    const lambda = design.referenceWavelength || DEFAULT_REFERENCE_NM;
    return (id) => {
        try {
            const [n, k] = lookup(id).getNK(lambda);
            return n > k && n > 0 ? n : null;
        } catch (_) {
            return null;
        }
    };
}

// The place in `stage` of the thinnest unlocked layer below `dMin` (the first
// of equally thin ones), or -1.
function thinnestBelow(stage, dMin) {
    let at = -1;
    stage.forEach((layer, i) => {
        if (!layer.locked && layer.thickness < dMin && (at < 0 || layer.thickness < stage[at].thickness)) at = i;
    });
    return at;
}

// Where the layer at `i` hands its optical thickness: the unlocked neighbour
// whose index is closer to its own (the one before it when they are equally
// close, which makes no optical difference). Returns { at, add } with the
// thickness `add` nm that neighbour gains (d n_removed / n_neighbour), or null
// when no neighbour can take it.
function receiverOf(stage, i, indexOf) {
    const n = indexOf(stage[i].material);
    if (n == null) return null;
    let best = null;
    for (const at of [i - 1, i + 1]) {
        if (at < 0 || at >= stage.length || stage[at].locked) continue;
        const nNeighbour = indexOf(stage[at].material);
        if (nNeighbour == null) continue;
        const gap = Math.abs(nNeighbour - n);
        if (!best || gap < best.gap) best = { at, gap, add: stage[i].thickness * n / nNeighbour };
    }
    return best;
}

// One remove pass: takes out every unlocked layer below `dMin`, the thinnest
// first; a layer that took a neighbour's thickness stays if that lifts it to
// `dMin`. Following Tikhonravov, Trubetskov and DeBell, Appl. Opt. 46, 704
// (2007), p. 706, a layer goes with its optical thickness kept: a neighbour
// takes it (receiverOf), so the stack's total optical thickness at the
// reference wavelength is unchanged.
function removePass(stage, side, ops, dMin, indexOf) {
    let kept = stage;
    for (let i = thinnestBelow(kept, dMin); i >= 0; i = thinnestBelow(kept, dMin)) {
        const layer = kept[i];
        ops.push({
            side, kind: 'remove',
            srcIdx: layer._origIdx,
            materialId: layer.material,
            thickness: layer.thickness,
        });
        const to = receiverOf(kept, i, indexOf);
        const next = kept.filter((_, j) => j !== i);
        if (to) {
            const at = to.at > i ? to.at - 1 : to.at;
            next[at] = { ...next[at], thickness: next[at].thickness + to.add };
        }
        kept = next;
    }
    return kept;
}

function cleanupOneSide(layers, side, opts) {
    const { dMin, mergeAdjacent, indexOf } = opts;
    const ops = [];

    // Cycle merge → remove until stable. A single pair (merge, remove) is
    // usually enough, but a removed thin layer can leave two previously-
    // non-adjacent same-material layers neighboring each other, which the
    // *next* merge pass catches. Two iterations are sufficient in practice
    // (removal-then-merge converges) but we cap to a few just in case.
    let stage = layers.map((l, idx) => ({ ...l, _origIdx: idx }));
    let lastLen = -1;
    for (let i = 0; i < 4 && stage.length !== lastLen; i++) {
        lastLen = stage.length;
        if (mergeAdjacent) stage = mergePass(stage, side, ops);
        const afterRemove = removePass(stage, side, ops, dMin, indexOf);
        if (afterRemove.length === stage.length) {
            // No removals this pass → no further chance of new adjacency
            stage = afterRemove;
            break;
        }
        stage = afterRemove;
    }
    // One last merge in case the final remove pass exposed new adjacencies
    if (mergeAdjacent) stage = mergePass(stage, side, ops);

    // Strip the bookkeeping `_origIdx` before returning
    const cleaned = stage.map(({ _origIdx, ...rest }) => rest);
    return { cleaned, ops };
}

// The sides `side` ('front', 'back' or 'both', by default 'both') cleans on
// `design`. A symmetric design's front is cleaned whatever `side` is, its back
// being the mirror of its front.
const CLEANED = { front: { front: true, back: false }, back: { front: false, back: true }, both: { front: true, back: true } };
function cleanedSides(design, side = 'both') {
    return design?.surfaceMode === 'symmetric' ? CLEANED.front : CLEANED[side];
}

/**
 * Cleanup a full design.
 *
 * Routes the sides cleaned through the same operation list; a side not
 * cleaned is kept layer for layer. In `symmetric` surface-mode the front is
 * cleaned whatever `side` is, and the back stack is regenerated from the
 * cleaned front (mirror), since it's not an independent variable.
 *
 * @param {object}  design
 * @param {object}  opts
 *   - dMin:           minimum thickness to keep, nm  (default 5)
 *   - mergeAdjacent:  merge same-material adjacent layers  (default true)
 *   - side:           'front', 'back' or 'both', the sides cleaned  (default 'both')
 *
 * @returns {{
 *   design:         cleaned design
 *   ops:            Array of operations performed (see top-of-file shape)
 *   removedCount:   number of layers removed
 *   mergedCount:    number of merge operations
 *   layersBefore:   { front, back }
 *   layersAfter:    { front, back }
 * }}
 */
export function cleanupDesign(design, opts = {}) {
    const dMin           = opts.dMin ?? 5.0;
    const mergeAdjacent  = opts.mergeAdjacent !== false;

    const sides = cleanedSides(design, opts.side);
    const front = design.frontLayers || [];
    const back  = design.backLayers || [];

    const frontIn = front.length;
    const backIn  = back.length;

    const indexOf = indexReader(design);
    const clean = (layers, side) => (sides[side]
        ? cleanupOneSide(layers, side, { dMin, mergeAdjacent, indexOf })
        : { cleaned: layers.map(l => ({ ...l })), ops: [] });
    const frontRes = clean(front, 'front');
    const backRes = clean(back, 'back');

    const newFront = frontRes.cleaned;
    // A symmetric back is the mirror of the cleaned front, as the design store
    // rebuilds it: the same layers outward from the substrate, locks included,
    // each under its front twin's id with a b- prefix.
    const newBack = design?.surfaceMode === 'symmetric' ? mirrorLayers(newFront) : backRes.cleaned;

    const ops = [...frontRes.ops, ...backRes.ops];
    const removedCount = ops.filter(o => o.kind === 'remove').length;
    const mergedCount  = ops.filter(o => o.kind === 'merge').length;

    return {
        design:        { ...design, frontLayers: newFront, backLayers: newBack },
        ops,
        removedCount,
        mergedCount,
        layersBefore: { front: frontIn, back: backIn },
        layersAfter:  { front: newFront.length, back: newBack.length },
    };
}

/**
 * Convenience: scan a design for layers below a threshold (for the
 * "Thin Layer Removal" list view) without modifying anything.
 *
 * Excludes locked layers, and the sides `side` does not clean, as
 * cleanupDesign takes it.
 *
 * @returns {Array<{ side, layerIndex, materialId, thickness }>}
 */
export function listThinLayers(design, dMin = 5.0, side = 'both') {
    const out = [];
    const sides = cleanedSides(design, side);
    for (const s of ['front', 'back']) {
        if (!sides[s]) continue;
        (design[`${s}Layers`] || []).forEach((l, i) => {
            if (!l.locked && l.thickness < dMin) {
                out.push({ side: s, layerIndex: i, materialId: l.material, thickness: l.thickness });
            }
        });
    }
    return out;
}
