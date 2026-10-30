// The Monitor Worksheet window's table: for each layer of one side, on the
// witness chip it is monitored on, the signal there is to stop on and the
// thickness the monitor's own error costs (utils/monitoring/monoSim/
// worksheet.js), on the chip plan processSteps reads.

import { autoChipLambdas, buildMonitorWorksheet } from '../utils/monitoring/monoSim.js';
import { MaterialHasNoIndexError } from '../utils/materials/materialIndexAt.js';
import { designMaterialLookup, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { ANALYSIS_DEFAULTS, numberAllowed, sessionDefaults } from '../constants/analysisDefaults.js';
import en from '../constants/locales/en.js';
import { requireResolved } from './materials.js';
import { warnWithoutKernel } from './environment.js';
import { scoredSide } from './stackViews.js';
import { chipPlan, CHIP_OPTIONS } from './process.js';
import { checkOptions, requireValue, isAngle, isPositive } from './check.js';

const OPTIONS = ['side', 'quantity', 'angle', 'pol', 'chips', 'wavelengths', 'signalErrorPct', 'noiseFloorPct', 'maxTerminationErrPct'];
const D = sessionDefaults('monitorWorksheet');
const N = ANALYSIS_DEFAULTS.monitorWorksheet.numbers;
// The monitor's settings the window names in percent, by the API's names, with
// the window's own names for them and their field bounds.
const PERCENT = [
    ['signalErrorPct', 'signalErrorPct'],
    ['noiseFloorPct', 'absSignalErrorPct'],
    ['maxTerminationErrPct', 'maxTerminationErrPct'],
];
const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);

// The side's layers as the worksheet deposits them, as the front of a design:
// the back's layers, which it stores from the substrate out, are turned round
// so the worksheet deposits them substrate side first too.
function depositedAsFront(design, side) {
    return side === 'front' ? design : { ...design, frontLayers: [...(design.backLayers || [])].reverse() };
}

// The monitor wavelength of each step the window would compute with: none (each
// chip at the design's reference wavelength), the Auto button's pick, Set all's
// one wavelength, or one for each step.
function wavelengthPlan(call, wavelengths, stepCount, pick) {
    if (wavelengths === undefined) return null;
    if (wavelengths === 'auto') return pick();
    requireValue(call, 'wavelengths', wavelengths, v => isPositive(v) || (Array.isArray(v) && v.length === stepCount && v.every(isPositive)),
        `'auto', a wavelength in nm above 0 for every chip, or one for each of the side's ${stepCount} layers, empty ones included`);
    return Array.isArray(wavelengths) ? wavelengths : new Array(stepCount).fill(wavelengths);
}

// The window's message for a material with no index where the worksheet needs one.
function withoutIndex(call, run) {
    try {
        return run();
    } catch (err) {
        if (err instanceof MaterialHasNoIndexError) throw new Error(`${call}: ${en.monitorWorksheet.noIndex(err.materialId, err.lambdaNm)}`);
        throw err;
    }
}

const rowOf = (row, stepCount) => ({
    step: row.step, layer: stepCount - row.layerIndex, chip: row.chip, onChip: row.onChip, material: row.material,
    wavelength: row.lambda, thickness: row.thickness, signal: row.signal, turningPoints: row.turningPoints,
    amplitude: row.amplitude, swingIn: row.swingIn, swingOut: row.swingOut, cutoffRatio: row.cutoffRatio,
    terminationError: row.terminationErrNm, crystal: row.crystalNm, initialLevel: row.initialLevel,
    poor: row.poor, strategy: row.strategy, curve: { thickness: row.curve.thickness, signal: row.curve.y },
});

