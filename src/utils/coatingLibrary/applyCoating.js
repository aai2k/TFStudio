/**
 * Putting a library coating onto one side of a design.
 *
 * The result is a patch for `updateDesign`, so the caller decides whether it
 * is an undoable edit (call `checkpoint` first) and the design context keeps
 * its own invariants (layer ids, the mirrored back stack in symmetric mode).
 */
import { mirrorLayers } from '../physics/optimizer.js';
import { dispersionFingerprint } from '../materials/designCatalog.js';
import { designMaterialIds, resolveDesignMaterial } from '../materials/designMaterials.js';

function freshLayers(entry) {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return entry.layers.map((layer, i) => ({
        id: `lib-${stamp}-${i}`, material: layer.material, thickness: layer.thickness, locked: false,
    }));
}

// A side that gains layers becomes visible and optimizable. A deliberate
// both_independent or symmetric choice is never demoted.
function promoteSurfaceMode(patch, design) {
    const current = design.surfaceMode || 'front_only';
    const hasFront = (patch.frontLayers ?? design.frontLayers ?? []).length > 0;
    const hasBack = (patch.backLayers ?? design.backLayers ?? []).length > 0;
    if (current === 'front_only' && hasBack) patch.surfaceMode = hasFront ? 'both_independent' : 'back_only';
    else if (current === 'back_only' && hasFront) patch.surfaceMode = hasBack ? 'both_independent' : 'front_only';
}

/**
 * Definitions the entry brings along, merged with what the design already has.
 *
 * The design's existing meaning of an id always wins: an id the design embeds
 * or already uses from a local catalog keeps that definition, and the entry's
 * definition is reported as a clash when its dispersion differs. An id new to
 * the design, or one the design uses but cannot resolve, takes the entry's
 * definition so the coating computes as it was saved.
 *
 * @returns {{ materials: object|null, clashes: string[] }}
 */
export function mergeEntryMaterials(design, entry) {
    const incoming = entry.materials || {};
    const ids = Object.keys(incoming);
    if (ids.length === 0) return { materials: null, clashes: [] };

    const used = new Set(designMaterialIds(design));
    const merged = { ...(design.materials || {}) };
    const clashes = [];
    for (const id of ids) {
        const record = incoming[id];
        const embedded = merged[id];
        if (embedded) {
            if (dispersionFingerprint(embedded) !== dispersionFingerprint(record)) clashes.push(id);
            continue;
        }
        if (used.has(id)) {
            const { material, status } = resolveDesignMaterial(design, id);
            if (status === 'catalog' && dispersionFingerprint(material) !== dispersionFingerprint(record)) {
                clashes.push(id);
                continue;
            }
        }
        merged[id] = record;
    }
    return { materials: merged, clashes };
}

/**
 * Design patch that puts `entry` on `side`.
 *
 * `replace` swaps the side's stack for the coating; `append` deposits the
 * coating on top of what is there, so the new layers are the outermost ones.
 * In symmetric mode both sides are one coating, so the back is the mirror of
 * the new front whichever side was asked for.
 *
 * @param {object} design
 * @param {object} entry
 * @param {{ side?: 'front'|'back', mode?: 'replace'|'append' }} options
 * @returns {{ patch: object, clashes: string[] }}
 */
export function applyCoatingPatch(design, entry, { side = 'front', mode = 'replace' } = {}) {
    const fresh = freshLayers(entry);
    const symmetric = design.surfaceMode === 'symmetric';
    const patch = {};
    if (side === 'back' && !symmetric) {
        const existing = design.backLayers || [];
        patch.backLayers = mode === 'append' ? [...existing, ...fresh] : fresh;
    } else {
        const front = [...fresh].reverse();
        const existing = design.frontLayers || [];
        patch.frontLayers = mode === 'append' ? [...front, ...existing] : front;
        if (symmetric) patch.backLayers = mirrorLayers(patch.frontLayers);
    }
    const { materials, clashes } = mergeEntryMaterials(design, entry);
    if (materials) patch.materials = materials;
    promoteSurfaceMode(patch, design);
    return { patch, clashes };
}
