import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { designMaterialLookup, resolveDesignMaterial } from '../../../../utils/materials/designMaterials.js';

export const materialLookup = designMaterialLookup;

export function matDisplayName(id) {
    if (!id) return '';
    const parts = id.split(':');
    return parts[parts.length - 1];
}

/**
 * The material object a synthesis window shows for `id`: the one `design`
 * computes with when it is given, which covers a definition the design carries
 * and no catalog here holds, else the catalog's. Null when it resolves nowhere.
 */
export function displayedMaterial(id, design = null) {
    if (!design) return getMaterialById(id);
    const { material, status } = resolveDesignMaterial(design, id);
    return status === 'catalog' || status === 'embedded' ? material : getMaterialById(id);
}

// Human-readable material name for DISPLAY (history badges, top designs).
// A material's *id* is a sanitized, immutable key (e.g. "TiO2_2"); its *name*
// is the editable label shown in the Material Editor. Renaming a material in
// the editor intentionally does NOT change its id: that key is referenced by
// every saved design and catalog entry, so mutating it would silently break
// them. We therefore resolve the live `.name` wherever a material is shown to
// the user; it then tracks renames automatically. With `design`, a material
// the design carries is named as the design computes it. Falls back to the id
// segment for materials that resolve nowhere.
export function matFriendlyName(id, design = null) {
    if (!id) return '';
    const mat = displayedMaterial(id, design);
    if (mat && mat.name) return mat.name;
    return matDisplayName(id);
}
