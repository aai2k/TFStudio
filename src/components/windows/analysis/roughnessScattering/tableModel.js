/**
 * The numbers behind the scattering plot: at each wavelength the ideal R and T,
 * the specular parts left after the scattered fraction is removed, and the total
 * integrated scatter itself.
 */

import { enabledScatterCurves } from './figure.js';

const PERCENT = value => (value == null ? '' : (value * 100).toFixed(4));

export function scatterColumns(t, units, showCurves, calc) {
    const rs = t.roughnessScattering;
    const columns = [{ key: 'lambda', label: 'λ (nm)', fmt: value => value.toFixed(1) }];
    for (const key of enabledScatterCurves(showCurves, calc)) {
        columns.push({ key: `${key}0`, label: `${key} ${rs.traceIdeal} (%)`, fmt: PERCENT });
        columns.push({ key, label: `${key} ${rs.traceSpecular} (%)`, fmt: PERCENT });
    }
    columns.push({
        key: 'tis', label: units === 'ppm' ? 'TIS (ppm)' : 'TIS',
        fmt: value => (units === 'ppm' ? (value * 1e6).toFixed(2) : value.toExponential(3)),
    });
    return columns;
}

export function scatterRows(calc, showCurves) {
    if (!calc?.lambda?.length) return [];
    const keys = enabledScatterCurves(showCurves, calc);
    return calc.lambda.map((lambda, index) => {
        const row = { lambda, tis: calc.TIS_inc[index] };
        for (const key of keys) {
            row[`${key}0`] = calc.ideal[key][index];
            row[key] = calc.specular[key][index];
        }
        return row;
    });
}
