// The measured curves a design holds: adding them as the import of Measured
// Spectra or Measured Ellipsometry adds them, the merit rows their Fit…
// dialogs add, and the files their Export tabs write.

import fs from 'node:fs';
import { measuredExportDocument, measuredFitConstraintsInvalid, measuredFitMeritOperands } from '../components/windows/dataExchange/spectrumExchange/model.js';
import { measuredDocument } from '../components/windows/dataExchange/measuredEllipsometry/model.js';
import { withHerpinRecords } from '../utils/materials/designMaterials.js';
import { requireResolved } from './materials.js';
import { checkOptions, requireValue, refusal, isNonNegative } from './check.js';
import { curveRecord, fitConfig, fitSnapshot, GRID_OPTIONS, isAngular } from './curveRecords.js';

// Where each kind of curve lives on a design.
const SPECTRA = 'measuredCurves';
const ELLIPSOMETRY = 'measuredEllipsometry';
const listOf = record => (isAngular(record.quantity) ? ELLIPSOMETRY : SPECTRA);

/**
 * Adds measured curves to a design as the import of the
 * [Measured Spectra](/data-exchange/measured-spectra/) and
 * [Measured Ellipsometry](/data-exchange/measured-ellipsometry/) windows adds
 * them, each with an id of its own: R, T and A to the design's spectra, Ψ and
 * Δ to its ellipsometry, after the curves it holds. The design saves them, the
 * windows show them, and `fitMeasured` turns one into merit rows. A curve
 * holds what it is given: the file it came from, the unit that file was
 * written in and whether it was in percent are not part of it.
 *
 * @param design The design.
 * @param curves A curve or a list of curves, as `readSpectrumFile` or `readEllipsometryFile` gives them, `{ wavelength, values, quantity, angle, pol, name }`: R, T and A as fractions of 1, quantity `'T'` unless given, angle 0 and pol `'avg'`; a Ψ or Δ curve also takes `side` and `deltaConvention`, `'front'` and `'azzam'` unless given, its values in degrees.
 * @returns The design with the curves added.
 * @throws a curve that is not an object of those fields, or a value a field cannot take
 * @example
 * const design = tf.newDesign({ name: 'AR' });
 * const scan = { name: 'Bench R', quantity: 'R', wavelength: [450, 550, 650], values: [0.021, 0.009, 0.018] };
 * const held = tf.addMeasuredCurves(design, [scan]);
 * console.log(held.measuredCurves.map(curve => curve.name));
 */
export function addMeasuredCurves(design, curves) {
    const given = Array.isArray(curves) ? curves : [curves];
    requireValue('addMeasuredCurves', 'curves', curves, () => given.length > 0, 'a curve or a list of curves');
    const records = given.map(curve => curveRecord('addMeasuredCurves', curve));
    const lists = {};
    for (const record of records) {
        const key = listOf(record);
        lists[key] = [...(lists[key] ?? design[key] ?? []), record];
    }
    return { ...design, ...lists };
}

// The curves the design holds of the names given, all of one list.
function heldCurves(call, design, names) {
    const held = [...(design[SPECTRA] || []), ...(design[ELLIPSOMETRY] || [])];
    const all = held.map(curve => curve.name);
    return names.map((name) => {
        const found = held.filter(curve => curve.name === name);
        requireValue(call, 'curve', name, () => found.length > 0, all.length
            ? `the name of a curve the design holds: ${all.join(', ')}` : 'the name of a curve the design holds, and it holds none');
        if (found.length > 1) throw new Error(`${call}: the design holds ${found.length} curves named '${name}'; rename one in Measured Spectra or Measured Ellipsometry, or add it again under another name`);
        return found[0];
    });
}

const FIT_OPTIONS = [...GRID_OPTIONS, 'weight', 'output', 'constraints'];
const CONSTRAINTS = ['min', 'max', 'weight'];

// The Fit… dialog's thickness constraint fields from `constraints`, after
// refusing what the dialog would refuse.
function constraintFields(constraints) {
    if (constraints === undefined) return { constraintsEnabled: false };
    const { min = 10, max = 1000, weight = 1 } = checkOptions('fitMeasured constraints', constraints, CONSTRAINTS);
    const fields = { constraintsEnabled: true, minThicknessNm: min, maxThicknessNm: max, constraintWeight: weight };
    if (measuredFitConstraintsInvalid(fields)) {
        throw new Error(`fitMeasured: constraints are { min, max, weight }: 0 < min <= max, in nm, and a weight of 0 or more; given ${JSON.stringify({ min, max, weight })}`);
    }
    return fields;
}

