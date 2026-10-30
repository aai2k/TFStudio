import { getCatalogs } from '../../../../utils/materials/catalogManager.js';
import { designMaterialLookup, isBuiltinId, resolveDesignMaterial } from '../../../../utils/materials/designMaterials.js';
import {
    buildGrid, generateZemaxCoating, sanitizeZemaxName, tfLayersToCoat, tfMaterialToMate,
} from '../../../../utils/io/zemaxCoatingFile.js';

function collectAllMaterialIds(catalogs) {
    const ids = new Set();
    for (const catalog of Object.values(catalogs || {})) {
        for (const materialId of Object.keys(catalog.materials || {})) {
            ids.add(`${catalog.id}:${materialId}`);
        }
    }
    return [...ids];
}

function collectUsedMaterialIds(design) {
    const ids = new Set();
    for (const layer of (design.frontLayers || [])) if (layer.material) ids.add(layer.material);
    for (const layer of (design.backLayers || [])) if (layer.material) ids.add(layer.material);
    if (design.substrate?.material) ids.add(design.substrate.material);
    if (design.incidentMedium) ids.add(design.incidentMedium);
    if (design.exitMedium) ids.add(design.exitMedium);
    return [...ids];
}

export function collectExportMaterialIds(design, scope, catalogs) {
    return scope === 'all' ? collectAllMaterialIds(catalogs) : collectUsedMaterialIds(design);
}

// A built-in material stored bare ('TiO2', as synthesis inserts it and old
// files have it) is the one the catalogs list as 'builtin:TiO2'. Both spellings
// get one MATE record and one name.
const canonicalId = (id) => (!id.includes(':') && isBuiltinId(id) ? `builtin:${id}` : id);

// The ids to write a MATE record for. Scope "all" adds the materials the design
// carries itself (from another computer, a deleted catalog, a Herpin layer) to
// the catalogs' ones, since its layers are written too. A catalog entry with no
// n,k here (an empty table) is left out unless the design uses it: it cannot be
// written, and the design does not need it.
function exportMaterialIds(design, scope) {
    const used = [...new Set(collectExportMaterialIds(design, 'used').map(canonicalId))];
    if (scope !== 'all') return used;
    const own = used.filter(id => resolveDesignMaterial(design, id).status !== 'catalog');
    const catalogs = collectExportMaterialIds(design, 'all', getCatalogs())
        .filter(id => used.includes(id) || resolveDesignMaterial(design, id).status !== 'missing');
    return [...new Set([...catalogs, ...own])];
}

/**
 * The layers of one side in the order a COAT lists them, incident medium side
 * first: the front as frontLayers are stored; the back from the exit medium to
 * the substrate, which is backLayers reversed, since they are stored substrate
 * side first. Either way the file means air to glass.
 */
export function coatSideLayers(design, side = 'front') {
    return side === 'back' ? [...(design.backLayers || [])].reverse() : (design.frontLayers || []);
}

/**
 * The COATING.DAT text of one side of `design`, with the MATE records and the
 * COAT record it holds. Every material is resolved through the design, the way
 * the design computes it: the catalog here first, then the definition the
 * design carries. An id that resolves nowhere throws
 * UnresolvedDesignMaterialError rather than being written as n = 1, k = 0.
 *
 * @param {object} args
 * @param {object} args.design
 * @param {number} args.gStart  first wavelength of the MATE grid, nm
 * @param {number} args.gEnd  last wavelength of the MATE grid, nm
 * @param {number} args.gStep  grid step, nm
 * @param {'used'|'all'} args.scope  the materials the design uses, or every catalog material as well
 * @param {string} args.coatName  name of the COAT record
 * @param {'absolute'|'relative'} args.thMode  thickness in µm, or in waves of λ₀
 * @param {number} args.refNm  λ₀ for relative thicknesses, nm
 * @param {'front'|'back'} [args.side='front']  the side written, as coatSideLayers orders it
 * @returns {{ text: string, materials: object[], coating: object }}
 */
export function buildCoatingText({ design, gStart, gEnd, gStep, scope, coatName, thMode, refNm, side = 'front' }) {
    const lookup = designMaterialLookup(design);
    const grid = buildGrid(gStart, gEnd, gStep);
    const nameOf = makeZemaxNameResolver((id) => lookup(id).name || id);
    const zemaxName = (id) => nameOf(canonicalId(id));
    const materials = exportMaterialIds(design, scope).map((id) =>
        tfMaterialToMate(zemaxName(id), (wavelengthNm) => lookup(id).getNK(wavelengthNm), grid));
    const coating = tfLayersToCoat(coatName, coatSideLayers(design, side), {
        zemaxName,
        mode: thMode,
        refWavelengthUm: refNm / 1000,
        realIndex: (id, wavelengthNm) => lookup(id).getNK(wavelengthNm)[0],
    });
    return { text: generateZemaxCoating({ materials, coatings: [coating] }), materials, coating };
}

export function makeZemaxNameResolver(materialName) {
    const usedNames = {};
    const idToName = {};
    return (id) => {
        if (idToName[id]) return idToName[id];
        let name = sanitizeZemaxName(materialName(id));
        const base = name;
        let suffix = 2;
        while (usedNames[name] && usedNames[name] !== id) {
            name = base.slice(0, 30) + '_' + suffix++;
        }
        usedNames[name] = id;
        idToName[id] = name;
        return name;
    };
}

export function applyImportedLayers(layers, checkpoint, updateDesign) {
    checkpoint();
    updateDesign({ frontLayers: layers });
}

export function mateRealIndexAt(material, refNm) {
    if (!material || !material.points.length) return null;
    const points = material.points;
    const wavelengthUm = refNm / 1000;
    if (wavelengthUm <= points[0][0]) return points[0][1];
    if (wavelengthUm >= points[points.length - 1][0]) return points[points.length - 1][1];
    let low = 0;
    let high = points.length - 1;
    while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (points[middle][0] <= wavelengthUm) low = middle;
        else high = middle;
    }
    const fraction = (wavelengthUm - points[low][0]) / (points[high][0] - points[low][0]);
    return points[low][1] + fraction * (points[high][1] - points[low][1]);
}

export function coatLayerThkNm(layer, materialsByName, refNm) {
    if (layer.isAbsolute) return layer.thickness * 1000;
    const n0 = mateRealIndexAt(materialsByName[layer.material.toUpperCase()], refNm);
    return n0 > 0 ? (layer.thickness * (refNm / 1000) / n0) * 1000 : NaN;
}
