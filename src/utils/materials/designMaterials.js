/**
 * Design-scoped material resolution.
 *
 * A design references materials by id (`builtin:SiO2`, `user_hr:Ta2O5`,
 * `agf:N-BK7`). Ids outside the built-in library resolve only against catalogs
 * held on the machine that created them, so a design loses those materials when
 * it travels to another installation, or when its catalog is renamed or
 * deleted locally. Resolving such an id to Air yields a plausible spectrum for a
 * coating nobody designed, so resolution reports it as `missing` instead.
 *
 * A design therefore carries the dispersion definition of every non-built-in
 * material it uses in a `materials` block, as a backup. A catalog on this
 * machine that holds the id comes first, so an edit in the Material Editor
 * reaches every design that uses the material, and each save writes the
 * catalog's current definition into the block. The block is consulted for an id
 * no catalog here holds: a file received from another installation, or a
 * catalog deleted since the design was saved.
 *
 * An id alone does not say which catalog a material came from: two computers
 * can each have a catalog called `user_my_catalog` or `zemax_coating` with
 * different data. So every catalog the user can change carries a random stamp
 * (`uid`), and each definition a save writes records the stamp of its catalog
 * (`catalogUid`). A definition stamped by another catalog than the one holding
 * the id here is the design's own, and the design computes with it, unless its
 * n,k are that catalog's (catalogStamps.js). A definition with no stamp,
 * written before stamps existed, follows the catalog. A catalog never gives a
 * deleted material's id to a new one, so a design that kept the deleted
 * material keeps computing with it.
 *
 * Built-in materials are referenced by id, never embedded. Their dispersion is
 * JavaScript in materialDatabase.js rather than data, so embedding one would
 * mean resampling it into a table, an approximation of a material every
 * installation already holds exactly.
 */
import { getMaterialById } from './catalogManager.js';
import { fromAnotherCatalog, localCatalogUid } from './catalogStamps.js';
import { makeGetNK } from './catalogManager/dispersion.js';
import { stripGetNK } from './catalogManager/persistence.js';
import { herpinMaterialRecord } from './herpinMaterial.js';
import { getMaterial, MATERIAL_MAP } from './materialDatabase.js';
import { hasTabulatedComponent, interpolationRuleOf } from './pchip.js';

// Material objects built from embedded records, keyed by the record itself.
// Embedded records live on the design, which is React state and is posted to
// workers by structured clone, so the getNK closure is cached here rather than
// attached to the record the way getMaterialById attaches it to catalog entries.
const embeddedCache = new WeakMap();

/** Raised when calculation code asks for a material the design cannot resolve. */
export class UnresolvedDesignMaterialError extends Error {
    constructor(id) {
        super(`Unresolved design material: ${id}`);
        this.name = 'UnresolvedDesignMaterialError';
        this.code = 'UNRESOLVED_DESIGN_MATERIAL';
        this.materialId = id;
    }
}

// The material an embedded record describes, or null when its optical constants
// cannot be computed here (see makeGetNK).
function embeddedMaterial(record) {
    if (embeddedCache.has(record)) return embeddedCache.get(record);
    const getNK = makeGetNK(record);
    const material = getNK && {
        ...record,
        ...(hasTabulatedComponent(record) ? { interp: interpolationRuleOf(record) } : {}),
        getNK,
    };
    embeddedCache.set(record, material);
    return material;
}

/**
 * True for ids the built-in library serves: the `builtin:` prefix, or a bare
 * legacy name such as `BK7` from designs saved before compound ids existed.
 * Another bare id, such as the one a Herpin equivalent layer gets, names a
 * material only the design holds, and has to be written with it.
 */
export function isBuiltinId(id) {
    return id.startsWith('builtin:') || (!id.includes(':') && id in MATERIAL_MAP);
}

// Herpin equivalent layers saved by 1.6.3 to 1.8.4 lost their material, but each
// layer still holds its equivalent index; the material is rebuilt from that.
const herpinCache = new WeakMap();
function herpinRecordFromLayers(design, id) {
    if (!design || !String(id).startsWith('herpin-')) return null;
    let byId = herpinCache.get(design);
    if (!byId) herpinCache.set(design, byId = new Map());
    if (!byId.has(id)) {
        const layer = [...(design.frontLayers || []), ...(design.backLayers || [])]
            .find(candidate => candidate.material === id && candidate.herpin?.version === 1);
        const E = layer?.herpin?.equivalentIndex;
        byId.set(id, Number.isFinite(E) && E > 0
            ? herpinMaterialRecord(id, E, layer.herpin.referenceWavelength) : null);
    }
    return byId.get(id);
}

/**
 * `design` with a definition for each Herpin layer material it does not carry,
 * rebuilt from the layer as herpinRecordFromLayers does. The Design Editor
 * reads a layer's material from the design's `materials` block, which files
 * written by 1.6.3 to 1.8.4 lack for these. The same object when none is
 * missing.
 */
export function withHerpinRecords(design) {
    const added = {};
    for (const id of designMaterialIds(design)) {
        if (design.materials?.[id]) continue;
        const record = herpinRecordFromLayers(design, id);
        if (record) added[id] = record;
    }
    return Object.keys(added).length ? { ...design, materials: { ...(design.materials || {}), ...added } } : design;
}