/**
 * Adds the merit rows the Fit… dialog adds for a measured curve the design
 * holds: Measured Spectra's for R, T and A, Measured Ellipsometry's for Ψ and
 * Δ. The MCURVE block holds the curve sampled on the dialog's grid, kept to
 * the span every material of the design has data for, as the dialog keeps it;
 * a Ψ or Δ block is scored on the front side alone. With `constraints`, an MNT
 * and an MXT row follow it, as the dialog's thickness constraints add them.
 * `measuredDifference` with the same options gives the block's value.
 *
 * @param design The design.
 * @param curve The name of a curve the design holds, as `addMeasuredCurves` added it or a window imported it.
 * @param [options]
 * @param [options.grid='measured'] The points kept: `'measured'`, the curve's own; `'thinned'`, every `thinEvery`-th of them and the last; or `'uniform'`, every `step` nm, the curve read between its points as the dialog reads it (PCHIP), Δ the short way round the circle.
 * @param [options.step] With grid `'uniform'`, the step, nm; the curve's median spacing without it.
 * @param [options.thinEvery=2] With grid `'thinned'`, which points are kept, a whole number of 1 or more.
 * @param [options.from] The first wavelength kept, nm; the curve's first without it.
 * @param [options.to] The last wavelength kept, nm; the curve's last without it.
 * @param [options.db=false] For a T curve, `true` fits in dB, as the dialog's dB scale does; points at or below 0 are left out.
 * @param [options.weight=1] The block's weight, 0 or more.
 * @param [options.output='append'] `'append'` adds the rows after the merit rows the design has; `'replace'` puts them in place of all of them.
 * @param [options.constraints] `{ min: 10, max: 1000, weight: 1 }`, thicknesses in nm, to add the dialog's MNT and MXT rows over every layer; without it, none.
 * @returns The design with the rows added.
 * @throws a curve the design does not hold, or two curves of that name
 * @throws an option it does not take, a value an option cannot take, a from and to that are not a range, or no point to keep inside the range and the materials' span
 * @throws a Ψ or Δ curve at normal incidence or on the back side, or one on a design scored on its back alone
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: '0.5H L' });
 * const scan = { name: 'Bench R', quantity: 'R', wavelength: [450, 500, 550, 600, 650], values: [0.021, 0.012, 0.009, 0.011, 0.018] };
 * const fitted = tf.fitMeasured(tf.addMeasuredCurves(design, scan), 'Bench R', { constraints: { min: 20 } });
 * console.log(fitted.meritOperands.map(row => row.type), tf.merit(fitted).total);
 */
export function fitMeasured(design, curve, options) {
    const call = 'fitMeasured';
    const { weight = 1, output = 'append', constraints, ...grid } = checkOptions(call, options, FIT_OPTIONS);
    requireValue(call, 'curve', curve, v => typeof v === 'string', 'the name of a curve the design holds');
    const [held] = heldCurves(call, design, [curve]);
    const config = fitConfig(call, held, grid);
    requireValue(call, 'weight', weight, isNonNegative, 'a weight of 0 or more');
    requireValue(call, 'output', output, v => v === 'append' || v === 'replace', "'append' or 'replace'");
    requireResolved(design);
    const settings = { ...config, weight, outputMode: output, ...constraintFields(constraints) };
    const { settings: used, snapshot } = fitSnapshot(call, withHerpinRecords(design), held, settings);
    return { ...design, meritOperands: measuredFitMeritOperands(design.meritOperands, snapshot.operand, used) };
}

const EXPORT_OPTIONS = ['curves', 'format', 'xUnit', 'scale', 'overwrite'];
const SCALES = ['percent', 'fraction'];
// The wavelength units each window's Export tab offers.
const SPECTRA_UNITS = ['nm', 'um', 'cm-1'];
const ELLIPSOMETRY_UNITS = ['nm', 'um', 'eV'];

