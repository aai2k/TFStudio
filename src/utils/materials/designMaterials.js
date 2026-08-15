/**
 * Design-scoped material resolution.
 *
 * A design references materials by id (`builtin:SiO2`, `user_hr:Ta2O5`,
 * `agf:N-BK7`). Ids outside the built-in library resolve only against catalogs
 * held on the machine that created them, so a design loses those materials when
 * it travels to another installation — or when its catalog is renamed or
 * deleted locally. Resolving such an id to Air yields a plausible spectrum for a
 * coating nobody designed, so resolution reports it as `missing` instead.
 *
 * A design therefore carries the dispersion definition of every non-built-in
 * material it uses in a `materials` block, and resolution prefers that block
 * over the local catalogs: the file reproduces what its author computed, which
 * is the point of sending it.
 *
 * Built-in materials are referenced by id, never embedded. Their dispersion is
 * JavaScript in materialDatabase.js rather than data, so embedding one would
 * mean resampling it into a table — an approximation of a material every
 * installation already holds exactly.
 */
import { getMaterialById } from './catalogManager.js';
import { makeGetNK } from './catalogManager/dispersion.js';
import { stripGetNK } from './catalogManager/persistence.js';
import { getMaterial, MATERIAL_MAP } from './materialDatabase.js';
import { hasTabulatedComponent, TABULATED_INTERPOLATION } from './pchip.js';

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

function embeddedMaterial(record) {
    let material = embeddedCache.get(record);
    if (!material) {
        material = {
            ...record,
            ...(hasTabulatedComponent(record) ? { interp: TABULATED_INTERPOLATION } : {}),
            getNK: makeGetNK(record),
        };
        embeddedCache.set(record, material);
    }
    return material;
}

/**
 * True for ids the built-in library serves: the `builtin:` prefix, or a bare
 * legacy name such as `BK7` from designs saved before compound ids existed.
 */
export function isBuiltinId(id) {
    return id.startsWith('builtin:') || !id.includes(':');
}

/**
 * Resolve one material id against a design.
 *
 * `missing` still carries Air as its material so callers can render a layer
 * list without crashing, but it must not be treated as a result — see
 * `unresolvedMaterials`.
 *
 * @returns {{ material: Object, status: 'embedded'|'catalog'|'missing'|'unset' }}
 */
export function resolveDesignMaterial(design, id) {
    if (!id) return { material: getMaterial('Air'), status: 'unset' };

    const record = design?.materials?.[id];
    if (record) return { material: embeddedMaterial(record), status: 'embedded' };

    const registered = getMaterialById(id);
    if (registered) return { material: registered, status: 'catalog' };

    // Reachable before initCatalogs runs, when the registry is still empty.
    const legacy = MATERIAL_MAP[id];
    if (legacy) return { material: legacy, status: 'catalog' };

    return { material: getMaterial('Air'), status: 'missing' };
}

/**
 * A memoized `(id) => material` bound to one design. This is what evaluation code
 * should use: it applies the embedded-definitions-first precedence that a bare id
 * lookup cannot, and refuses to turn an unresolved id into an optical result.
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

/** Ids the design references that resolve neither to an embedded definition nor a catalog. */
export function unresolvedMaterials(design) {
    return designMaterialIds(design)
        .filter(id => resolveDesignMaterial(design, id).status === 'missing');
}

/**
 * Return the design with a `materials` block holding the definition of every
 * non-built-in material it references — the form written to a .tfs file.
 *
 * The block is rebuilt from the design's current ids, so materials no longer
 * referenced drop out, and a design that uses only built-ins carries no block at
 * all. Materials that cannot be resolved have no definition to embed and are
 * left for `unresolvedMaterials` to report.
 */
export function embedDesignMaterials(design) {
    if (!design) return design;

    const materials = {};
    for (const id of designMaterialIds(design)) {
        if (isBuiltinId(id)) continue;
        const { material, status } = resolveDesignMaterial(design, id);
        if (status !== 'missing') materials[id] = stripGetNK(material);
    }

    // eslint-disable-next-line no-unused-vars
    const { materials: previous, ...rest } = design;
    return Object.keys(materials).length > 0 ? { ...rest, materials } : rest;
}
