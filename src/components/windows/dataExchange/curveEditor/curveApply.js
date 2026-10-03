/**
 * What a curve editor table becomes when it is applied: curves on the design,
 * built by makeMeasuredCurve exactly as the importers build them, or an
 * Integral Values weighting table.
 *
 * makeMeasuredCurve converts the wavelength unit to nm, percent to a fraction
 * and optical density, as absorbance, to transmittance, and sorts the points by
 * wavelength, so a curve typed here is stored as one read from a file would be.
 * dB is the one unit the importers do not read and is converted here. A row
 * missing its wavelength or its value is left out of that column's curve.
 */
import { makeMeasuredCurve, xToNm } from '../../../../utils/io/spectrumTable.js';
import { columnSeries, isValueTable, sortedRows } from './curveTable.js';
import { toStored, typedUnitField } from './units.js';

const QUANTITY_SYMBOL = { T: 'T', R: 'R', A: 'A', PSI: 'Ψ', DEL: 'Δ' };

/**
 * Why the table cannot be applied, or null. 'needTwoRows' is a weighting or a
 * gain with fewer than two complete rows, which have no span between them;
 * 'noPoints' a curve table in which no row has both a wavelength and a value.
 */
export function applyProblem(table) {
    const counts = table.columns.map((_, index) => columnSeries(table, index).x.length);
    if (isValueTable(table.kind)) return counts[0] >= 2 ? null : 'needTwoRows';
    return counts.some(count => count > 0) ? null : 'noPoints';
}

// makeMeasuredCurve's inputs for value column `index`: the points as typed and
// what the unit says they are.
function curveInput(table, index) {
    const { unit, quantity } = table.columns[index];
    const series = columnSeries(table, index);
    return {
        x: series.x,
        xUnit: table.xUnit,
        y: unit === 'dB' ? series.y.map(value => toStored(value, unit)) : series.y,
        quantity,
        isPercent: unit === '%',
        isAbsorbance: unit === 'OD',
    };
}

/**
 * One new curve per value column that holds a point, named after the column
 * or, unnamed, after its quantity. Conditions are left at the importers'
 * defaults, normal incidence and average polarization, and are set on the
 * curve's card. A table read from a file names the file as the curves' source.
 * A column in dB or OD is remembered on its curve (units.js).
 */
export function curvesFromTable(table) {
    return table.columns.flatMap((column, index) => {
        const input = curveInput(table, index);
        if (!input.x.length) return [];
        const curve = makeMeasuredCurve({
            ...input, name: column.name.trim() || QUANTITY_SYMBOL[column.quantity],
            source: table.source || 'typed', aoi: 0, pol: 'avg',
        });
        return [{ ...curve, ...typedUnitField(column.unit) }];
    });
}

// A trim bound outside the new points cuts nothing, and is dropped.
function keptTrims(curve, x) {
    const inside = value => Number.isFinite(value) && x.length && value >= x[0] && value <= x[x.length - 1];
    return {
        ...(inside(curve.trimMin) ? { trimMin: curve.trimMin } : {}),
        ...(inside(curve.trimMax) ? { trimMax: curve.trimMax } : {}),
    };
}

/**
 * The curve with the table's points in place of its own, and the unit they
 * were typed in. Everything else it carries, its id, name, colour, conditions
 * and trim, stays.
 */
export function editedCurve(curve, table) {
    const built = makeMeasuredCurve({ ...curveInput(table, 0), quantity: curve.quantity });
    const { trimMin: _min, trimMax: _max, yTypedUnit: _unit, ...rest } = curve;
    return {
        ...rest,
        x: built.x, y: built.y, xUnit: built.xUnit, yWasPercent: built.yWasPercent,
        ...typedUnitField(table.columns[0].unit),
        ...keptTrims(curve, built.x),
    };
}

/**
 * A value table, an Integral Values weighting or a gain, as [[λ nm, value]] in
 * ascending wavelength.
 */
export function pointsFromTable(table) {
    const rows = sortedRows(table.rows.map(row => [xToNm(row[0], table.xUnit), row[1]]));
    return rows.filter(row => Number.isFinite(row[0]) && Number.isFinite(row[1]));
}
