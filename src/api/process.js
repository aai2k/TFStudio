// The Process Exporter's run: the spectrum a monitor in the chamber reads
// after each layer, on the part or on witness chips (dataExchange/
// processSimulator/model.js), and the files its Save writes
// (utils/io/processFileExport.js, written by src/main/ipc/process.js).

import fs from 'node:fs';
import path from 'node:path';
import {
    buildDepositionModel, computeSpectrum, computeStepSpectra, PROCESS_SETUP_DEFAULTS,
} from '../components/windows/dataExchange/processSimulator/model.js';
import { buildAllProcessFiles, DEFAULT_OUTPUT } from '../utils/io/processFileExport.js';
import { assignChips } from '../utils/monitoring/monoSim.js';
import { ANALYSIS_DEFAULTS, sessionDefaults } from '../constants/analysisDefaults.js';
import { withHerpinRecords } from '../utils/materials/designMaterials.js';
import processIpc from '../main/ipc/process.js';
import mainPaths from '../main/paths.js';
import { requireMaterial, requireResolved } from './materials.js';
import { warnWithoutKernel } from './environment.js';
import { scoredSide } from './stackViews.js';
import { checkOptions, checkRange, requireValue, refusal, isAngle } from './check.js';

const RUN_OPTIONS = ['side', 'otherSide', 'quantity', 'angle', 'pol', 'from', 'to', 'step', 'chips'];
const OUTPUT_OPTIONS = Object.keys(DEFAULT_OUTPUT);
export const CHIP_OPTIONS = ['layersPerChip', 'plan', 'glass', 'witnessRatio'];
const CHIP_DEFAULTS = sessionDefaults('monitorWorksheet');
// The bounds of the chip fields the Monitor Worksheet and the Process
// Exporter share; a chip number goes up to the most layers a chip takes.
const { layersPerChip: PER_CHIP, witnessRatio: RATIO } = ANALYSIS_DEFAULTS.monitorWorksheet.numbers;
const MAX_CHIP = PER_CHIP.max;
const D = PROCESS_SETUP_DEFAULTS;

const OUTPUT_TAKES = {
    format: [['res', 'csv', 'txt'], "'res', 'csv' or 'txt'"],
    files: [['step', 'table'], "'step' or 'table'"],
    header: [['layers', 'conditions', 'none'], "'layers', 'conditions' or 'none'"],
    delimiter: [[',', ';', '\t', ' '], "',', ';', a tab or a space"],
    scale: [['percent', 'fraction'], "'percent' or 'fraction'"],
    decimalMark: [['.', ','], "'.' or ','"],
};

const isChipNumber = v => Number.isInteger(v) && v >= 1 && v <= MAX_CHIP;

// The window's chip plan ({ chipByStep, chipMaterial, witnessRatio }) for
// `chips`, the side having `stepCount` layers, empty ones included, as the
// Monitor Worksheet numbers its plan; monitorWorksheet reads it the same way.
export function chipPlan(call, design, chips, stepCount) {
    if (chips == null) return null;
    requireValue(call, 'chips', chips, v => typeof v === 'object' && !Array.isArray(v), `null for the part, or an object of ${CHIP_OPTIONS.join(', ')}`);
    const unknown = Object.keys(chips).find(key => !CHIP_OPTIONS.includes(key));
    if (unknown) {
        const options = CHIP_OPTIONS.map(name => `chips.${name}`);
        throw refusal('unknownOption', { call, option: `chips.${unknown}`, options }, `${call}: unknown option 'chips.${unknown}'; the options are ${options.join(', ')}`);
    }
    const { layersPerChip = CHIP_DEFAULTS.layersPerChip, plan, glass, witnessRatio = CHIP_DEFAULTS.witnessRatio } = chips;
    requireValue(call, 'chips.layersPerChip', layersPerChip, isChipNumber, `a whole number of layers from 1 to ${MAX_CHIP}`);
    requireValue(call, 'chips.witnessRatio', witnessRatio, v => Number.isFinite(v) && v >= RATIO.min && v <= RATIO.max, `a ratio from ${RATIO.min} to ${RATIO.max}`);
    requireValue(call, 'chips.plan', plan, v => v === undefined || (Array.isArray(v) && v.length === stepCount && v.every(isChipNumber)),
        `a chip number from 1 to ${MAX_CHIP} for each of the side's ${stepCount} layers, empty ones included`);
    if (glass !== undefined) {
        requireValue(call, 'chips.glass', glass, v => typeof v === 'string' && v !== '', 'a material id');
        try { requireMaterial(design, glass); } catch (err) { throw new Error(`${call}: chips.glass: ${err.message}`); }
    }
    return { chipByStep: plan ?? assignChips(stepCount, layersPerChip), chipMaterial: glass ?? null, witnessRatio };
}

