/**
 * The design's own curve behind each value column of a curve editor: the same
 * quantity, at the curve's angle, polarization and side, over the column's
 * span, in the column's units. It answers the first question about a typed or
 * edited curve, whether the design can reach it. A T, R or A column is drawn
 * from the Measured Spectra preview (designPreview.js); a Ψ or Δ column from
 * the Ellipsometry window's spectral evaluation, Δ in the curve's own sign.
 */
import { nmToX, xToNm } from '../../../../utils/io/spectrumTable.js';
import { toDeltaConvention } from '../../../../utils/physics/thinFilmMath.js';
import { computeSpectral } from '../../analysis/ellipsometryEvaluation/spectrum.js';
import { designPreview, designSeriesKey, previewGrid } from '../spectrumExchange/designPreview.js';
import { columnSeries, isValueTable } from './curveTable.js';
import { fromStored } from './units.js';

/** The conditions a new curve gets until its card says otherwise. */
export const NEW_CURVE_CONDITIONS = { aoi: 0, pol: 'avg', side: 'front', deltaConvention: 'azzam' };

function photometricCurve(design, nm, quantity, conditions, missing) {
    const curve = { x: nm, y: nm, quantity, aoi: conditions.aoi ?? 0, pol: conditions.pol || 'avg' };
    const { data } = designPreview(design, curve, missing);
    const values = data?.series?.[0]?.[designSeriesKey(curve)];
    return values ? { lambda: data.lambda, values } : null;
}

function ellipsometricCurve(design, nm, quantity, conditions, missing) {
    if (missing.length) return null;
    try {
        const spectrum = computeSpectral(design, {
            side: conditions.side || 'front', thetaDeg: conditions.aoi ?? 0,
            ...previewGrid(nm[0], nm[nm.length - 1]),
        });
        const values = quantity === 'PSI'
            ? spectrum.psi
            : toDeltaConvention(spectrum.delta, conditions.deltaConvention || 'azzam');
        return { lambda: spectrum.x, values };
    } catch (_) {
        return null;
    }
}

/** A column's wavelengths in nm, ascending. */
function columnNm(table, index) {
    return columnSeries(table, index).x
        .map(value => xToNm(value, table.xUnit))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
}

/**
 * One backdrop per value column, { x, y } in the table's units, or null where
 * there is none to draw: a weighting or a gain, a column with no points, or a design that
 * cannot be evaluated.
 */
export function designBackdrop(design, table, conditions, missing = []) {
    return table.columns.map((column, index) => {
        if (!design || isValueTable(table.kind)) return null;
        const nm = columnNm(table, index);
        if (!nm.length) return null;
        const build = table.kind === 'ellipsometry' ? ellipsometricCurve : photometricCurve;
        const curve = build(design, nm, column.quantity, conditions, missing);
        if (!curve) return null;
        return {
            x: curve.lambda.map(lambda => nmToX(lambda, table.xUnit)),
            y: curve.values.map(value => fromStored(value, column.unit)),
        };
    });
}

// The shortest and longest wavelength of a column's points, in nm.
function spanNm(table, index) {
    let low = Infinity;
    let high = -Infinity;
    for (const x of columnSeries(table, index).x) {
        const nm = xToNm(x, table.xUnit);
        if (nm < low) low = nm;
        if (nm > high) high = nm;
    }
    return `${low}/${high}`;
}

/**
 * What the backdrops depend on, as one string: the design aside, a change to a
 * value that leaves every column's span, quantity and unit as they were needs
 * no new evaluation.
 */
export function backdropKey(table) {
    const spans = table.columns.map((column, index) => `${column.quantity}/${column.unit}/${spanNm(table, index)}`);
    return `${table.kind}|${table.xUnit}|${spans.join('|')}`;
}
