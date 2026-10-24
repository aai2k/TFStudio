/**
 * An ellipsometer file's table turned into the Ψ and Δ curves Measured
 * Ellipsometry adds to a design. The window's import and the API's
 * readEllipsometryFile both make curves here, so a script gets the curves the
 * window would add.
 */
import { makeMeasuredCurve, X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { typeColumns } from './model.js';

/** The name a column's curve takes before the operator renames it. */
export function defaultCurveName(fileName, parsed, column) {
    const base = (fileName || 'ellipsometry').replace(/\.[^.]+$/, '');
    return parsed.columns.length > 1 ? `${base}: ${column.name}` : base;
}

/**
 * What a read table states about itself, which the import panel takes over:
 * the angle of incidence from its header or its first column that names one,
 * the side its header names, both undefined where it states none, and the
 * unit of its wavelength column, nm where that could not be told.
 */
export function ellipsometryFileConditions(parsed) {
    const aoi = parsed.aoi ?? parsed.columns.find(column => Number.isFinite(column.aoi))?.aoi;
    return {
        aoi: Number.isFinite(aoi) ? aoi : undefined,
        side: parsed.side || undefined,
        xUnit: parsed.xUnit === X_UNITS.UNKNOWN ? X_UNITS.NM : parsed.xUnit,
    };
}

/**
 * Whether each column is Ψ ('PSI') or Δ ('DEL'): the type the operator set in
 * `ov[i].quantity`, otherwise what typeColumns makes of the file, and null for
 * a column neither types, which Add all leaves out.
 */
export function columnQuantities(parsed, ov = {}) {
    const detected = typeColumns(parsed.columns);
    return parsed.columns.map((_column, index) => (ov[index] || {}).quantity || detected[index] || null);
}

/**
 * Every column of a read table as the import would add it, read in `xUnit` at
 * the panel's angle `aoi` where a column states none of its own, on `side`,
 * a Δ column written in `deltaConvention`. `ov[i]` holds what the panel sets
 * on column i: its `name` and `quantity`. A column of no type is offered as Ψ,
 * as the window's preview offers it.
 */
export function ellipsometryColumnCurves(parsed, { fileName, xUnit, aoi, side, deltaConvention, ov = {} }) {
    const quantities = columnQuantities(parsed, ov);
    return parsed.columns.map((column, index) => makeMeasuredCurve({
        name: (ov[index] || {}).name || defaultCurveName(fileName, parsed, column),
        x: column.x || parsed.x,
        xUnit,
        y: column.values,
        quantity: quantities[index] || 'PSI',
        aoi: Number.isFinite(column.aoi) ? column.aoi : aoi,
        pol: 'avg',
        side,
        deltaConvention,
        source: fileName,
    }));
}
