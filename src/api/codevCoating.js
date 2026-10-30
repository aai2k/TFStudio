// CODE V MULTILAYER coatings: the .seq command file written as the CODE V
// Coatings window's Export tab writes it, a .seq or a .mul read as its Import
// tab shows it, and the file's layers put on a design as its import puts them.

import path from 'node:path';
import { analysisWavelengths, buildDesignSeq, sideStack } from '../components/windows/dataExchange/codevCoatings/exportModel.js';
import { fileNumber, importedLayers } from '../components/windows/dataExchange/codevCoatings/fileStack.js';
import { exportErrorText, parseErrorText, warningText } from '../components/windows/dataExchange/codevCoatings/messages.js';
import { CodevExportError, CodevParseError, CODEV_LIMITS, parseCodevMul, parseCodevSeq } from '../utils/io/codevCoatingFile.js';
import { requireResolved } from './materials.js';
import { scoredSide } from './stackViews.js';
import { openSideKey } from './stack.js';
import { checkOptions, checkRange, isAngle, isPositive, refusal, requireValue } from './check.js';
import { coatingFilePath, importFilePath, readCoatingText, refuseExisting, withImportedLayers, writeCoatingText } from './coatingFiles.js';
import en from '../constants/locales/en.js';

const z = en.codevCoatings;

const SAVE_OPTIONS = ['title', 'saveName', 'from', 'to', 'step', 'angles', 'wavelength', 'side', 'overwrite'];

const isText = v => typeof v === 'string';
const isAngleList = v => Array.isArray(v) && v.length > 0 && v.every(isAngle);

// The .seq of the side, or the window's message for a limit of the MUL option it passes.
function designSeq(call, design, settings) {
    try {
        return buildDesignSeq(design, settings);
    } catch (err) {
        if (err instanceof CodevExportError) throw new Error(`${call}: ${exportErrorText(z, err)}`);
        throw err;
    }
}

/**
 * Writes one side of a design to a CODE V .seq command file as the
 * [CODE V Coatings](/data-exchange/codev-coatings/) window's Export tab writes
 * it: the commands that enter the stack in the MULTILAYER option's MDA, a MIC
 * table of each material's n and k at the analysis wavelengths (up to 21 of
 * them), and SAV, which has CODE V save it as a .mul. Thicknesses are in nm
 * (PHT Y), incident medium side first, layers of zero thickness left out. The
 * back is written from the exit medium to the substrate, as CODE V takes a
 * glass and air surface on either face.
 *
 * @param design The design.
 * @param filePath The file to write, by its full path.
 * @param [options]
 * @param [options.title] TIT, the stack's title, cut to 80 characters, single quotes left out; without it, the design's name.
 * @param [options.saveName] The name SAV saves the .mul under, each run of characters but letters, digits, `_` and `-` written as one `_`; without it, the design's name.
 * @param [options.from=400] The first analysis wavelength, nm.
 * @param [options.to=800] The last analysis wavelength, nm, above `from`.
 * @param [options.step=10] The step of the analysis wavelengths, nm; CODE V takes 100 of them at most.
 * @param [options.angles=[0]] ANG, the angles of incidence in degrees, 0 or more and below 90; CODE V takes 5 at most.
 * @param [options.wavelength] REF, the reference wavelength, nm; without it, the design's reference wavelength.
 * @param [options.side] `'front'` or `'back'`; without it, the front, or the back of a design coated on the back alone.
 * @param [options.overwrite=false] Write over a file that is already there, as the window's save dialog asks before it does.
 * @returns What the writer noted, as the window lists it under the text: a material sampled on fewer wavelengths than it has, or an absorbing medium written without its k.
 * @throws a side with no layers, or a stack past a limit of the MUL option: 1000 layers, 100 wavelengths, 5 angles
 * @throws an option it does not take, a value an option cannot take, a from and to that are not a range, or a file that is already there, without `overwrite`
 * @throws a design that names a material that resolves to nothing
 * @example
 * const file = require('path').join(require('os').homedir(), `ar-${Date.now()}.seq`);
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: '0.5H L' });
 * tf.saveCodevCoating(design, file, { angles: [0, 45] });
 * const text = require('fs').readFileSync(file, 'utf8');
 * console.log(text.split('\n').filter(line => /^(TIT|ANG|COA|SUB|SAV)/.test(line.trim())).join('\n'));
 */