// The curves an export writes: those `names` names, all of one kind, or
// without names the design's spectra, or its Ψ and Δ when it holds none.
function exportedCurves(call, design, names) {
    requireValue(call, 'curves', names, v => v === undefined || (Array.isArray(v) && v.length > 0 && v.every(name => typeof name === 'string')),
        'a list of names of curves the design holds');
    const spectra = design[SPECTRA] || [];
    const list = names ? heldCurves(call, design, names) : (spectra.length ? spectra : design[ELLIPSOMETRY] || []);
    if (!list.length) throw new Error(`${call}: the design holds no measured curve`);
    if (list.some(curve => isAngular(curve.quantity) !== isAngular(list[0].quantity))) {
        throw new Error(`${call}: curves are all R, T and A, which Measured Spectra writes, or all Ψ and Δ, which Measured Ellipsometry writes`);
    }
    return list;
}

/**
 * Writes measured curves the design holds to a file as the Export tab writes
 * them: the [Measured Spectra](/data-exchange/measured-spectra/) window's for
 * R, T and A, as CSV, its condition lines above the columns, or as JCAMP-DX;
 * the [Measured Ellipsometry](/data-exchange/measured-ellipsometry/)
 * window's for Ψ and Δ, as CSV in degrees. Without options, the window's
 * factory format: CSV, nm, R, T and A in percent.
 *
 * @param design The design.
 * @param filePath The file to write, by its full path.
 * @param [options]
 * @param [options.curves] The names of the curves written, all R, T and A or all Ψ and Δ. Without it, every R, T and A curve the design holds, or its Ψ and Δ when it holds none.
 * @param [options.format='csv'] `'csv'`, or `'jcamp'` for JCAMP-DX, which R, T and A take.
 * @param [options.xUnit='nm'] The unit of the wavelength column, as each window's Export tab offers it: `'nm'`, `'um'` or `'cm-1'` for R, T and A, `'nm'`, `'um'` or `'eV'` for Ψ and Δ.
 * @param [options.scale='percent'] For R, T and A, `'percent'` or `'fraction'`.
 * @param [options.overwrite=false] Write over a file that is already there, as the window's save dialog asks before it does.
 * @throws a design that holds no measured curve, a name of a curve it does not hold, or curves of both kinds
 * @throws an option it does not take, a value an option cannot take, or a file that is already there, without `overwrite`
 * @example
 * const file = require('path').join(require('os').homedir(), `bench-${Date.now()}.csv`);
 * const scan = { name: 'Bench R', quantity: 'R', angle: 8, wavelength: [450, 550, 650], values: [0.021, 0.009, 0.018] };
 * tf.exportMeasuredCurves(tf.addMeasuredCurves(tf.newDesign({ name: 'AR' }), scan), file);
 * console.log(require('fs').readFileSync(file, 'utf8'));
 */
export function exportMeasuredCurves(design, filePath, options) {
    const call = 'exportMeasuredCurves';
    requireValue(call, 'filePath', filePath, v => typeof v === 'string' && v.length > 0, 'the path of a file');
    const { curves, format = 'csv', xUnit = 'nm', scale, overwrite = false } = checkOptions(call, options, EXPORT_OPTIONS);
    const list = exportedCurves(call, design, curves);
    const angular = isAngular(list[0].quantity);
    requireValue(call, 'format', format, v => v === 'csv' || (!angular && v === 'jcamp'), angular ? "'csv' for Ψ and Δ" : "'csv' or 'jcamp'");
    requireValue(call, 'xUnit', xUnit, v => (angular ? ELLIPSOMETRY_UNITS : SPECTRA_UNITS).includes(v), angular ? "'nm', 'um' or 'eV' for Ψ and Δ" : "'nm', 'um' or 'cm-1'");
    requireValue(call, 'scale', scale, v => v === undefined || (!angular && SCALES.includes(v)),
        angular ? 'not taken for Ψ and Δ, which are written in degrees' : "'percent' or 'fraction'");
    requireValue(call, 'overwrite', overwrite, v => typeof v === 'boolean', 'true or false');
    if (!overwrite && fs.existsSync(filePath)) {
        throw refusal('fileExists', { call, path: filePath }, `${filePath} exists; pass { overwrite: true } to write over it`);
    }
    const document = angular
        ? measuredDocument(design, { curves: list, xUnit })
        : measuredExportDocument(design, format, { curves: list, xUnit, asPercent: scale !== 'fraction' });
    fs.writeFileSync(filePath, document.text, 'utf8');
}