/**
 * Bulk-material phase, GD, GDD, CDC and TOD over a range of wavelengths for a
 * slab of one material, as the Material Dispersion window plots and tabulates
 * them and the API's materialDispersion returns them.
 */

import { knotGrid, sampleKnots } from '../../components/windows/analysis/knots.js';
import { chromaticDispersionCoefficient } from '../physics/thinFilmMath.js';
import { toSignificantFigures } from '../math/significantFigures.js';
import { materialKnotWavelengths, materialPropagationDispersion } from './materialDispersion.js';

// CDC is GDD taken against wavelength, so its magnitude is set by the
// conversion rather than by the material, and the table writes it to
// significant figures rather than decimals.
const CDC_SIGNIFICANT_FIGURES = 5;

// The window's grid: 2000 steps over the range, never finer than 0.2 nm, the
// last sample on the range's end.
function sampleWavelengths(start, end) {
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    const spacing = Math.max(0.2, (high - low) / 2000);
    const count = Math.floor((high - low) / spacing + 1e-12) + 1;
    const result = Array.from({ length: count }, (_, index) => low + index * spacing);
    if (high - result[result.length - 1] > 1e-9) result.push(high);
    return result;
}

/**
 * The dispersion of a slab `thicknessMm` thick of `material` from `start` to
 * `end` nm, on the window's grid with a sample on each table knot in range, or
 * null without a material. `values` holds one materialPropagationDispersion
 * result per wavelength of `lambda`; `knotSamples` the one-sided values at
 * each knot; `invalid` the results that have no value.
 */
export function materialDispersionSpectrum(material, start, end, thicknessMm) {
    if (!material) return null;
    const at = (wavelength, knotSide) =>
        materialPropagationDispersion(material, wavelength, thicknessMm, knotSide);
    const grid = knotGrid(
        sampleWavelengths(start, end), materialKnotWavelengths(material), start, end);
    const lambda = grid.wavelengths;
    const values = lambda.map(wavelength => at(wavelength));
    const continuityOrders = values
        .map(value => value.phaseContinuousOrder)
        .filter(Number.isFinite);
    return {
        lambda,
        values,
        materialName: material.name || material.id || '',
        knotSamples: sampleKnots(lambda, grid.knots, at),
        invalid: values.filter(value => !value.valid),
        model: values.find(value => value.model)?.model || 'Unavailable',
        phaseModel: values.find(value => value.phaseModel)?.phaseModel || 'Unavailable',
        phaseContinuousOrder: continuityOrders.length ? Math.min(...continuityOrders) : 0,
    };
}

/**
 * One row per wavelength of `spectrum`: the wavelength, nm; `outside`, the
 * material's name where the value was taken outside its data, else ''; the
 * phase, degrees; GD, fs; GDD, fs²; CDC, fs/nm; TOD, fs³; and the group index.
 * A sample with no value has NaN in each.
 */
export function materialDispersionRows(spectrum) {
    return spectrum.values.map((value, index) => ({
        lambda: spectrum.lambda[index],
        outside: value.outsideRange ? spectrum.materialName : '',
        phase: value.valid ? value.phaseRad * 180 / Math.PI : NaN,
        gd: value.valid ? value.gdFs : NaN,
        gdd: value.valid ? value.gddFs2 : NaN,
        cdc: value.valid ? chromaticDispersionCoefficient(value.gddFs2, spectrum.lambda[index]) : NaN,
        tod: value.valid ? value.todFs3 : NaN,
        groupIndex: value.valid ? value.groupIndex : NaN,
    }));
}

/**
 * The window's results table: its columns (materialDispersionColumns) and
 * materialDispersionRows.
 */
export function materialDispersionTable(spectrum, text, lambdaAxis, outsideLabel) {
    if (!spectrum) return { columns: [], rows: [] };
    const outside = spectrum.values.some(value => value.outsideRange);
    return { columns: materialDispersionColumns(text, lambdaAxis, outsideLabel, outside), rows: materialDispersionRows(spectrum) };
}

/**
 * The columns of the window's results table, keyed as materialDispersionRows
 * and headed with `text` (t.gdgdd), `lambdaAxis` and `outsideLabel`. The
 * Outside column is there only when `outside`, a row having been taken
 * outside the material's data.
 */
export function materialDispersionColumns(text, lambdaAxis, outsideLabel, outside) {
    // Rows taken from outside the material's data are marked with the material,
    // the same name the plot's shaded band carries. The plot says which part of
    // the curve is not measurement; without this column a row copied out of the
    // table, or read from the exported file, would not.
    // The group index is a symbol and reads the same everywhere.
    return [
        { key: 'lambda', label: lambdaAxis, align: 'left', fmt: value => value.toFixed(2) },
        ...(outside
            ? [{ key: 'outside', label: outsideLabel, align: 'left', fmt: value => value || '' }]
            : []),
        { key: 'phase', label: text.phaseAxis, fmt: value => value.toFixed(2) },
        { key: 'gd', label: text.gdAxis, fmt: value => value.toFixed(3) },
        { key: 'gdd', label: text.gddAxis, fmt: value => value.toFixed(3) },
        {
            key: 'cdc', label: text.cdcAxis,
            fmt: value => (Number.isFinite(value) ? toSignificantFigures(value, CDC_SIGNIFICANT_FIGURES) : ''),
        },
        { key: 'tod', label: text.todAxis, fmt: value => value.toFixed(3) },
        { key: 'groupIndex', label: 'nᵧ', fmt: value => value.toFixed(6) },
    ];
}