/**
 * Whether each layer of one side can be stopped on an optical monitor, as the
 * [Monitor Worksheet](/simulation/monitor-worksheet/) window works it out: the
 * layers deposited from the substrate out on witness chips, each chip a short
 * coating of its own from bare chip glass, its back face bare, read in air
 * whatever media the design is in, each layer `witnessRatio` times its
 * thickness on the part. Each row gives the signal a monitor reads at its
 * chip's wavelength when the layer is cut, the turning points in it, the swing
 * there is to stop on and what a signal error of the monitor's own size costs
 * in thickness, flagged past `maxTerminationErrPct` of the layer. Every layer
 * is a row, an empty one included. The chip plan is processSteps's `chips`:
 * processSteps given the same `chips` gives the Process Exporter's spectra of
 * these chips, and needs them given, `{}` for 3 layers to a chip, as without
 * `chips` it runs on the part. The window's chip plan and wavelengths are its own; a plan given here does not
 * reach it, nor the Report. The design's cone of incidence is not used, as the
 * window does not use it.
 *
 * @param design The design.
 * @param [options]
 * @param [options.side] `'front'` or `'back'`, the side deposited. Without it, the front, or the back of a design coated on the back alone; the window has the front alone.
 * @param [options.quantity='T'] `'T'` or `'R'`, what the monitor reads.
 * @param [options.angle=0] The angle of incidence on the chip, degrees in air, 0 up to but not including 90.
 * @param [options.pol='avg'] `'avg'`, `'s'` or `'p'`.
 * @param [options.chips] The chip plan, `{ layersPerChip, plan, glass, witnessRatio }`, each optional: `plan` a chip number for each layer of the side from the substrate out, empty layers included, in place of `layersPerChip` layers to a chip (3 without either); `glass` the chip glass by id, the design's substrate without it; `witnessRatio` the witness thickness over the part's, from 0.05 to 10, 1 without it.
 * @param [options.wavelengths] The monitor wavelengths, nm: `'auto'`, the window's Auto button, each chip at the reference wavelength or one of 25 from 0.7 to 1.3 times it, whichever its worst layer stops most closely at, to the whole nm; a number, every chip there, as Set all does; or a list of one for each layer of the side from the substrate out, empty layers included, a chip read at the one given for its first layer. Without it, every chip at the design's reference wavelength.
 * @param [options.signalErrorPct=0.3] The monitor's signal error, % of the reading, from 0.001 to 50.
 * @param [options.noiseFloorPct=0.1] The monitor's noise floor, % of full scale, from 0 to 10.
 * @param [options.maxTerminationErrPct=1] The termination error a layer is flagged past, % of its thickness, from 0.01 to 100.
 * @returns The worksheet.
 * @property mode The side deposited, `'front'` or `'back'`.
 * @property rows One per layer in deposition order, each `{ step, layer, chip, onChip, material, wavelength, thickness, signal, turningPoints, amplitude, swingIn, swingOut, cutoffRatio, terminationError, crystal, initialLevel, poor, strategy, curve }`: step from 1; layer its Design Editor number from 1 next to the substrate, the same as step; chip its chip number and onChip its place on that chip from 1; material by id; wavelength the chip's, nm; thickness the witness's, nm; signal the reading when the layer is cut, a fraction of 1 (the window shows %); turningPoints how many lie inside the layer; amplitude the swing from the reading the cut is taken against, the last turning point at or before the cut on the chip or else the chip's bare reading, to the next turning point, null with none after the cut; swingIn and swingOut the swing from that reading to the layer's start and to the cut, fractions of 1; cutoffRatio swingOut over amplitude, or null; terminationError the thickness a signal error of the monitor's own size leaves, nm, null for a layer cut on time and Infinity where the signal has no slope or turn to read; crystal the part's thickness, nm, which a quartz monitor runs to (the window shows kÅ); initialLevel the chip's bare reading on its first layer, null on the others; poor true when the layer has no turning point after its cut or its termination error is past the budget; strategy `'turning'`, `'level'` or `'time'`, how the layer is cut; curve `{ thickness, signal }`, the reading against the layer's own thickness on the chip, nm, from 0 to 1.35 quarter waves of the layer past the cut, beyond the next turning point where there is one.
 * @property chips One per chip in the order it enters the run, each `{ chip, wavelength, initialLevel, steps }`: wavelength nm, initialLevel its bare reading, steps the steps on it.
 * @property runLength The run's optical thickness on the witnesses, in quarter waves at the design's reference wavelength, the length of the window's chart.
 * @throws an option it does not take, or a value an option cannot take
 * @throws a chip plan or a list of wavelengths whose length is not the side's layer count, a chip glass that resolves to nothing, or a design that names a material that resolves to nothing
 * @throws a material with no refractive index at the reference wavelength or at a chip's wavelength, in the window's words with the material named by id
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: 'H L H L' });
 * const sheet = tf.monitorWorksheet(design, { chips: { layersPerChip: 2 } });
 * for (const r of sheet.rows) {
 *     console.log('step', r.step, 'chip', r.chip, r.material, 'signal', r.signal.toFixed(4), 'error', r.terminationError?.toFixed(2), 'nm', r.poor ? 'flagged' : '');
 * }
 */
export function monitorWorksheet(design, options) {
    const call = 'monitorWorksheet';
    const {
        side, quantity = D.char, angle = D.theta, pol = D.polarization, chips, wavelengths, ...percent
    } = checkOptions(call, options, OPTIONS);
    const mode = scoredSide(call, design, side);
    requireValue(call, 'quantity', quantity, v => v === 'T' || v === 'R', "'T' or 'R'");
    requireValue(call, 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue(call, 'pol', pol, v => ['avg', 's', 'p'].includes(v), "'avg', 's' or 'p'");
    const monitor = {};
    for (const [name, key] of PERCENT) {
        const { min, max } = N[key];
        monitor[key] = percent[name] === undefined ? D[key] : percent[name];
        requireValue(call, name, monitor[key], v => numberAllowed(N[key], v), `a percentage from ${min} to ${max}`);
    }
    requireValue(call, 'chips', chips, v => v === undefined || isRecord(v), `an object of ${CHIP_OPTIONS.join(', ')}`);
    requireResolved(design);
    const shown = depositedAsFront(withHerpinRecords(design), mode);
    const stepCount = shown.frontLayers?.length || 0;
    const plan = chipPlan(call, design, chips ?? {}, stepCount);
    warnWithoutKernel();
    const resolveMat = designMaterialLookup(shown);
    const settings = { char: quantity, theta: angle, pol, ...plan, ...monitor };
    const lambdaByStep = wavelengthPlan(call, wavelengths, stepCount, () => withoutIndex(call, () => autoChipLambdas(shown, resolveMat, settings)));
    if (!stepCount) return { mode, rows: [], chips: [], runLength: 0 };
    const sheet = withoutIndex(call, () => buildMonitorWorksheet(shown, resolveMat, { ...settings, lambdaByStep }));
    return {
        mode,
        rows: sheet.rows.map(row => rowOf(row, stepCount)),
        chips: sheet.chips.map(chip => ({ chip: chip.chip, wavelength: chip.lambda, initialLevel: chip.initialLevel, steps: chip.steps })),
        runLength: sheet.xEnd,
    };
}
