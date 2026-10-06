/**
 * Which catalog a design's copy of a material came from.
 *
 * An id alone does not say it: two computers can each have a catalog called
 * `user_my_catalog` or `zemax_coating` with different data. Every catalog the
 * user can change carries a random stamp (`uid`), and each copy a design saves
 * records the stamp of its catalog (`catalogUid`); see designMaterials.js for
 * what a design computes with as a result. Two copies are compared by the
 * fields that determine n,k, so the same material under two stamps is still
 * one material.
 */
import { getCatalog, getMaterialById } from './catalogManager.js';
import { hasTabulatedComponent, interpolationRuleOf } from './pchip.js';

// Only the fields that determine n,k. Name, color and comment differ freely
// between two copies of one material and are not a physical disagreement. An
// active dispersion fit replaces a table inside its range (see dispersion.js),
// so it counts; an inactive one does not.
export function dispersionFingerprint(mat) {
    return JSON.stringify([
        mat.formulaNum ?? null,
        mat.coefficients ?? null,
        mat.tabData ?? null,
        mat.kTable ?? null,
        hasTabulatedComponent(mat) ? interpolationRuleOf(mat) : null,
        mat.dispersionFit?.active ? mat.dispersionFit : null,
    ]);
}

// Fingerprints of records and catalog entries, which are replaced rather than
// changed in place. A table can run to tens of thousands of rows, and a
// material is resolved on every render of every layer.
const fingerprints = new WeakMap();
function fingerprintOf(material) {
    if (!fingerprints.has(material)) fingerprints.set(material, dispersionFingerprint(material));
    return fingerprints.get(material);
}

/** The stamp of the catalog that holds `id` here, or null. */
export function localCatalogUid(id) {
    const sep = id.indexOf(':');
    return sep > 0 ? getCatalog(id.slice(0, sep))?.uid ?? null : null;
}

/**
 * True when the design's copy `record` was written from another catalog than
 * the one that holds the id on this computer, `registered`, and its n,k differ
 * from that catalog's. The same n,k under another stamp is the same material,
 * such as a glass of an AGF file every installation has, and follows the
 * catalog here. A copy with no stamp, written before stamps existed, follows
 * the catalog too.
 */
export function fromAnotherCatalog(record, id, registered) {
    if (!record?.catalogUid) return false;
    const local = localCatalogUid(id);
    return local != null && local !== record.catalogUid
        && fingerprintOf(record) !== fingerprintOf(registered);
}

/**
 * `design` with each copy stamped by another catalog, but with the n,k of the
 * catalog that holds its id here, given this catalog's stamp: it is the same
 * material (see fromAnotherCatalog), and from then on the design follows this
 * catalog through later edits, as a copy saved here does. The same object when
 * no copy changes.
 */
export function withFollowedCopies(design) {
    let materials = null;
    for (const [id, record] of Object.entries(design?.materials || {})) {
        const local = localCatalogUid(id);
        if (!record?.catalogUid || local == null || record.catalogUid === local) continue;
        const registered = getMaterialById(id);
        if (!registered || fingerprintOf(record) !== fingerprintOf(registered)) continue;
        (materials ||= { ...design.materials })[id] = { ...record, catalogUid: local };
    }
    return materials ? { ...design, materials } : design;
}

/**
 * Whether `design` follows a catalog here through a copy that its file,
 * `saved`, would no longer follow: the file's copy carries another catalog's
 * stamp, and this catalog's n,k have changed since. Read from the file alone,
 * the design would then compute with its old copy, so the design's own stamp
 * has to be kept until it is saved.
 */
export function followsBeyondFile(design, saved) {
    return Object.entries(design?.materials || {}).some(([id, record]) => {
        const fileCopy = saved?.materials?.[id];
        if (!fileCopy || !record?.catalogUid || record.catalogUid !== localCatalogUid(id)) return false;
        return fileCopy.catalogUid !== record.catalogUid && !catalogServes(fileCopy, id);
    });
}

/**
 * withFollowedCopies over a map of designs by id: the map, with a new object
 * for each design that changed, and the ids of those designs.
 */
export function followedDesigns(designs) {
    const next = {};
    const changed = [];
    for (const [id, design] of Object.entries(designs || {})) {
        next[id] = withFollowedCopies(design);
        if (next[id] !== design) changed.push(id);
    }
    return { designs: next, changed };
}

/**
 * Whether a catalog here serves `id` for a design that carries `record` (or
 * none): a catalog holds the id, and the record was not written from another
 * catalog with other n,k.
 */
export function catalogServes(record, id) {
    const registered = getMaterialById(id);
    return !!registered && !fromAnotherCatalog(record, id, registered);
}
