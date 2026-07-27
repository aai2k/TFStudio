/**
 * The active design's embedded materials, presented as a read-only catalog.
 *
 * Embedded definitions are deliberately kept out of the global registry.
 * Registering them would list design-scoped ids in the material picker, where
 * assigning one would write a layer reference that only means something inside
 * the design that supplied it. The Material Editor merges this catalog into its
 * own browsing list instead, so a recipient can inspect the n,k a design was
 * computed with, and copy a definition into a user catalog when they want to
 * keep it. Nothing is adopted automatically.
 */
import { getMaterialById } from './catalogManager.js';
import { designMaterialIds, resolveDesignMaterial } from './designMaterials.js';

export const DESIGN_CATALOG_ID = 'design';
const SELECTION_PREFIX = `${DESIGN_CATALOG_ID}:`;

/**
 * Read-only catalog of every material a design uses — layers, substrate and both
 * media — or null when none of them resolve. Entries are keyed by the id the
 * design references them under, so the list matches the Design Editor.
 *
 * Built-in materials are listed here even though they are referenced rather than
 * embedded when the design is written: this catalog answers "what is this design
 * made of", which is not the same question as "what travels inside the file".
 * Where a material came from is reported per material by
 * `designMaterialConflict`.
 *
 * Membership is derived from the design's references rather than read from a
 * stored `materials` block, because a design gains that block on its way to disk
 * — reading it would leave the catalog empty until a save-and-reopen cycle.
 */
export function buildDesignCatalog(design, name) {
    const materials = {};
    for (const id of designMaterialIds(design)) {
        const { material, status } = resolveDesignMaterial(design, id);
        // An unresolved id has no dispersion data to show; the missing-materials
        // notice is what reports it.
        if (status !== 'missing') materials[id] = material;
    }
    return Object.keys(materials).length > 0
        ? { id: DESIGN_CATALOG_ID, name, source: 'design', materials }
        : null;
}

/**
 * Entries of a design catalog matching `query`, shaped like a searchMaterials()
 * result plus the `selectionId` that addresses the entry in the material list.
 */
export function searchDesignCatalog(catalog, query) {
    if (!catalog) return [];
    const q = (query || '').toLowerCase().trim();
    return Object.entries(catalog.materials)
        .filter(([id, mat]) => !q
            || id.toLowerCase().includes(q)
            || (mat.name || '').toLowerCase().includes(q))
        .map(([id, material]) => ({
            catalogId: catalog.id, catalogName: catalog.name,
            material, selectionId: SELECTION_PREFIX + id,
        }));
}

/**
 * The embedded id behind a material-list selection key, or null when the key
 * does not address the design catalog. Confirming the id against the catalog
 * also covers an imported catalog that happens to be named `design`.
 */
export function designSelectionTarget(catalog, selectionId) {
    if (!catalog || !selectionId?.startsWith(SELECTION_PREFIX)) return null;
    const id = selectionId.slice(SELECTION_PREFIX.length);
    return catalog.materials[id] ? id : null;
}

// Only the fields that determine n,k. Name, color and comment differ freely
// between two copies of one material and are not a physical disagreement.
function dispersionFingerprint(mat) {
    return JSON.stringify([
        mat.formulaNum ?? null,
        mat.coefficients ?? null,
        mat.tabData ?? null,
        mat.kTable ?? null,
    ]);
}

/**
 * How a design's embedded definition relates to the local catalogs:
 *   'absent'  — no local material holds this id; the design is its only source
 *   'same'    — a local material holds the same dispersion data
 *   'differs' — a local material holds this id with different n,k
 *
 * `differs` is the case worth surfacing: the design is computed from its
 * embedded definition, so the local material of the same id is not the one that
 * produced its spectrum.
 *
 * @returns {'absent'|'same'|'differs'|null}  null when `id` is not embedded.
 */
export function designMaterialConflict(design, id) {
    const record = design?.materials?.[id];
    if (!record) return null;
    const local = getMaterialById(id);
    if (!local) return 'absent';
    return dispersionFingerprint(record) === dispersionFingerprint(local) ? 'same' : 'differs';
}
