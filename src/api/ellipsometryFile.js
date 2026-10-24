// An ellipsometer file read as Measured Ellipsometry's import reads it
// (measuredEllipsometry/importedCurves.js).

import path from 'node:path';
import mainPaths from '../main/paths.js';
import { columnQuantities, ellipsometryColumnCurves, ellipsometryFileConditions } from '../components/windows/dataExchange/measuredEllipsometry/importedCurves.js';
import { looksLikeCosDelta } from '../components/windows/dataExchange/measuredEllipsometry/model.js';
import { parseSpectrumTable, X_UNIT_KEYS } from '../utils/io/spectrumTable.js';
import { checkOptions, requireValue, isAngle, isSide } from './check.js';
import { DELTA_CONVENTIONS } from './curveRecords.js';

const { readTextAuto } = mainPaths;

const OPTIONS = ['angle', 'side', 'deltaConvention', 'xUnit', 'quantities'];
const COLUMN_TYPES = [null, 'PSI', 'DEL'];

// Whether `v` gives each of `count` columns a type the panel's buttons set.
const isColumnTypes = (v, count) => Array.isArray(v) && v.length === count && v.every(type => COLUMN_TYPES.includes(type));

// A Ψ or Δ curve as the API gives it, from the curve record the import makes.
const curveOf = curve => ({
    name: curve.name, quantity: curve.quantity, angle: curve.aoi, side: curve.side,
    deltaConvention: curve.quantity === 'DEL' ? curve.deltaConvention : null, cosDelta: looksLikeCosDelta(curve),
    wavelength: curve.x, values: curve.y,
});

/**
 * Reads an ellipsometer file as the
 * [Measured Ellipsometry](/data-exchange/measured-ellipsometry/) window's
 * import reads it: a CSV or text table of a wavelength column and columns of
 * Ψ and Δ in degrees. Each column is typed as the window types it: a column
 * that names itself Ψ or Δ is taken at its word; otherwise, of two columns,
 * the one that leaves 0 to 90 degrees is Δ, and where neither does the first
 * is Ψ. The curves are the ones the window's Add all adds, the columns of no
 * type left out, their wavelengths in nm in rising order. The options take
 * the place of the import panel's settings: an angle the file states, in its
 * header lines or in a column's heading, is kept, as in the window, and the
 * side its header states fills the panel, which `side` replaces; TFStudio's
 * own Ψ/Δ exports state both.
 *
 * @param filePath The file, by its full path.
 * @param [options]
 * @param [options.angle] The angle of incidence, degrees in the incident medium, for the columns whose file states none; 70, the panel's opening angle, where neither does.
 * @param [options.side] `'front'` or `'back'`, the side measured; without it, the side the file's header states, or `'front'`.
 * @param [options.deltaConvention='azzam'] The sign the file writes Δ in: `'azzam'`, the Azzam-Bashara sign most ellipsometers write, or `'reversed'`, 360 degrees less it.
 * @param [options.xUnit] The unit of the wavelength column: `'nm'`, `'um'`, `'cm-1'` or `'eV'`; without it, what the import makes of it, and nm where it cannot tell.
 * @param [options.quantities] Each column's type, in the file's order: `'PSI'`, `'DEL'`, or null for the type the import gives it, as the panel's type buttons set it; a column with no type is left out.
 * @returns The file's Ψ and Δ.
 * @property fileName The file's name, without its folder.
 * @property xUnit The unit its wavelength column was read in.
 * @property skippedRows The lines inside its block of numbers that held no row and were left out.
 * @property curves One per column with a type, in the file's order.
 * @property curves[].name The name the window gives the curve.
 * @property curves[].quantity `'PSI'` or `'DEL'`.
 * @property curves[].angle The angle of incidence, degrees.
 * @property curves[].side `'front'` or `'back'`.
 * @property curves[].deltaConvention The sign a Δ is written in; null for Ψ.
 * @property curves[].cosDelta `true` for a Δ that never leaves -1 to 1 and goes below 0: cos Δ written under a heading that says Δ, which the window warns of before a fit runs on it.
 * @property curves[].wavelength The wavelengths, nm, rising.
 * @property curves[].values The value at each wavelength, degrees.
 * @throws a file that cannot be read or holds no table of numbers
 * @throws an option it does not take, or a value an option cannot take
 * @example
 * const file = require('path').join(require('os').homedir(), `witness-${Date.now()}.csv`);
 * require('fs').writeFileSync(file, '# AOI 65 deg, front side\nWavelength (nm),Psi (deg),Delta (deg)\n500,24.9,242.6\n600,20.7,218.4\n700,18.1,189.5\n');
 * const read = tf.readEllipsometryFile(file);
 * for (const curve of read.curves) console.log(curve.quantity, 'at', curve.angle, 'degrees:', curve.values);
 */
export function readEllipsometryFile(filePath, options) {
    const call = 'readEllipsometryFile';
    requireValue(call, 'filePath', filePath, v => typeof v === 'string' && v.length > 0, 'the path of a file');
    const { angle, side, deltaConvention = 'azzam', xUnit, quantities } = checkOptions(call, options, OPTIONS);
    requireValue(call, 'angle', angle, v => v === undefined || isAngle(v), 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue(call, 'side', side, v => v === undefined || isSide(v), "'front' or 'back'");
    requireValue(call, 'deltaConvention', deltaConvention, v => DELTA_CONVENTIONS.includes(v), "'azzam' or 'reversed'");
    requireValue(call, 'xUnit', xUnit, v => v === undefined || Object.hasOwn(X_UNIT_KEYS, v), "'nm', 'um', 'cm-1' or 'eV'");
    let text;
    try { text = readTextAuto(filePath); } catch (err) { throw new Error(`${call}: ${filePath}: ${err.message}`); }
    const parsed = parseSpectrumTable(text);
    if (!parsed.ok) throw new Error(`${call}: ${filePath} holds no table of numbers Measured Ellipsometry's import reads`);
    requireValue(call, 'quantities', quantities, v => v === undefined || isColumnTypes(v, parsed.columns.length),
        `a list of one type per column of the file (${parsed.columns.length}), each 'PSI', 'DEL' or null`);
    const stated = ellipsometryFileConditions(parsed);
    const ov = Object.fromEntries((quantities || []).map((quantity, index) => [index, quantity ? { quantity } : {}]));
    const settings = {
        fileName: path.basename(filePath), xUnit: xUnit ?? stated.xUnit,
        aoi: angle ?? stated.aoi ?? 70, side: side ?? stated.side ?? 'front', deltaConvention, ov,
    };
    const typed = columnQuantities(parsed, ov);
    const curves = ellipsometryColumnCurves(parsed, settings).filter((curve, index) => typed[index] && curve.x.length);
    return { fileName: settings.fileName, xUnit: settings.xUnit, skippedRows: parsed.skippedRows || 0, curves: curves.map(curveOf) };
}
