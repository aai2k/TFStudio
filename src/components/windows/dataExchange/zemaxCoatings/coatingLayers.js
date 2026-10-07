/**
 * The selected COAT of a loaded COATING.DAT as TFStudio layers, for the import
 * to the front coating and for Save to Coating Library.
 */

import { getNKById } from '../../../../utils/materials/catalogManager.js';
import { makeGetNK } from '../../../../utils/materials/catalogManager/dispersion.js';
import { isBuiltinId, savedMaterialRecord } from '../../../../utils/materials/designMaterials.js';
import { coatToTfLayers } from '../../../../utils/io/zemaxCoatingFile.js';
import { buildMaterialRegistration, registerMaterials, rowsNamed } from './catalogImport.js';

/**
 * Convert the selected COAT to the layers of a front coating: incident side
 * first, as the file lists them, physical thickness in nm, each material under
 * the id the import gives it in the catalog of the file.
 *
 * The layers use the materials the catalog holds, edits included; a relative
 * thickness is converted with the index the file gives, as Zemax converts it.
 * A layer naming a material the file defines more than once takes the last
 * record of that name. With `write` the materials the layers name are
 * registered in the catalog, as an import does. Without it nothing is written:
 * a file imported before keeps the ids of its catalog, and one never imported
 * gets ids in the catalog a first import would make, whose random part (see
 * catalogIdFor) is drawn anew each time.
 *
 * @returns {{ coating, layers, warnings, registration } | { error: string }}
 */
export function convertSelectedCoating({ z, doc, selCoating, fileName, filePath, refNm }, { write }) {
    const coating = doc?.coatings?.[selCoating];
    if (!coating || coating.type !== 'layers') return { error: z.importNotStack };

    const neededNames = new Set(coating.layers.map((layer) => layer.material.toUpperCase()));
    const register = write ? registerMaterials : buildMaterialRegistration;
    const registration = register(doc.materials, fileName, rowsNamed(doc.materials, neededNames), filePath);
    const { nameMap, fileRecords } = registration;
    const resolveId = (zemaxName) => nameMap[zemaxName.toUpperCase()] || (/^AIR$/i.test(zemaxName) ? 'Air' : null);
    const { layers, warnings } = coatToTfLayers(coating, {
        refWavelengthUm: refNm / 1000,
        materialId: resolveId,
        realIndex: (zemaxName, wavelengthNm) => {
            const record = fileRecords[zemaxName.toUpperCase()];
            if (record) return makeGetNK(record)(wavelengthNm)[0];
            const id = resolveId(zemaxName);
            return id ? getNKById(id, wavelengthNm)[0] : 0;
        },
    });
    if (!layers.length) return { error: warnings[0] || z.importNotStack };
    return { coating, layers, warnings, registration };
}

// The records behind the layers' ids in the file's catalog, as the import
// would hold them there.
function catalogRecords(layers, { catId, cat }) {
    const prefix = `${catId}:`;
    const records = {};
    for (const { material } of layers) {
        if (material.startsWith(prefix)) records[material] = cat.materials[material.slice(prefix.length)];
    }
    return records;
}

// The definitions a save of `design` writes for these of its ids, the ones no
// built-in serves.
function designRecords(design, ids) {
    const records = {};
    for (const id of ids) {
        const record = id && !isBuiltinId(id) ? savedMaterialRecord(design, id) : null;
        if (record) records[id] = record;
    }
    return records;
}

/**
 * The selected COAT as the coating the Save Coating dialog takes.
 *
 * A COAT record names no media, so the coating lies between the active
 * design's incident medium and substrate. Every layer material takes its id as
 * convertSelectedCoating gives it without writing, and carries the record the
 * import would hold under that id, so the saved coating computes on a computer
 * that never imported the file. Nothing is written to a catalog.
 *
 * @returns {{ coating: object, warnings: string[] } | { error: string }}
 */
export function libraryCoating(args) {
    const converted = convertSelectedCoating(args, { write: false });
    if (converted.error) return converted;
    const { z, design, fileName, refNm } = args;
    const { coating, layers, warnings, registration } = converted;
    const incidentMedium = design.incidentMedium;
    const substrate = design.substrate?.material;
    return {
        warnings,
        coating: {
            name: coating.name,
            source: z.librarySource(coating.name, fileName),
            layers: layers.map(({ material, thickness }) => ({ material, thickness })),
            materials: { ...catalogRecords(layers, registration), ...designRecords(design, [incidentMedium, substrate]) },
            incidentMedium, substrate,
            referenceWavelength: refNm,
        },
    };
}
