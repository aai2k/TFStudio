/**
 * A spectrum file's text turned into the measured curves Measured Spectra adds
 * to a design: a JCAMP-DX file's spectra, or a table's columns with the import
 * panel's settings. The window's import and the API's readSpectrumFile both
 * read files here, so a script gets the curves the window would add.
 */
import { parseJcampDx } from '../../../../utils/io/jcampDx.js';
import { makeMeasuredCurve, parseSpectrumTable, X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { isJcampText } from './model.js';

/**
 * The text of a spectrum file read as the import reads it: `{ jcamp }` for a
 * JCAMP-DX file, `{ table }` for a text table, or `{ error: 'parse' }` when
 * neither holds a spectrum.
 */
export function readSpectrumText(text) {
    if (isJcampText(text)) {
        const jcamp = parseJcampDx(text);
        return jcamp.ok ? { jcamp } : { error: 'parse' };
    }
    const table = parseSpectrumTable(text);
    return table.ok ? { table } : { error: 'parse' };
}

// Absorptance is what the sample keeps of everything that reached it, so it has
// no polarization to pick and the panel asks for none. Stamping the setting
// left over from another column would model the curve at the wrong one.
const polarizationFor = (quantity, pol) => (quantity === 'A' ? 'avg' : pol);

/**
 * The curves a JCAMP-DX file adds, one per spectrum, at the panel's angle
 * `aoi` and polarization `pol`: a JCAMP file states neither.
 */
export function jcampCurves(jcamp, fileName, { aoi, pol }) {
    const baseName = (fileName || 'spectrum').replace(/\.[^.]+$/, '');
    return jcamp.spectra.map((spectrum, index) => makeMeasuredCurve({
        name: spectrum.title && spectrum.title !== 'JCAMP-DX'
            ? spectrum.title
            : `${baseName}${jcamp.spectra.length > 1 ? ' ' + (index + 1) : ''}`,
        x: spectrum.x,
        xUnit: spectrum.xUnit,
        y: spectrum.y,
        quantity: spectrum.quantity || 'T',
        isPercent: spectrum.isPercent,
        isAbsorbance: spectrum.isAbsorbance,
        source: fileName,
        aoi,
        pol: polarizationFor(spectrum.quantity || 'T', pol),
    }));
}

/**
 * The panel's settings once a table is read: the conditions the file states
 * replace the panel's own, and a file that declares none leaves them as they
 * were, so an instrument export without a header imports as before. `aoi` and
 * `pol` are undefined where the file states none; `xUnit` is the unit the
 * table's first column was read in, nm where it could not be told.
 */
export function tableConditions(table) {
    const aoi = table.aoi ?? table.columns.find(column => Number.isFinite(column.aoi))?.aoi;
    return {
        aoi: Number.isFinite(aoi) ? aoi : undefined,
        pol: table.pol || undefined,
        xUnit: table.xUnit === X_UNITS.UNKNOWN ? X_UNITS.NM : table.xUnit,
    };
}

function columnScale(column, override) {
    return override.yscale || (column.isAbsorbance ? 'absorbance' : (column.isPercent ? 'percent' : 'fraction'));
}

function defaultCurveName(fileName, table, column) {
    const base = (fileName || 'spectrum').replace(/\.[^.]+$/, '');
    return table.columns.length > 1 ? `${base}: ${column.name}` : base;
}

/**
 * The curves a table adds, one per column, read in `xUnit` at the panel's
 * angle `aoi` and polarization `pol` where a column states none of its own: a
 * column headed Rs is s-polarized whatever the panel says.
 * `overrides[i]` holds what the panel sets on column i: its `name`,
 * `quantity` and `yscale` ('fraction', 'percent' or 'absorbance').
 */
export function tableCurves(table, { fileName, xUnit, aoi, pol, overrides = [] }) {
    return table.columns.map((column, index) => {
        const override = overrides[index] || {};
        const resolvedScale = columnScale(column, override);
        const quantity = override.quantity || column.quantity || 'T';
        return makeMeasuredCurve({
            name: override.name || defaultCurveName(fileName, table, column),
            x: column.x || table.x,
            xUnit,
            y: column.values,
            quantity,
            isPercent: resolvedScale === 'percent',
            isAbsorbance: resolvedScale === 'absorbance',
            source: fileName,
            aoi: Number.isFinite(column.aoi) ? column.aoi : aoi,
            pol: column.pol ?? polarizationFor(quantity, pol),
        });
    });
}
