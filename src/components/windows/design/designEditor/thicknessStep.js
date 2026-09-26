import { MAX_THICKNESS_NM, unitToNm } from './units.js';

// One arrow click or wheel tick, in each thickness column's own unit. A full
// wave is four quarter waves, so the FW step is a quarter of the QW step and
// the arrows in both columns move a layer by the same optical thickness,
// λ₀/40.
const BASE_STEP = { nm: 1, OT: 1, QWOT: 0.1, FWOT: 0.025 };

/** Step size for `unit`: Shift steps ten times further, Ctrl a tenth as far. */
export function thicknessStep(unit, { shiftKey = false, ctrlKey = false } = {}) {
    const base = BASE_STEP[unit] ?? BASE_STEP.nm;
    return base * (shiftKey ? 10 : 1) / (ctrlKey ? 10 : 1);
}

/**
 * `layers` with every unlocked layer in `ids` moved by `amount` of `unit`, or
 * null when none of them moves. In OT, QW and FW each layer moves by that
 * amount of its own optical thickness at `refLambda`, so the change in d
 * differs with the layer's index. A layer stops at 0 and at MAX_THICKNESS_NM,
 * the bounds a typed entry has. A layer whose material resolves nowhere, in
 * the design's `designMaterials` block or the catalogs, has no optical
 * thickness to step in those units and keeps its value.
 */
export function stepLayerThicknesses(layers, ids, { amount, unit, refLambda, designMaterials }) {
    const targets = new Set(ids);
    let changed = false;
    const next = layers.map(layer => {
        if (!targets.has(layer.id) || layer.locked) return layer;
        const deltaNm = unitToNm(amount, layer.material, refLambda, unit, designMaterials);
        if (!Number.isFinite(deltaNm)) return layer;
        const thickness = Math.min(Math.max((layer.thickness || 0) + deltaNm, 0), MAX_THICKNESS_NM);
        if (thickness === layer.thickness) return layer;
        changed = true;
        return { ...layer, thickness };
    });
    return changed ? next : null;
}

/**
 * Groups thickness steps into bursts for undo. A burst is a run of steps on
 * the same cells with no pause longer than `gapMs`. Its first write is an
 * undoable edit and the rest are transient, so one Ctrl+Z takes back a whole
 * wheel spin, a run of arrow clicks, or a held arrow.
 *
 * `step(key, layers, now, build)` builds the next stack from the one this
 * burst last wrote while the table still shows one of its writes, and from
 * the table's `layers` otherwise. A stack the burst did not write, after an
 * undo or an edit elsewhere, starts a new burst. Returns `{ next, commit }`,
 * or null when `build` returns null because nothing moved.
 */
export function createStepBursts(gapMs) {
    let burst = null;
    return {
        step(key, layers, now, build) {
            const continues = burst && burst.key === key
                && now - burst.at <= gapMs && burst.written.has(layers);
            if (!continues) {
                burst = { key, written: new WeakSet(), last: layers, committed: false };
            }
            burst.at = now;
            const next = build(burst.last);
            if (!next) return null;
            const commit = !burst.committed;
            burst.committed = true;
            burst.written.add(next);
            burst.last = next;
            return { next, commit };
        },
    };
}
