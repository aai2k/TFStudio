import { savedMaterialIds } from './designMaterials.js';

/**
 * Open designs after materials were deleted from a catalog: each design that
 * uses one keeps its definition as its own copy, so it goes on computing as it
 * did, and its next save writes the definition into its file.
 *
 * `removed` maps compound ids to the records they had (see
 * notifyCatalogsChanged). A design whose copy of an id came from another
 * catalog, one with a different stamp, keeps that copy: the deleted material
 * was never the one it computed with.
 *
 * @returns {{ designs: Object, changed: string[] }} the designs map, with a new
 *   object for each design that changed, and the ids of those designs.
 */
export function keepRemovedMaterials(designs, removed) {
    const next = {};
    const changed = [];
    for (const [id, design] of Object.entries(designs || {})) {
        const kept = savedMaterialIds(design).filter(materialId => {
            const record = removed[materialId];
            const own = design.materials?.[materialId];
            return record && (!own?.catalogUid || own.catalogUid === record.catalogUid);
        });
        if (kept.length === 0) {
            next[id] = design;
            continue;
        }
        const materials = { ...(design.materials || {}) };
        for (const materialId of kept) materials[materialId] = removed[materialId];
        next[id] = { ...design, materials };
        changed.push(id);
    }
    return { designs: next, changed };
}