/**
 * Resolve one material id against a design: the local catalogs first, then the
 * definition the design carries.
 *
 * `missing` still carries Air as its material so callers can render a layer
 * list without crashing, but it must not be treated as a result; see
 * `unresolvedMaterials`. A definition the design carries but this program
 * cannot compute is `missing` too when no catalog here holds the id, or when
 * it came from another catalog than the one that does: computing with that
 * catalog would mean computing a different material.
 *
 * `conflict` is set on an `embedded` result when a catalog here holds the id
 * with other n,k: the design computes with its own copy, and a catalog row of
 * the same id is another material.
 *
 * @returns {{ material: Object, status: 'embedded'|'catalog'|'missing'|'unset', conflict?: true }}
 */
export function resolveDesignMaterial(design, id) {
    if (!id) return { material: getMaterial('Air'), status: 'unset' };

    const record = design?.materials?.[id] ?? herpinRecordFromLayers(design, id);
    const registered = getMaterialById(id);
    const conflict = !!registered && fromAnotherCatalog(record, id, registered);
    if (registered && !conflict) return { material: registered, status: 'catalog' };
    if (record) return fromRecord(record, conflict);

    // Reachable before initCatalogs runs, when the registry is still empty.
    const legacy = MATERIAL_MAP[id];
    return legacy ? { material: legacy, status: 'catalog' } : { material: getMaterial('Air'), status: 'missing' };
}

// resolveDesignMaterial's answer for the definition the design carries.
function fromRecord(record, conflict) {
    const material = embeddedMaterial(record);
    if (!material) return { material: getMaterial('Air'), status: 'missing' };
    return conflict ? { material, status: 'embedded', conflict } : { material, status: 'embedded' };
}

/**
 * A memoized `(id) => material` bound to one design. This is what evaluation code
 * should use: it falls back to the definitions the design carries, which a bare
 * id lookup cannot, and refuses to turn an unresolved id into an optical result.
 */
export function designMaterialLookup(design) {
    const cache = new Map();
    return (id) => {
        if (!cache.has(id)) {
            const resolved = resolveDesignMaterial(design, id);
            if (resolved.status === 'missing') throw new UnresolvedDesignMaterialError(id);
            cache.set(id, resolved.material);
        }
        return cache.get(id);
    };
}

/**
 * The ids `design` computes with a copy of its own while a catalog here holds
 * the id with other n,k (`conflict` above), among the ids it uses and the
 * copies it carries. In this design the id means its copy, so that catalog's
 * material is not offered for it.
 */
export function conflictingIds(design) {
    const ids = new Set([...designMaterialIds(design), ...Object.keys(design?.materials || {})]);
    return new Set([...ids].filter(id => resolveDesignMaterial(design, id).conflict));
}

/** Every distinct material id a design references, media and substrate included. */
export function designMaterialIds(design) {
    if (!design) return [];
    const ids = [
        design.incidentMedium,
        design.exitMedium,
        design.substrate?.material,
        ...(design.frontLayers || []).map(layer => layer.material),
        ...(design.backLayers || []).map(layer => layer.material),
    ];
    return [...new Set(ids.filter(Boolean))];
}

/**
 * The ids a save has to write a definition for: the ones the design computes
 * with, and the ones inside its Herpin layers, which Expand brings back.
 */
export function savedMaterialIds(design) {
    const inside = [...(design.frontLayers || []), ...(design.backLayers || [])]
        .flatMap(layer => layer.herpin?.originalLayers || [])
        .map(layer => layer.material);
    return [...new Set([...designMaterialIds(design), ...inside.filter(Boolean)])];
}

/**
 * The definition a save writes for `id`, or null when there is none: the
 * catalog's current one with its catalog's stamp, else the one the design
 * carries, written back as it came even when it cannot be computed here (it is
 * still the author's data, for a program that can read it).
 */
export function savedMaterialRecord(design, id) {
    const { material, status } = resolveDesignMaterial(design, id);
    if (status === 'catalog') {
        const uid = localCatalogUid(id);
        return { ...stripGetNK(material), ...(uid ? { catalogUid: uid } : {}) };
    }
    if (status === 'embedded') return stripGetNK(material);
    return design?.materials?.[id] ?? null;
}

/** Ids the design references that resolve neither to an embedded definition nor a catalog. */
export function unresolvedMaterials(design) {
    return designMaterialIds(design)
        .filter(id => resolveDesignMaterial(design, id).status === 'missing');
}

/**
 * Return the design with a `materials` block holding the definition of every
 * non-built-in material it references: the form written to a .tfs file.
 *
 * The block is rebuilt from the design's current ids, so materials no longer
 * referenced drop out, and a design that uses only built-ins carries no block at
 * all. Each material is written as savedMaterialRecord gives it, so a
 * catalog's current definition replaces an older one the design carried.
 * Materials that resolve nowhere have no definition to embed and are left for
 * `unresolvedMaterials` to report.
 */
export function embedDesignMaterials(design) {
    if (!design) return design;

    const materials = {};
    for (const id of savedMaterialIds(design)) {
        if (isBuiltinId(id)) continue;
        const record = savedMaterialRecord(design, id);
        if (record) materials[id] = record;
    }

    // eslint-disable-next-line no-unused-vars
    const { materials: previous, ...rest } = design;
    return Object.keys(materials).length > 0 ? { ...rest, materials } : rest;
}