export function saveCodevCoating(design, filePath, options) {
    const call = 'saveCodevCoating';
    const file = coatingFilePath(call, filePath);
    const {
        title = design.name || '', saveName = design.name || '', from = 400, to = 800, step = 10, angles = [0],
        wavelength = design.referenceWavelength || 550, side, overwrite = false,
    } = checkOptions(call, options, SAVE_OPTIONS);
    requireValue(call, 'title', title, isText, 'the title of the stack');
    requireValue(call, 'saveName', saveName, isText, 'the name SAV saves the .mul under');
    checkRange(call, { from, to, step });
    requireValue(call, 'angles', angles, isAngleList, 'a list of angles of incidence in degrees, 0 or more and below 90');
    requireValue(call, 'wavelength', wavelength, isPositive, 'a wavelength in nm above 0');
    const written = scoredSide(call, design, side);
    if (!sideStack(design, written).layers.length) throw refusal('emptySide', { call, side: written }, `${call}: the ${written} has no layers`);
    requireResolved(design);
    const { count, wavelengthsNm } = analysisWavelengths(from, to, step);
    if (!wavelengthsNm) throw new Error(`${call}: ${z.errTooManyWavelengths(count, CODEV_LIMITS.wavelengths)}`);
    refuseExisting(call, file, overwrite);
    const { text, warnings } = designSeq(call, design, { side: written, title, saveName, wavelengthsNm, anglesDeg: angles, refNm: wavelength });
    writeCoatingText(file, text);
    return warnings.map(warning => warningText(z, warning));
}

// The stack the file enters, read as the window reads it: a .mul is the file
// CODE V saves with SAV, anything else is read as commands.
function readStack(call, file) {
    const text = readCoatingText(call, file);
    try {
        return (/\.mul$/i.test(file) ? parseCodevMul : parseCodevSeq)(text);
    } catch (err) {
        if (err instanceof CodevParseError) throw new Error(`${call}: ${file}: ${parseErrorText(z, err)}`);
        throw err;
    }
}

// An index as the file gives it: a MIC material by its label, or a constant n and k.
const indexOf = ref => ('label' in ref ? { label: ref.label, n: null, k: null } : { label: null, n: ref.n, k: ref.k });

/**
 * Reads a CODE V coating file, a .seq command file or a .mul CODE V saved, as
 * the [CODE V Coatings](/data-exchange/codev-coatings/) window's Import tab
 * shows it: what the stack sets around its layers, and its layers, incident
 * medium side first. A thickness the file gives in waves of REF is given in
 * nm, with the layer's index at REF. Nothing is written to a catalog.
 *
 * @param filePath The file, by its full path; a name ending in .mul is read as a saved .mul, any other as commands.
 * @returns The file's stack.
 * @property fileName The file's name, without its folder.
 * @property title TIT, the stack's title, or an empty string.
 * @property reference REF, the reference wavelength, nm.
 * @property wavelengths The analysis wavelengths, nm, as CODE V holds them.
 * @property angles ANG, the angles of incidence, degrees.
 * @property incident INC, the incident medium: `{ label, n, k }`, a MIC material by its label with n and k null, or a constant index with label null.
 * @property substrate SUB, the substrate, the same way.
 * @property layers The layers, incident medium side first.
 * @property layers[].index The layer's index, as for `incident`.
 * @property layers[].thickness Its physical thickness, nm.
 * @property layers[].code Its COA code: 100 frozen, 0 free, 1 to 99 coupled.
 * @property layers[].locked Whether the code is 100, which an import keeps as a locked layer.
 * @property warnings What the reader noted: commands it does not apply, values past a command's limit, a decimal comma, a MIC table that does not reach REF.
 * @throws a file that cannot be read, or that does not enter a stack the reader can read, with what stopped it
 * @example
 * const file = require('path').join(require('os').homedir(), `ar-${Date.now()}.seq`);
 * require('fs').writeFileSync(file, "MUL\nMDA\nPHT Y\nTIT 'AR'\nWLG 400 700 50\nREF 550\nCOA 99.6 100 1.38\nCOA 59.8 0 2.3\nSUB 1.52\nEND\nMEX\n");
 * const read = tf.readCodevCoating(file);
 * console.log(read.title, read.wavelengths.length, 'wavelengths, REF', read.reference);
 * for (const layer of read.layers) console.log('n', layer.index.n, layer.thickness, 'nm', layer.locked ? 'locked' : '');
 */
