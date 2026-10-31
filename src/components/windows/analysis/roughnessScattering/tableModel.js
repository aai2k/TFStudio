/**
 * The numbers behind the scattering plot: at each wavelength R and T of the
 * smooth design, the same with roughness, and the specular loss between them.
 */

import { enabledScatterCurves, lossTitle } from './figure.js';

// Fractions of 1, shown and written in percent.
const PERCENT = { fmt: value => (value == null ? '' : (value * 100).toFixed(4)), scale: 100 };

export function scatterColumns(t, units, showCurves, calc) {
    const rs = t.roughnessScattering;
    const columns = [{ key: 'lambda', label: t.spectralAxis.lambdaShort, fmt: value => value.toFixed(1) }];
    for (const key of enabledScatterCurves(showCurves, calc)) {
        columns.push({ key: `${key}0`, label: `${key} ${rs.traceIdeal} (%)`, ...PERCENT });
        columns.push({ key, label: `${key} ${rs.traceSpecular} (%)`, ...PERCENT });
    }
    // The loss, shown and written in ppm or as a fraction of 1.
    columns.push({
        key: 'loss', label: lossTitle(rs.traceLoss, units),
        fmt: value => (units === 'ppm' ? (value * 1e6).toFixed(2) : value.toExponential(3)),
        scale: units === 'ppm' ? 1e6 : 1,
    });
    return columns;
}

export function scatterRows(calc, showCurves) {
    if (!calc?.lambda?.length) return [];
    const keys = enabledScatterCurves(showCurves, calc);
    return calc.lambda.map((lambda, index) => {
        const row = { lambda, loss: calc.loss[index] };
        for (const key of keys) {
            row[`${key}0`] = calc.ideal[key][index];
            row[key] = calc.specular[key][index];
        }
        return row;
    });
}
