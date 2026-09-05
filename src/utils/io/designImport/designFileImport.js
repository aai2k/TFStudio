/**
 * designFileImport.js: routes picked design files to the reader for their
 * program and collects the results of a batch.
 *
 * Every reader returns the same imported-design description:
 *   name, program ('tfcalc' | 'macleod' | 'optilayer'), file,
 *   referenceWavelengthNm, angleDeg (the incident angle the file evaluates at),
 *   matchAngleDeg and matchMedium (the angle optical thicknesses are defined at),
 *   incidentMedium, substrate, exitMedium (null when the substrate is the
 *   emergent medium), substrateThicknessMm (null when the file has none),
 *   backSurface: true when the program evaluates the back surface of the
 *     substrate for this design, false when the substrate is semi-infinite,
 *   front  layers, incident medium first (TFStudio front storage order),
 *   back   layers, substrate first (TFStudio back storage order),
 *     each { material, thicknessNm | null,
 *            optical: { kind: 'qwot'|'fwot', value, angleDeg?, matchMedium? } | null,
 *            locked },
 *   formula, symbols,
 *   constants: names that mean a constant index, as a number or { n, k },
 *   embedded: names whose definition came with the file, as catalog entries:
 *     from the design's folder (OptiLayer) or the program's material
 *     database (Essential Macleod),
 *   comments (the file's own notes),
 *   notes: what the reader dropped, assumed or changed, as { code, … } records
 *     worded by the import dialog (importNoteText in buildDesign.js),
 *   spectrum { fromNm, toNm } | null (the file's own plot range).
 * Material names are the file's own; buildDesign.js turns them into TFStudio
 * ids with the mapping the import dialog collects.
 *
 * A rugate or graded-index design is refused by every reader, since TFStudio
 * has no graded layer: OptiLayer's rugate layers, Essential Macleod's
 * packing-density layers and TFCalc's variable materials.
 */

import { parseTFCalcDesign } from './tfcalcDesign.js';
import { parseMacleodDesign } from './macleodDesign.js';
import { parseOptiLayerDesign } from './optilayerDesign.js';

export const DESIGN_FILE_EXTENSIONS = ['tfd', 'dds', 'dsg'];

// Wavelength unit per program for files that do not record one. 'auto' lets
// the TFCalc reader take the unit its layers pin.
export const DEFAULT_DESIGN_IMPORT_UNITS = { tfcalc: 'auto' };

export function programForExtension(ext) {
    switch ((ext || '').toLowerCase()) {
        case 'tfd': return 'tfcalc';
        case 'dds': return 'macleod';
        case 'dsg': return 'optilayer';
        default: return null;
    }
}

function parseOne(file, units) {
    const program = programForExtension(file.ext);
    const fileName = `${file.name}.${file.ext}`;
    if (file.text == null) throw new Error(file.error || `"${fileName}" could not be read`);
    if (program === 'tfcalc') return { program, item: parseTFCalcDesign(file.text, fileName, { wavelengthUnit: units.tfcalc }) };
    if (program === 'macleod') return { program, item: parseMacleodDesign(file.text, fileName, { siblings: file.siblings, unitsText: file.unitsText, databaseDir: file.databaseDir }) };
    if (program === 'optilayer') return { program, item: parseOptiLayerDesign(file.text, fileName, { projectText: file.projectText, siblings: file.siblings }) };
    const err = new Error(`Unsupported file type: .${file.ext}`);
    err.code = 'unsupported-type';
    throw err;
}

/**
 * Parse a batch of picked files.
 *
 * @param {Array<{ name: string, ext: string, dir: string, text: string|null, error?: string,
 *                 projectText?: string, siblings?: Array, unitsText?: string, databaseDir?: string }>} files
 *        a file the main process could not read has text null and the reason in error;
 *        an OptiLayer design carries its folder, an Essential Macleod design the
 *        program's material database
 * @param {{ tfcalc: 'auto'|'nm'|'um' }} [units]
 * @returns {{ items: Array<{ fileIndex, file, program, item }>,
 *             errors: Array<{ fileIndex, file, program, error, code? }> }}
 */
export function parseDesignFiles(files, units = DEFAULT_DESIGN_IMPORT_UNITS) {
    const items = [];
    const errors = [];
    files.forEach((file, fileIndex) => {
        const fileName = `${file.name}.${file.ext}`;
        try {
            const { program, item } = parseOne(file, units);
            items.push({ fileIndex, file: fileName, program, item });
        } catch (err) {
            errors.push({ fileIndex, file: fileName, program: programForExtension(file.ext), error: err.message, code: err.code });
        }
    });
    return { items, errors };
}

/** Distinct material names a design refers to: media, substrate and layers. */
export function designMaterialNames(item) {
    const names = [item.incidentMedium, item.substrate, item.exitMedium, ...[...item.front, ...item.back].map(layer => layer.material)];
    return [...new Set(names.filter(Boolean))];
}

/** Constant index a source name stands for, as { n, k }, or null. */
export function constantIndexOf(item, name) {
    const constant = item.constants && Object.hasOwn(item.constants, name) ? item.constants[name] : null;
    if (typeof constant === 'number') return Number.isFinite(constant) ? { n: constant, k: 0 } : null;
    return constant && Number.isFinite(constant.n) ? { n: constant.n, k: Number(constant.k) || 0 } : null;
}

/**
 * Index the design was built with for a source name, as { n, k }, or null when
 * the file carries none.
 *
 * A constant is that index. Otherwise it comes from a layer that stores both
 * its quarter waves and its physical thickness, since d = qwot λ0 / (4 n)
 * leaves n. That relation holds at normal incidence only, so a layer whose
 * optical thickness is defined at an angle is passed over, and a file that
 * stores optical thickness alone (Essential Macleod) has nothing to give.
 */
export function sourceIndexOf(item, name) {
    const constant = constantIndexOf(item, name);
    if (constant) return constant;
    const lam0 = item.referenceWavelengthNm;
    for (const layer of [...item.front, ...item.back]) {
        if (layer.material !== name || !layer.optical || layer.optical.kind !== 'qwot' || layer.optical.angleDeg) continue;
        if (!(layer.thicknessNm > 0) || !(layer.optical.value > 0)) continue;
        const n = layer.optical.value * lam0 / (4 * layer.thicknessNm);
        if (n > 0 && Number.isFinite(n)) return { n, k: 0 };
    }
    return null;
}

/** Catalog entry the file brought with it for a source name (from the design's folder or the program's database), or null. */
export function embeddedDefinition(item, name) {
    return item.embedded && Object.hasOwn(item.embedded, name) ? item.embedded[name] : null;
}

/** True when the file itself defines the material: a constant index or a definition it brought with it. */
export function nameHasDefinition(item, name) {
    return !!(constantIndexOf(item, name) || embeddedDefinition(item, name));
}

/**
 * Distinct material names across a batch, with the program they come from,
 * how many designs use each, and whether the files define the name
 * themselves. A name is one entry per program: TFCalc's SIO2 and Essential
 * Macleod's SiO2 are different files on the user's machine.
 */
export function batchMaterialNames(items) {
    const seen = new Map();
    for (const { program, item } of items) {
        for (const name of designMaterialNames(item)) {
            const key = `${program} ${name}`;
            const entry = seen.get(key) || { name, program, designs: 0, constant: constantIndexOf(item, name), embedded: !!embeddedDefinition(item, name) };
            entry.designs++;
            seen.set(key, entry);
        }
    }
    return [...seen.values()];
}

export const materialKey = (program, name) => `${program} ${name}`;
