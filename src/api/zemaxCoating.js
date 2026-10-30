// Zemax OpticStudio COATING.DAT files: written as the Zemax Coatings window's
// Export tab writes them, read as its Materials and Coatings tabs list them,
// and a COAT's layers put on a design as its import puts them.

import path from 'node:path';
import { buildCoatingText, coatLayerThkNm, coatSideLayers } from '../components/windows/dataExchange/zemaxCoatings/model.js';
import { fileMaterialNames } from '../components/windows/dataExchange/zemaxCoatings/catalogImport.js';
import { catalogRecords, convertSelectedCoating } from '../components/windows/dataExchange/zemaxCoatings/coatingLayers.js';
import { mateToTfMaterial, parseZemaxCoating } from '../utils/io/zemaxCoatingFile.js';
import { requireResolved } from './materials.js';
import { scoredSide } from './stackViews.js';
import { openSideKey } from './stack.js';
import { checkOptions, checkRange, isPositive, refusal, requireValue } from './check.js';
import { coatingFilePath, importFilePath, readCoatingText, refuseExisting, withImportedLayers, writeCoatingText } from './coatingFiles.js';
import en from '../constants/locales/en.js';

const z = en.zemaxCoatings;

const SAVE_OPTIONS = ['name', 'thickness', 'wavelength', 'from', 'to', 'step', 'scope', 'side', 'overwrite'];

/**
 * Writes one side of a design to a Zemax OpticStudio COATING.DAT file as the
 * [Zemax Coatings](/data-exchange/zemax-coatings/) window's Export tab writes
 * it: a MATE record for each material, n and k sampled every `step` nm from
 * `from` to `to` and written in µm with the imaginary index as -k, as Zemax
 * takes it, then one COAT record of the side's layers. A COAT lists its layers
 * from the incident medium side, so the back is written from the exit medium
 * to the substrate: on either face the file means air to glass.
 *
 * @param design The design.
 * @param filePath The file to write, by its full path.
 * @param [options]
 * @param [options.name='TFSTUDIO_DESIGN'] The name of the COAT record, written in capitals, every character but letters, digits, `_` and `.` as `_`, and cut to 32 characters.
 * @param [options.thickness='absolute'] `'absolute'`, each layer's physical thickness in µm; or `'relative'`, its optical thickness in waves of `wavelength`, which Zemax converts back with the index the file gives.
 * @param [options.wavelength=550] λ₀, nm, for relative thicknesses.
 * @param [options.from=400] The first wavelength of the MATE records, nm.
 * @param [options.to=800] The last wavelength of the MATE records, nm, above `from`.
 * @param [options.step=25] The step of the MATE records, nm.
 * @param [options.scope='used'] `'used'`, the materials the design uses, its media and substrate included; or `'all'`, every material of the catalogs here as well.
 * @param [options.side] `'front'` or `'back'`; without it, the front, or the back of a design coated on the back alone.
 * @param [options.overwrite=false] Write over a file that is already there, as the window's save dialog asks before it does.
 * @throws a side with no layers
 * @throws an option it does not take, a value an option cannot take, a from and to that are not a range, or a file that is already there, without `overwrite`
 * @throws a design that names a material that resolves to nothing
 * @example
 * const file = require('path').join(require('os').homedir(), `COATING-${Date.now()}.DAT`);
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: '0.5H L' });
 * tf.saveZemaxCoating(design, file, { name: 'AR', thickness: 'relative' });
 * const text = require('fs').readFileSync(file, 'utf8');
 * console.log(text.slice(text.indexOf('COAT')));
 */
export function saveZemaxCoating(design, filePath, options) {
    const call = 'saveZemaxCoating';
    const file = coatingFilePath(call, filePath);
    const {
        name = 'TFSTUDIO_DESIGN', thickness = 'absolute', wavelength = 550, from = 400, to = 800, step = 25, scope = 'used',
        side, overwrite = false,
    } = checkOptions(call, options, SAVE_OPTIONS);
    requireValue(call, 'name', name, v => typeof v === 'string', 'the name of the COAT record');
    requireValue(call, 'thickness', thickness, v => v === 'absolute' || v === 'relative', "'absolute' or 'relative'");
    requireValue(call, 'wavelength', wavelength, isPositive, 'a wavelength in nm above 0');
    checkRange(call, { from, to, step });
    requireValue(call, 'scope', scope, v => v === 'used' || v === 'all', "'used' or 'all'");
    const written = scoredSide(call, design, side);
    if (!coatSideLayers(design, written).length) throw refusal('emptySide', { call, side: written }, `${call}: the ${written} has no layers`);
    requireResolved(design);
    refuseExisting(call, file, overwrite);
    const { text } = buildCoatingText({
        design, gStart: from, gEnd: to, gStep: step, scope, coatName: name, thMode: thickness, refNm: wavelength, side: written,
    });
    writeCoatingText(file, text);
}

