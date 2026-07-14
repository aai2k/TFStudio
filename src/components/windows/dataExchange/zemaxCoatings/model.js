import { addCatalog } from '../../../../utils/materials/catalogManager.js';
import { mateToTfMaterial, sanitizeZemaxName } from '../../../../utils/io/zemaxCoatingFile.js';

export function catalogIdFor(fileName) {
    const base = (fileName || 'coating').replace(/\.[^.]*$/, '');
    return { id: 'zemax_' + sanitizeZemaxName(base).toLowerCase(), name: 'Zemax ' + base };
}

export function buildMaterialRegistration(materials, fileName, onlyNames) {
    const { id: catId, name: catName } = catalogIdFor(fileName);
    const cat = { id: catId, name: catName, source: 'user', materials: {} };
    const nameMap = {};
    const usedIds = {};

    for (const material of materials) {
        if (onlyNames && !onlyNames.has(material.name.toUpperCase())) continue;
        const tfMaterial = mateToTfMaterial(material, { comment: `Imported from ${fileName}` });
        let materialId = tfMaterial.id || 'material';
        let suffix = 2;
        while (usedIds[materialId]) materialId = (tfMaterial.id || 'material') + '_' + suffix++;
        usedIds[materialId] = true;
        tfMaterial.id = materialId;
        cat.materials[materialId] = tfMaterial;
        nameMap[material.name.toUpperCase()] = `${catId}:${materialId}`;
    }

    return { cat, catId, catName, nameMap, count: Object.keys(cat.materials).length };
}

export function registerMaterials(materials, fileName, onlyNames) {
    const registration = buildMaterialRegistration(materials, fileName, onlyNames);
    addCatalog(registration.cat);
    return registration;
}

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
