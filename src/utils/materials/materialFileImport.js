/**
 * materialFileImport.js: one entry point for importing material files from
 * other coating programs. Routes each picked file to its parser by extension:
 *   .mat          TFCalc              (tfcalcParser.js)
 *   .tfx / .mtx   Essential Macleod   (macleodParser.js)
 *   .lm / .sub    OptiLayer           (optilayerParser.js)
 *
 * Wavelength units the files do not carry come from `units`:
 *   tfcalc   'nm' | 'um'           the TFCalc installation's configured unit
 *   macleod  'auto' | 'nm' | 'um'  'auto' reads the database's units.tfp when
 *                                  the picker found one next to the file, nm otherwise
 */

import { parseOptiLayerFile } from './optilayerParser.js';
import { parseTFCalcFile } from './tfcalcParser.js';
import { parseMacleodFile, parseMacleodUnits } from './macleodParser.js';
import { sanitizeId } from './optilayerParser/idUtils.js';

export const MATERIAL_FILE_EXTENSIONS = ['mat', 'tfx', 'mtx', 'lm', 'sub'];

export const DEFAULT_IMPORT_UNITS = { tfcalc: 'nm', macleod: 'auto' };

const PROGRAM_BY_EXT = { mat: 'tfcalc', tfx: 'macleod', mtx: 'macleod', lm: 'optilayer', sub: 'optilayer' };

/** 'tfcalc' | 'macleod' | 'optilayer' | null for a file extension (no dot). */
export function programForExtension(ext) {
    return PROGRAM_BY_EXT[String(ext || '').toLowerCase()] || null;
}

function parseOne(file, program, units) {
    if (program === 'tfcalc') {
        const group = /^substrat/i.test(file.dir || '') ? 'Substrate' : undefined;
        return { entry: parseTFCalcFile(file.text, file.name, { wavelengthUnit: units.tfcalc, group }), unit: units.tfcalc };
    }
    if (program === 'macleod') {
        let unit = units.macleod;
        if (unit === 'auto') {
            const found = parseMacleodUnits(file.unitsText);
            if (found === 'unsupported') {
                throw new Error('The database\'s units.tfp names a wavelength unit other than nm or µm; choose the unit with the switch');
            }
            unit = found || 'nm';
        }
        return { entry: parseMacleodFile(file.text, file.name, { wavelengthUnit: unit }), unit };
    }
    return { entry: parseOptiLayerFile(file.text, `${file.name}.${file.ext}`), unit: 'nm' };
}

/**
 * Parse a batch of picked files.
 *
 * @param {Array<{name: string, ext: string, dir?: string, text: string, unitsText?: string}>} files
 * @param {{tfcalc: string, macleod: string}} [units]
 * @returns {{ items: Array<{fileIndex, file, program, unit, entry}>, errors: Array<{fileIndex, file, program, error, code?}> }}
 *   Entry ids are unique within the batch. An error with `code`
 *   'unsupported-type' has no parser message to show; the caller words it.
 */
export function parseMaterialFiles(files, units = DEFAULT_IMPORT_UNITS) {
    const items = [], errors = [];
    const ids = new Set();
    (files || []).forEach((file, fileIndex) => {
        const program = programForExtension(file.ext);
        const label = `${file.name}.${file.ext}`;
        if (!program) { errors.push({ fileIndex, file: label, program: null, code: 'unsupported-type', error: '' }); return; }
        try {
            const { entry, unit } = parseOne(file, program, units);
            const baseId = sanitizeId(entry.name);
            let id = baseId, n = 2;
            while (ids.has(id)) id = `${baseId}_${n++}`;
            ids.add(id);
            entry.id = id;
            items.push({ fileIndex, file: label, program, unit, entry });
        } catch (e) {
            errors.push({ fileIndex, file: label, program, error: e.message });
        }
    });
    return { items, errors };
}