// The file read and parsed, after refusing one that holds neither a MATE
// record nor a coating, as the window's open refuses it.
function readCoatingFile(call, file) {
    const doc = parseZemaxCoating(readCoatingText(call, file));
    if (!doc.materials.length && !doc.coatings.length) throw new Error(`${call}: ${file}: ${z.errParse}`);
    return doc;
}

// The Coatings tab's Type column: a layer stack, or a COAT that holds no layers.
const COAT_TYPES = { layers: 'stack', idealI: 'ideal', ideal: 'ideal', ideal2: 'ideal', table: 'table', encrypted: 'encrypted' };

// A MATE record as the Materials tab lists it, its rows as the import holds them.
function materialRow(material, { name, repeat }) {
    const rows = material.points.length ? mateToTfMaterial(material).tabData : [];
    return {
        name: material.name, repeat, importedAs: name,
        wavelength: rows.map(row => row[0]), n: rows.map(row => row[1]), k: rows.map(row => row[2]),
    };
}

// A COAT record as the Coatings tab lists it: a layer naming a material the
// file defines more than once is shown with the last record of that name.
function coatingRow(coating, materialsByName, wavelength) {
    const type = COAT_TYPES[coating.type] ?? coating.type;
    if (coating.type !== 'layers') return { name: coating.name, type, layers: null };
    const layers = coating.layers.map((layer) => {
        const thickness = coatLayerThkNm(layer, materialsByName, wavelength);
        return {
            material: layer.material, thickness: Number.isFinite(thickness) ? thickness : null,
            fileThickness: layer.thickness, mode: layer.isAbsolute ? 'absolute' : 'relative',
        };
    });
    return { name: coating.name, type, layers };
}

/**
 * Reads a Zemax OpticStudio COATING.DAT file as the
 * [Zemax Coatings](/data-exchange/zemax-coatings/) window lists it: its MATE
 * records, as the Materials tab lists them, and its coatings, as the Coatings
 * tab lists them. A relative thickness is given in nm at `wavelength`, the
 * window's λ₀, with the index the file's MATE table gives.
 * Nothing is written to a catalog.
 *
 * @param filePath The file, by its full path.
 * @param [options]
 * @param [options.wavelength=550] λ₀, nm, at which a thickness the file gives in waves is converted to nm.
 * @returns The file's materials and coatings.
 * @property fileName The file's name, without its folder.
 * @property materials Each MATE record, in the file's order.
 * @property materials[].name Its name in the file.
 * @property materials[].repeat For a name the file defines more than once, which record of it this is, `{ index, count }`, from 1; null for a name defined once.
 * @property materials[].importedAs The name an import gives it: its own, or for a later record of a repeated name its own followed by ` (2)`, ` (3)`, ...
 * @property materials[].wavelength The wavelengths of its rows, nm, rising.
 * @property materials[].n n at each wavelength.
 * @property materials[].k k at each wavelength: the file's imaginary index with its sign turned, a positive one read as 0.
 * @property coatings Each COAT record, in the file's order.
 * @property coatings[].name Its name.
 * @property coatings[].type `'stack'`, a stack of layers, the only kind that imports to a design; or `'ideal'`, `'table'` or `'encrypted'`, which hold no layers.
 * @property coatings[].layers A stack's layers, incident medium side first; null for the other kinds.
 * @property coatings[].layers[].material The name of the layer's MATE record, as the file writes it.
 * @property coatings[].layers[].thickness Its physical thickness, nm; null for a relative thickness whose material the file gives no index for.
 * @property coatings[].layers[].fileThickness The thickness the file writes: µm, or waves of λ₀.
 * @property coatings[].layers[].mode `'absolute'` or `'relative'`, how the file writes it.
 * @throws a file that cannot be read, or holds neither a MATE record nor a coating
 * @throws an option it does not take, or a value an option cannot take
 * @example
 * const file = require('path').join(require('os').homedir(), `COATING-${Date.now()}.DAT`);
 * require('fs').writeFileSync(file, 'MATE TIO2\n0.4 2.35 0\n0.8 2.25 0\nMATE SIO2\n0.4 1.47 0\n0.8 1.45 0\nCOAT AR\nTIO2 0.25 0\nSIO2 0.25 0\n');
 * const read = tf.readZemaxCoating(file);
 * for (const layer of read.coatings[0].layers) console.log(layer.material, layer.thickness.toFixed(2), 'nm');
 */
export function readZemaxCoating(filePath, options) {
    const call = 'readZemaxCoating';
    const file = coatingFilePath(call, filePath);
    const { wavelength = 550 } = checkOptions(call, options, ['wavelength']);
    requireValue(call, 'wavelength', wavelength, isPositive, 'a wavelength in nm above 0');
    const doc = readCoatingFile(call, file);
    const names = fileMaterialNames(doc.materials);
    const materialsByName = Object.fromEntries(doc.materials.map(material => [material.name.toUpperCase(), material]));
    return {
        fileName: path.basename(file),
        materials: doc.materials.map((material, row) => materialRow(material, names[row])),
        coatings: doc.coatings.map(coating => coatingRow(coating, materialsByName, wavelength)),
    };
}