export function readCodevCoating(filePath) {
    const call = 'readCodevCoating';
    const file = coatingFilePath(call, filePath);
    const stack = readStack(call, file);
    return {
        fileName: path.basename(file),
        title: stack.title,
        reference: fileNumber(stack.refNm),
        wavelengths: stack.wavelengthsNm.map(fileNumber),
        angles: stack.anglesDeg,
        incident: indexOf(stack.incident),
        substrate: indexOf(stack.substrate),
        layers: stack.layers.map(layer => ({
            index: indexOf(layer.index), thickness: layer.thicknessNm, code: layer.code, locked: layer.code === 100,
        })),
        warnings: stack.warnings.map(warning => warningText(z, warning)),
    };
}

/**
 * Puts the layers of a CODE V coating file, a .seq or a .mul, on one side of
 * a design, as the [CODE V Coatings](/data-exchange/codev-coatings/) window's
 * Import to front coating and Import to back coating put them: physical
 * thickness in nm, a layer of code 100 locked. The file lists its layers from
 * the incident medium, so on the back they go in reversed, the file's
 * incident medium facing the exit side. The side's layers are replaced; the
 * media and the substrate stay the design's, and the file's INC and SUB are
 * not taken. Each layer's material takes the id an import in the app gives it,
 * in the catalog named after the file, and the design carries its definition:
 * nothing is written to a catalog. On a computer where the app imported the
 * file before, the ids are that catalog's and the materials it holds are
 * used, edits included, as the window uses them; otherwise each call draws a
 * new random part of the catalog id, as a first import does.
 *
 * @param design The design.
 * @param filePath The file, by its full path; a name ending in .mul is read as a saved .mul, any other as commands.
 * @param [options]
 * @param [options.side] `'front'` or `'back'`; without it, the front, or the back of a design coated on the back alone.
 * @returns The design with the layers, and what the reader and the conversion noted.
 * @property design The design with the file's layers on the side.
 * @property warnings What the reader noted, as readCodevCoating gives it, then what the conversion noted: coupled layers imported as free ones, a material resampled, an absorbing medium.
 * @throws a file that cannot be read, or that does not enter a stack the reader can read, with what stopped it
 * @throws a side the Design Editor does not let you edit: the back of a symmetric design, or the other side of a design coated on one side and scored on that side
 * @throws an option it does not take, or a value an option cannot take
 * @example
 * const file = require('path').join(require('os').homedir(), `ar-${Date.now()}.seq`);
 * require('fs').writeFileSync(file, "MUL\nMDA\nPHT Y\nTIT 'AR'\nWLG 400 700 50\nREF 550\nCOA 99.6 100 1.38\nCOA 59.8 0 2.3\nSUB 1.52\nEND\nMEX\n");
 * const { design, warnings } = tf.importCodevCoating(tf.newDesign({ name: 'AR' }), file);
 * for (const layer of design.frontLayers) console.log(layer.material, layer.thickness, 'nm', layer.locked ? 'locked' : '');
 * console.log(warnings);
 */
export function importCodevCoating(design, filePath, options) {
    const call = 'importCodevCoating';
    const file = importFilePath(call, filePath, 'codev_');
    const { side } = checkOptions(call, options, ['side']);
    const onto = scoredSide(call, design, side);
    const key = openSideKey(call, design, onto);
    const stack = readStack(call, file);
    const built = importedLayers({ z, stack, fileName: path.basename(file), filePath: file }, onto, { write: false });
    if (built.error) throw new Error(`${call}: ${built.error}`);
    return {
        design: withImportedLayers(design, key, built.layers, built.materials),
        warnings: built.warnings.map(warning => warningText(z, warning)),
    };
}
