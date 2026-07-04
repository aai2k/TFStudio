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
 *      `[A 100 nm, B 0.3 nm, C 80 nm]` → `[A 100 nm, C 80 nm]`
 *      Useful for the *Thin Layer Removal* use case — list of
 *      sub-N nm layers and a one-click drop. The merit function typically
 *      degrades slightly after removal, so the *Re-optimize* option does a
 *      DLS pass on the cleaned design (the caller handles the optimizer
 *      invocation since it is async).
 *
 * Locked layers are always preserved:
 *   - never merged into a neighbor
 *   - never removed
 *
 * The function returns BOTH a cleaned design AND a structured report so the
 * UI can preview the operations before applying them.
 *
 * Equivalent to the lower-level `cleanupLayers`
 * used internally by needle/GE, but lifted to the design level and with a
 * report instead of a silent rewrite.
 */

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

// One remove pass — drops every unlocked layer below `dMin`.
function removePass(stage, side, ops, dMin) {
    const kept = [];
    for (const layer of stage) {
        if (!layer.locked && layer.thickness < dMin) {
            ops.push({
                side, kind: 'remove',
                srcIdx: layer._origIdx,
                materialId: layer.material,
                thickness: layer.thickness,
            });
        } else {
            kept.push(layer);
        }
    }
    return kept;
}

function cleanupOneSide(layers, side, opts) {
    const { dMin, mergeAdjacent } = opts;
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
        const afterRemove = removePass(stage, side, ops, dMin);
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

/**
 * Cleanup a full design.
 *
 * Routes both front and back stacks through the same operation list. In
 * `symmetric` surface-mode the back stack is regenerated from the cleaned
 * front (mirror), since it's not an independent variable.
 *
 * @param {object}  design
 * @param {object}  opts
 *   - dMin:           minimum thickness to keep, nm  (default 5)
 *   - mergeAdjacent:  merge same-material adjacent layers  (default true)
 *   - cleanBack:      also clean back stack  (default true; respects symmetric mode)
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
    const cleanBack      = opts.cleanBack !== false;

    const surfaceMode = design?.surfaceMode || 'front_only';
    const front = design.frontLayers || [];
    const back  = design.backLayers || [];

    const frontIn = front.length;
    const backIn  = back.length;

    // Clean front
    const frontRes = cleanupOneSide(front, 'front', { dMin, mergeAdjacent });

    // Clean back unless symmetric (back is derived from front)
    let backRes;
    if (surfaceMode === 'symmetric') {
        // Back will be regenerated below from cleaned front
        backRes = { cleaned: [], ops: [] };
    } else if (cleanBack) {
        backRes = cleanupOneSide(back, 'back', { dMin, mergeAdjacent });
    } else {
        backRes = { cleaned: back.map(l => ({ ...l })), ops: [] };
    }

    let newFront = frontRes.cleaned;
    let newBack  = backRes.cleaned;

    if (surfaceMode === 'symmetric') {
        // Back stack outward from substrate = reverse of front (preserves
        // physical mirror symmetry; locked-flag is propagated).
        newBack = [...newFront].reverse().map(l => ({ ...l }));
    }

    const cleaned = {
        ...design,
        frontLayers: newFront,
        backLayers:  newBack,
    };

    const ops = [...frontRes.ops, ...backRes.ops];
    const removedCount = ops.filter(o => o.kind === 'remove').length;
    const mergedCount  = ops.filter(o => o.kind === 'merge').length;

    return {
        design:        cleaned,
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
 * Excludes locked layers.
 *
 * @returns {Array<{ side, layerIndex, materialId, thickness }>}
 */
export function listThinLayers(design, dMin = 5.0) {
    const out = [];
    const surfaceMode = design?.surfaceMode || 'front_only';
    const front = design.frontLayers || [];
    const back  = design.backLayers || [];

    front.forEach((l, i) => {
        if (!l.locked && l.thickness < dMin) {
            out.push({ side: 'front', layerIndex: i, materialId: l.material, thickness: l.thickness });
        }
    });
    if (surfaceMode !== 'symmetric') {
        back.forEach((l, i) => {
            if (!l.locked && l.thickness < dMin) {
                out.push({ side: 'back', layerIndex: i, materialId: l.material, thickness: l.thickness });
            }
        });
    }
    return out;
}
