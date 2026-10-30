// A measured spectrum: reading a CSV or JCAMP-DX file as Measured Spectra's
// import reads it (spectrumExchange/importedCurves.js), and a design's
// difference from a measured curve as the MCURVE merit row that the Fit…
// dialogs of Measured Spectra and Measured Ellipsometry write scores it
// (evalCore/operands/measured.js).

import path from 'node:path';
import mainPaths from '../main/paths.js';
import { jcampCurves, readSpectrumText, tableConditions, tableCurves } from '../components/windows/dataExchange/spectrumExchange/importedCurves.js';
import { X_UNIT_KEYS } from '../utils/io/spectrumTable.js';
import { buildEvalContext, evaluateOperands, makeOperand, operandEvaluationErrors, resolveEvalMode } from '../utils/physics/optimizer.js';
import { measuredCurveDeviations, measuredEllipsometryDeviations } from '../utils/physics/optimizer/evalCore/operands/measured.js';
import { inConeRow } from '../utils/physics/optimizer/evalCore/tmmEval.js';
import { designMaterialLookup, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { requireResolved } from './materials.js';
import { requireKernel } from './environment.js';
import { checkOptions, requireValue, isAngle, isBoolean } from './check.js';
import { curveRecord, fitConfig, fitSnapshot, GRID_OPTIONS, isAngular } from './curveRecords.js';

const { readTextAuto } = mainPaths;

const POLARIZATIONS = ['avg', 's', 'p'];
const SCALES = ['fraction', 'percent', 'absorbance'];
const READ_OPTIONS = ['angle', 'pol', 'quantity', 'scale', 'xUnit'];
// What a JCAMP-DX file is read with: the import asks for the angle and the
// polarization alone, since the file states its quantity, units and scale.
const JCAMP_OPTIONS = ['angle', 'pol'];
const FIT_OPTIONS = [...GRID_OPTIONS, 'levelFree'];

// A curve as the API gives it, from the curve record the import makes.
const curveOf = curve => ({
    name: curve.name, quantity: curve.quantity, angle: curve.aoi, pol: curve.pol, wavelength: curve.x, values: curve.y,
});

// Refuses the options readSpectrumFile takes that cannot be used as given.
function checkReadOptions(call, { angle, pol, quantity, scale, xUnit }) {
    requireValue(call, 'angle', angle, v => v === undefined || isAngle(v), 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue(call, 'pol', pol, v => v === undefined || POLARIZATIONS.includes(v), "'avg', 's' or 'p'");
    requireValue(call, 'quantity', quantity, v => v === undefined || ['T', 'R', 'A'].includes(v), "'T', 'R' or 'A'");
    requireValue(call, 'scale', scale, v => v === undefined || SCALES.includes(v), "'fraction', 'percent' or 'absorbance'");
    requireValue(call, 'xUnit', xUnit, v => v === undefined || Object.hasOwn(X_UNIT_KEYS, v), "'nm', 'um', 'cm-1' or 'eV'");
}

// The file's curve records, as the import adds them, with what the table was read in.
function importedFile(call, filePath, options) {
    let text;
    try { text = readTextAuto(filePath); } catch (err) { throw new Error(`${call}: ${filePath}: ${err.message}`); }
    const read = readSpectrumText(text);
    if (read.error) throw new Error(`${call}: ${filePath} holds no spectrum Measured Spectra's import reads: neither a JCAMP-DX file nor a table of numbers`);
    const fileName = path.basename(filePath);
    if (read.jcamp) {
        checkOptions(call, options, [...JCAMP_OPTIONS, ...(call === 'readSpectrumFile' ? [] : ['curve', ...FIT_OPTIONS])]);
        const curves = jcampCurves(read.jcamp, fileName, { aoi: options.angle ?? 0, pol: options.pol ?? 'avg' });
        return { format: 'jcamp', fileName, xUnit: null, skippedRows: 0, curves };
    }
    const stated = tableConditions(read.table);
    const xUnit = options.xUnit ?? stated.xUnit;
    const set = { ...(options.quantity ? { quantity: options.quantity } : {}), ...(options.scale ? { yscale: options.scale } : {}) };
    const curves = tableCurves(read.table, {
        // A column's own angle wins over these (tableCurves), and the panel
        // offers no polarization when the file states one.
        fileName, xUnit, aoi: options.angle ?? stated.aoi ?? 0, pol: stated.pol ?? options.pol ?? 'avg',
        overrides: read.table.columns.map(() => set),
    });
    return { format: 'table', fileName, xUnit, skippedRows: read.table.skippedRows || 0, curves };
}

/**
 * Reads a spectrum file as the [Measured Spectra](/data-exchange/measured-spectra/)
 * window's import reads it: a CSV or text table, one curve per column after the
 * wavelength column, or a JCAMP-DX file, one curve per spectrum. Each curve is
 * what the window would add to a design, its wavelengths in nm in rising order
 * and R, T and A as fractions of 1. The options take the place of the import
 * panel's settings, which ask only what the file leaves unsaid: an angle or a
 * polarization the file states, in its header lines or in a column's heading,
 * is kept, as in the window.
 *
 * @param filePath The file, by its full path.
 * @param [options]
 * @param [options.angle] The angle of incidence, degrees in the incident medium, for the curves whose file states none; 0 where neither does.
 * @param [options.pol] `'avg'`, `'s'` or `'p'`, for the curves whose file states none; `'avg'` where neither does. A column headed with its polarization, such as Rs, keeps it, and an A column headed with none is `'avg'`.
 * @param [options.quantity] For a table, `'T'`, `'R'` or `'A'` for every column; without it, what each column's heading says, and T where it says none.
 * @param [options.scale] For a table, how every column's values are written: `'fraction'`, `'percent'` or `'absorbance'` (A = −log10 T, read as T); without it, what the import makes of each column.
 * @param [options.xUnit] For a table, the unit of its wavelength column: `'nm'`, `'um'`, `'cm-1'` or `'eV'`; without it, what the import makes of it, and nm where it cannot tell.
 * @returns The file's curves.
 * @property format `'table'` or `'jcamp'`.
 * @property fileName The file's name, without its folder.
 * @property xUnit For a table, the unit its wavelength column was read in; null for a JCAMP-DX file, whose spectra each state their own.
 * @property skippedRows For a table, the lines inside its block of numbers that held no row and were left out, as the window reports them; 0 for a JCAMP-DX file.
 * @property curves One per column or spectrum, in the file's order.
 * @property curves[].name The name the window gives the curve.
 * @property curves[].quantity `'T'`, `'R'` or `'A'`, or `'PSI'` or `'DEL'` for a column of Ψ or Δ.
 * @property curves[].angle The angle of incidence, degrees.
 * @property curves[].pol `'avg'`, `'s'` or `'p'`.
 * @property curves[].wavelength The wavelengths, nm, rising.
 * @property curves[].values The value at each wavelength: a fraction of 1 for R, T and A, degrees for Ψ and Δ.
 * @throws a file that cannot be read or holds no spectrum the import reads
 * @throws an option it does not take, a value an option cannot take, or for a JCAMP-DX file an option other than angle and pol
 * @example
 * const file = require('path').join(require('os').homedir(), `scan-${Date.now()}.csv`);
 * require('fs').writeFileSync(file, '# AOI 8 deg\nWavelength (nm),%T\n500,91.2\n550,93.5\n600,92.8\n');
 * const read = tf.readSpectrumFile(file);
 * const [scan] = read.curves;
 * console.log(read.format, scan.name, scan.quantity, 'at', scan.angle, 'degrees:', scan.values);
 */
export function readSpectrumFile(filePath, options) {
    requireValue('readSpectrumFile', 'filePath', filePath, v => typeof v === 'string' && v.length > 0, 'the path of a file');
    const given = checkOptions('readSpectrumFile', options, READ_OPTIONS);
    checkReadOptions('readSpectrumFile', given);
    const { curves, ...file } = importedFile('readSpectrumFile', filePath, given);
    return { ...file, curves: curves.map(curveOf) };
}

// The curve `measured` names in a file: the one it holds, or the one `pick`
// names by its number from 0 or by its name.
function pickedCurve(filePath, curves, pick) {
    if (pick === undefined) {
        if (curves.length === 1) return curves[0];
        throw new Error(`measuredDifference: ${filePath} holds ${curves.length} curves (${curves.map(curve => curve.name).join(', ')}); curve names the one to compare, by its name or its number from 0`);
    }
    const found = Number.isInteger(pick) ? curves[pick] : curves.find(curve => curve.name === pick);
    requireValue('measuredDifference', 'curve', pick, () => found !== undefined,
        `the name or the number from 0 of one of the file's curves: ${curves.map(curve => curve.name).join(', ')}`);
    return found;
}

// The curve record `measured` stands for: a file's or one given.
function measuredCurve(measured, options) {
    if (typeof measured === 'string' && measured.length > 0) {
        const given = checkOptions('measuredDifference', options, ['curve', ...READ_OPTIONS, ...FIT_OPTIONS]);
        checkReadOptions('measuredDifference', given);
        return pickedCurve(measured, importedFile('measuredDifference', measured, given).curves, given.curve);
    }
    if (!measured || typeof measured !== 'object' || Array.isArray(measured)) {
        throw new Error('measuredDifference: measured is the path of a spectrum file or a curve as readSpectrumFile gives one');
    }
    checkOptions('measuredDifference', options, FIT_OPTIONS);
    return curveRecord('measuredDifference', measured);
}

/**
 * How a design differs from a measured curve, as the MCURVE merit row the
 * Fit… dialog writes scores it: the
 * [Measured Spectra](/data-exchange/measured-spectra/) window's for R, T and
 * A, the [Measured Ellipsometry](/data-exchange/measured-ellipsometry/)
 * window's for Ψ and Δ. The curve is sampled on the dialog's grid, kept to
 * the span every material of the design has data for, as the dialog keeps it,
 * and the design is read at each point at the curve's angle and polarization.
 * `rms` is that row's value and, for R, T and A, `ppef` the value of a PPEF
 * row measured against it. R, T and A are read on what the design's
 * [evaluation mode](/design/evaluation-modes/) says, as the merit function
 * scores it, averaged over a cone of incidence the design has. Ψ and Δ are
 * read on the front side alone, at an angle above 0, a uniform grid read
 * along Δ the short way round the circle, each Δ difference taken the short
 * way round too; a design scored on its back alone is refused.
 *
 * @param design The design.
 * @param measured The curve: the path of a spectrum file, read as `readSpectrumFile` reads it, or a curve as `readSpectrumFile` or `readEllipsometryFile` gives one, `{ wavelength, values, quantity, angle, pol, name }`, its values fractions of 1, quantity `'T'` unless given, angle 0 and pol `'avg'`; a Ψ or Δ curve also takes `side` and `deltaConvention`, `'front'` and `'azzam'` unless given, its values in degrees.
 * @param [options]
 * @param [options.curve] For a file of several curves, the one compared, by its name or its number from 0.
 * @param [options.angle] For a file, as `readSpectrumFile` takes it.
 * @param [options.pol] For a file, as `readSpectrumFile` takes it.
 * @param [options.quantity] For a file, as `readSpectrumFile` takes it.
 * @param [options.scale] For a file, as `readSpectrumFile` takes it.
 * @param [options.xUnit] For a file, as `readSpectrumFile` takes it.
 * @param [options.grid='measured'] The points compared: `'measured'`, the curve's own; `'thinned'`, every `thinEvery`-th of them and the last; or `'uniform'`, every `step` nm, the curve read between its points as the dialog reads it (PCHIP).
 * @param [options.step] With grid `'uniform'`, the step, nm; the curve's median spacing without it.
 * @param [options.thinEvery=2] With grid `'thinned'`, which points are kept, a whole number of 1 or more.
 * @param [options.from] The first wavelength compared, nm; the curve's first without it.
 * @param [options.to] The last wavelength compared, nm; the curve's last without it.
 * @param [options.db=false] For a T curve, `true` compares in dB, as the dialog's dB scale does, so a 0.1 dB miss counts the same at any level; points at or below 0 are left out.
 * @param [options.levelFree=false] For R, T and A, `true` takes off the mean difference before the RMS, as an MCURVE row with its level free scores, so a design that differs by the same amount everywhere scores 0.
 * @returns The difference.
 * @property mode How the design was scored: `'front'`, `'back'` or `'total'`; `'front'` for Ψ and Δ.
 * @property name The curve's name.
 * @property quantity `'T'`, `'R'` or `'A'`, or `'PSI'` or `'DEL'`.
 * @property angle The angle of incidence, degrees.
 * @property pol `'avg'`, `'s'` or `'p'`; `'avg'` for Ψ and Δ.
 * @property grid The grid.
 * @property db Whether it was compared in dB.
 * @property levelFree Whether the mean difference was taken off.
 * @property clipped `true` when fewer wavelengths were compared than asked for, because the range asked for goes past the curve or past the span the design's materials have data for.
 * @property rms The RMS of `deviation`, the MCURVE row's value: a fraction of 1, dB with `db`, or degrees for Ψ and Δ.
 * @property ppef For R, T and A, the PPEF row's value, dB: the spread, highest less lowest, of the measured value less the design's at each point, both in dB, so a difference by a constant number of dB scores 0. NaN where a point is at or below 0, which has no value in dB; null for Ψ and Δ.
 * @property level With `levelFree`, the mean difference taken off, in the unit of `rms`; otherwise null.
 * @property wavelength The wavelengths compared, nm.
 * @property measured The curve at each wavelength, a fraction of 1, dB with `db`, or degrees, Δ in the curve's own sign.
 * @property design The design at each wavelength, in the same unit and sign.
 * @property deviation `design` less `measured` at each wavelength, less `level` with `levelFree`; for Δ, from -180 to 180 degrees.
 * @throws a measured that is not a file path or a curve, a file that cannot be read or holds no spectrum, or a file of several curves without `curve`
 * @throws an option it does not take, a value an option cannot take, a from and to that are not a range, or no point to compare inside the range and the materials' span
 * @throws a Ψ or Δ curve at normal incidence or on the back side, or one on a design scored on its back alone
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: '0.5H L' });
 * const wavelength = [450, 500, 550, 600, 650];
 * const scan = { quantity: 'R', wavelength, values: [0.021, 0.012, 0.009, 0.011, 0.018] };
 * const d = tf.measuredDifference(design, scan);
 * console.log(d.mode, 'RMS', d.rms.toFixed(4), 'PPEF', d.ppef.toFixed(2), 'dB');
 * d.wavelength.forEach((w, i) => console.log(w, 'nm: design', d.design[i].toFixed(4), 'measured', d.measured[i]));
 * const psi = { quantity: 'PSI', angle: 70, wavelength, values: [12.1, 13.4, 14.2, 14.9, 15.3] };
 * console.log('Psi RMS', tf.measuredDifference(design, psi).rms.toFixed(2), 'degrees');
 */
export function measuredDifference(design, measured, options) {
    const curve = measuredCurve(measured, options);
    const angular = isAngular(curve.quantity);
    const fit = options ?? {};
    const config = fitConfig('measuredDifference', curve, fit);
    requireValue('measuredDifference', 'levelFree', fit.levelFree, v => v === undefined || (isBoolean(v) && !(v && angular)),
        `true or false; true for a T, R or A curve only, and this one is ${curve.quantity}`);
    requireResolved(design);
    requireKernel();
    const shown = withHerpinRecords(design);
    const { settings, snapshot, clipped } = fitSnapshot('measuredDifference', shown, curve, config);
    const levelFree = fit.levelFree === true;
    const block = { ...snapshot.operand, ...(levelFree ? { levelFree } : {}) };
    const rows = angular ? [block] : [block, makeOperand({ type: 'PPEF', refId: block.id, target: 0, weight: 1 })];
    const ctx = buildEvalContext(shown, designMaterialLookup(shown));
    const values = evaluateOperands(rows, ctx);
    const error = operandEvaluationErrors(values)[0];
    if (error) throw new Error(`measuredDifference: ${error}`);
    // Read on the cone rays the block's row was scored on, so the deviations
    // are the ones its RMS was taken over.
    const read = inConeRow(ctx, block, () => (angular ? measuredEllipsometryDeviations : measuredCurveDeviations)(block, ctx));
    return {
        mode: angular ? 'front' : resolveEvalMode(shown), name: curve.name, quantity: curve.quantity, angle: block.aoi, pol: block.pol,
        grid: settings.mode, db: settings.scale === 'dB', levelFree, clipped,
        rms: values[0], ppef: angular ? null : values[1], level: read.level,
        wavelength: block.sampleLambdas, measured: block.sampleTargets, design: read.design, deviation: read.deviations,
    };
}