// The run's settings in the window's names, after checking each option.
function runSettings(call, design, options) {
    const {
        side, otherSide = D.secondSurface, quantity = D.quantity, angle = D.aoi, pol = D.polarization,
        from = D.lambdaStart, to = D.lambdaEnd, step = D.lambdaStep, chips,
    } = options;
    const activeSide = scoredSide(call, design, side);
    requireValue(call, 'otherSide', otherSide, v => v === 'bare' || v === 'coated', "'bare' or 'coated'");
    requireValue(call, 'quantity', quantity, v => ['T', 'R', 'A'].includes(v), "'T', 'R' or 'A'");
    requireValue(call, 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue(call, 'pol', pol, v => ['avg', 's', 'p'].includes(v), "'avg', 's' or 'p'");
    checkRange(call, { from, to, step });
    requireResolved(design);
    const sideLayers = (activeSide === 'front' ? design.frontLayers : design.backLayers) || [];
    return {
        activeSide, secondSurface: otherSide, quantity, aoi: angle, polarization: pol,
        lambdaStart: from, lambdaEnd: to, lambdaStep: step,
        chips: chipPlan(call, design, chips, sideLayers.length),
    };
}

/**
 * The spectrum a monitor in the chamber reads after each layer of one side,
 * as the [Process Exporter](/simulation/process-simulator/) window computes its
 * finished-layer curves: the layers deposited from the substrate out, an
 * empty layer left out, the piece read in air whatever media the design is
 * in. On the part the other side stays bare or carries its whole coating for
 * the run. On witness chips each chip is a run of its own from bare chip
 * glass, its back face bare, grown as a front coating whichever side the
 * layers are for, each layer `witnessRatio` times its thickness on the part,
 * as the Monitor Worksheet plans them. The design's cone of incidence is not
 * used, as the window does not use it. The deposition rates and the timeline
 * are not part of it.
 *
 * @param design The design.
 * @param [options]
 * @param [options.side] `'front'` or `'back'`, the side deposited. Without it, the front, or the back of a design coated on the back alone.
 * @param [options.otherSide='bare'] `'bare'` or `'coated'`: the other side of the part, without or with its coating. Not used on chips.
 * @param [options.quantity='T'] `'T'`, `'R'` or `'A'`.
 * @param [options.angle=0] The angle of incidence, degrees in air, 0 up to but not including 90.
 * @param [options.pol='avg'] `'avg'`, `'s'` or `'p'`.
 * @param [options.from=400] The first wavelength, nm.
 * @param [options.to=1100] The last wavelength, nm, above `from`.
 * @param [options.step=0.5] The wavelength step, nm.
 * @param [options.chips] Without it, or null, the part. On witness chips, `{ layersPerChip, plan, glass, witnessRatio }`, each optional: `plan` a chip number for each layer of the side from the substrate out, empty layers included, in place of `layersPerChip` layers to a chip (3 without either); `glass` the chip glass by id, the design's substrate without it; `witnessRatio` the witness thickness over the part's, from 0.05 to 10, 1 without it.
 * @returns The run.
 * @property mode The side deposited, `'front'` or `'back'`.
 * @property quantity `'T'`, `'R'` or `'A'`.
 * @property wavelength The wavelengths, nm.
 * @property bare The spectrum before the first layer: the bare part, with the other side's coating when it is coated, or a bare chip.
 * @property steps One per layer deposited, in order, each `{ step, layer, material, thickness, chip, values }`: step from 1; layer, its number in the Design Editor, from 1 next to the substrate, empty layers counted; material by id; thickness on the piece read, nm, the witness's on a chip; chip, its chip number, or null on the part; values, the spectrum when it is finished, a fraction of 1 at each wavelength. On chips each layer's spectrum is its own chip's.
 * @throws an option it does not take, or a value an option cannot take, a range that is not one, or more than a million wavelengths
 * @throws a chip plan whose length is not the side's layer count, a chip glass that resolves to nothing, or a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: 'H L' });
 * const run = tf.processSteps(design, { from: 400, to: 800, step: 5 });
 * const at = run.wavelength.indexOf(550);
 * console.log('bare', run.bare[at].toFixed(4));
 * for (const s of run.steps) console.log('step', s.step, s.material, s.thickness.toFixed(2), 'nm: T at 550 nm', s.values[at].toFixed(4));
 */
export function processSteps(design, options) {
    const settings = runSettings('processSteps', design, checkOptions('processSteps', options, RUN_OPTIONS));
    warnWithoutKernel();
    const shown = withHerpinRecords(design);
    const deposition = buildDepositionModel(shown, settings.activeSide, settings.chips);
    const common = {
        ...settings, activeDep: deposition.activeDep, otherDep: deposition.otherDep, chips: deposition.chips,
        incidentMat: deposition.incidentMat, substrateMat: deposition.substrateMat, exitMat: deposition.exitMat,
        substrateThk: deposition.substrateThk,
    };
    const bare = computeSpectrum({ ...common, layerIdx: 0, frac: 0 });
    const spectra = computeStepSpectra(common);
    return {
        mode: settings.activeSide, quantity: settings.quantity,
        wavelength: Array.from(bare.lambda), bare: Array.from(bare.values),
        steps: deposition.activeDep.map((layer, i) => ({
            step: i + 1, layer: layer.step + 1, material: layer.materialId, thickness: layer.thickness,
            chip: layer.chip, values: Array.from(spectra[i].values),
        })),
    };
}

// The app's version, which a .res header names; empty where the API runs
// without the app's package.json beside it, as the window writes it when the
// app gives none.
function appVersion() {
    try {
        return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version || '';
    } catch {
        return '';
    }
}

function outputSettings(call, given) {
    const output = { ...DEFAULT_OUTPUT, ...given };
    for (const [name, [values, takes]] of Object.entries(OUTPUT_TAKES)) requireValue(call, name, output[name], v => values.includes(v), takes);
    requireValue(call, 'decimals', output.decimals, v => Number.isInteger(v) && v >= 0 && v <= 12, 'a whole number of decimals from 0 to 12');
    if (output.decimalMark === ',' && output.delimiter === ',') {
        throw new Error(`${call}: a decimal comma takes a delimiter other than a comma, as the window offers: ';', a tab or a space`);
    }
    return output;
}

/**
 * Writes the files the [Process Exporter](/simulation/process-simulator/)
 * window's Save writes for a run, into a folder: one .res file a step (01.res,
 * 02.res, ...), or CSV or text files, one a step or one table a run, each
 * spectrum computed as processSteps computes it. On witness chips each
 * chip's files go in a folder of its own inside it, chip-1, chip-2, and a
 * table is written for each chip. A file of the same name already in the
 * folder is replaced, as Save replaces it. A .res file names the app's
 * version, the folder and the time it was written, and is plain ASCII with
 * CRLF line ends.
 *
 * @param design The design.
 * @param folderPath The folder the files go in, which must be there; a relative path is taken from the working folder.
 * @param [options] processSteps's options, but for `from`, `to` and `step`, which give the wavelengths written, and these.
 * @param [options.format='res'] `'res'`, `'csv'` or `'txt'`, a CSV file under a .txt name. A .res file has one layout, which the options below do not change.
 * @param [options.files='step'] `'step'`, one file a step, or `'table'`, one file a run with a column a step, named after the design.
 * @param [options.header='layers'] `'layers'`, the .res header with its layer table; `'conditions'`, the design, step, angle and polarization lines Measured Spectra's import reads back; or `'none'`, numbers alone.
 * @param [options.delimiter=','] `','`, `';'`, a tab or a space.
 * @param [options.scale='percent'] `'percent'` or `'fraction'`.
 * @param [options.decimals=5] The decimals of each value, a whole number from 0 to 12; wavelengths are written as they are.
 * @param [options.decimalMark='.'] `'.'` or `','`; a comma takes a delimiter other than a comma.
 * @returns The full paths of the files written, in run order.
 * @throws what processSteps throws, an output option or value it does not take, or a folder that is not there
 * @throws a side with no layers to deposit
 * @example
 * const fs = require('fs'), path = require('path'), os = require('os');
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: 'H L' });
 * const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'process-'));
 * const written = tf.exportProcess(design, folder, { from: 400, to: 800, step: 1 });
 * console.log(written.map(file => path.basename(file)).join(', '));
 */
export function exportProcess(design, folderPath, options) {
    const given = checkOptions('exportProcess', options, [...RUN_OPTIONS, ...OUTPUT_OPTIONS]);
    requireValue('exportProcess', 'folder', folderPath, v => typeof v === 'string' && v !== '', 'the path of a folder');
    // The header names the folder, which the window's folder picker always gives in full.
    const folder = path.resolve(folderPath);
    const run = Object.fromEntries(Object.entries(given).filter(([key]) => RUN_OPTIONS.includes(key)));
    const output = outputSettings('exportProcess', Object.fromEntries(Object.entries(given).filter(([key]) => OUTPUT_OPTIONS.includes(key))));
    const settings = runSettings('exportProcess', design, run);
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`exportProcess: ${folder} is not a folder that is there`);
    warnWithoutKernel();
    const shown = withHerpinRecords(design);
    const files = buildAllProcessFiles(shown, {
        ...settings, outputDir: folder, appVersion: appVersion(), projectLabel: design.name, output,
    });
    if (!files.length) {
        throw refusal('emptySide', { call: 'exportProcess', side: settings.activeSide }, `exportProcess: the ${settings.activeSide} has no layers to deposit`);
    }
    const { safeName } = mainPaths;
    const saved = processIpc.writeProcessFiles({ fs, path, safeName, log: () => {} }, files, folder);
    if (!saved.success) throw new Error(`exportProcess: ${saved.error}`);
    return files.map(f => path.join(f.subdir ? path.join(folder, safeName(String(f.subdir))) : folder, safeName(f.filename)));
}
