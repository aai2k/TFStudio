import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { getMaterialById } from '../../../../utils/materials/catalogManager.js';

export function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

export function matDisplayName(id) {
    if (!id) return '';
    const parts = id.split(':');
    return parts[parts.length - 1];
}

// Human-readable material name for DISPLAY (history badges, top designs).
// A material's *id* is a sanitized, immutable key (e.g. "TiO2_2"); its *name*
// is the editable label shown in the Material Editor. Renaming a material in
// the editor intentionally does NOT change its id — that key is referenced by
// every saved design and catalog entry, so mutating it would silently break
// them. We therefore resolve the live `.name` wherever a material is shown to
// the user; it then tracks renames automatically. Falls back to the id segment
// for materials no longer in any catalog.
export function matFriendlyName(id) {
    if (!id) return '';
    const mat = getMaterialById(id);
    if (mat && mat.name) return mat.name;
    return matDisplayName(id);
}