// The place of the coating `coating` names, by its name in any case or by its
// place from 0; without it the first layer stack, as the window selects it.
function coatingPlace(call, coatings, coating) {
    if (coating === undefined) return coatings.findIndex(found => found.type === 'layers');
    if (Number.isInteger(coating) && coating >= 0 && coating < coatings.length) return coating;
    const wanted = String(coating).toUpperCase();
    const places = coatings.flatMap((found, place) => (found.name.toUpperCase() === wanted ? [place] : []));
    requireValue(call, 'coating', coating, () => places.length > 0,
        `the name of a coating of the file or its place from 0: ${coatings.map(found => found.name).join(', ') || 'it holds none'}`);
    if (places.length > 1) throw new Error(`${call}: the file holds ${places.length} coatings named '${coating}'; give its place from 0`);
    return places[0];
}

/**
 * Puts the layers of a COAT record of a Zemax OpticStudio COATING.DAT file
 * on one side of a design, as the
 * [Zemax Coatings](/data-exchange/zemax-coatings/) window's Import to front
 * coating puts them on the front: physical thickness in nm, a relative
 * thickness converted at `wavelength` with the index the file gives. A COAT
 * lists its layers from the incident medium, so on the back they go in
 * reversed, the file's incident medium facing the exit side. The side's
 * layers are replaced; the media and the substrate stay the design's. Each
 * layer's material takes the id an import in the app gives it, in the catalog
 * of the file, and the design carries its definition: nothing is written to a
 * catalog. On a computer where the app imported the file before, the ids are
 * that catalog's and the materials it holds are used, edits included, as the
 * window uses them; otherwise each call draws a new random part of the
 * catalog id, as a first import does.
 *
 * @param design The design.
 * @param filePath The file, by its full path.
 * @param [options]
 * @param [options.coating] The COAT record, by its name or its place among the file's coatings from 0; without it, the first stack of layers.
 * @param [options.wavelength=550] λ₀, nm, at which a thickness the file gives in waves is converted to nm.
 * @param [options.side] `'front'` or `'back'`; without it, the front, or the back of a design coated on the back alone.
 * @returns The design with the layers, and what the conversion noted.
 * @property design The design with the coating on the side.
 * @property warnings The layers left out, each with why: a material the file does not define, or a relative thickness whose material it gives no index for.
 * @throws a file that cannot be read, or holds neither a MATE record nor a coating
 * @throws a coating the file does not hold, one that is not a stack of layers, or one none of whose layers converts
 * @throws a side the Design Editor does not let you edit: the back of a symmetric design, or the other side of a design coated on one side and scored on that side
 * @throws an option it does not take, or a value an option cannot take
 * @example
 * const file = require('path').join(require('os').homedir(), `COATING-${Date.now()}.DAT`);
 * require('fs').writeFileSync(file, 'MATE TIO2\n0.4 2.35 0\n0.8 2.25 0\nMATE SIO2\n0.4 1.47 0\n0.8 1.45 0\nCOAT AR\nTIO2 0.25 0\nSIO2 0.25 0\n');
 * const { design } = tf.importZemaxCoating(tf.newDesign({ name: 'AR' }), file);
 * for (const layer of design.frontLayers) console.log(layer.material, layer.thickness.toFixed(2), 'nm');
 * console.log('R at 550 nm', tf.spectrum(design, { from: 550, to: 551 }).angles[0].R[0]);
 * const twoSided = tf.setDesignSetup(design, { surfaceMode: 'both_independent' });
 * const onBack = tf.importZemaxCoating(twoSided, file, { side: 'back' }).design;
 * console.log('back, substrate side first:', onBack.backLayers.map(layer => layer.material).join(', '));
 */
export function importZemaxCoating(design, filePath, options) {
    const call = 'importZemaxCoating';
    const file = importFilePath(call, filePath, 'zemax_');
    const { coating, wavelength = 550, side } = checkOptions(call, options, ['coating', 'wavelength', 'side']);
    requireValue(call, 'wavelength', wavelength, isPositive, 'a wavelength in nm above 0');
    const onto = scoredSide(call, design, side);
    const key = openSideKey(call, design, onto);
    const doc = readCoatingFile(call, file);
    const selCoating = coatingPlace(call, doc.coatings, coating);
    const converted = convertSelectedCoating({ z, doc, selCoating, fileName: path.basename(file), filePath: file, refNm: wavelength }, { write: false });
    if (converted.error) throw new Error(`${call}: ${converted.error}`);
    const { layers, warnings, registration } = converted;
    // backLayers are kept substrate side first, the reverse of the file's order.
    const sideLayers = onto === 'back' ? [...layers].reverse() : layers;
    return { design: withImportedLayers(design, key, sideLayers, catalogRecords(layers, registration)), warnings };
}
