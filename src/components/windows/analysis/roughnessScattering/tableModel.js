/**
 * The numbers behind the scattering plot: at each wavelength the ideal R and T,
 * the specular parts left after the scattered fraction is removed, and the total
 * integrated scatter itself.
 */

const PERCENT = value => (value * 100).toFixed(4);

export function scatterColumns(t, units) {
    const rs = t.roughnessScattering;
    return [
        { key: 'lambda', label: 'λ (nm)', fmt: value => value.toFixed(1) },
        { key: 'R', label: `${rs.traceRIdeal} (%)`, fmt: PERCENT },
        { key: 'T', label: `${rs.traceTIdeal} (%)`, fmt: PERCENT },
        { key: 'Rspec', label: `${rs.traceRSpec} (%)`, fmt: PERCENT },
        { key: 'Tspec', label: `${rs.traceTSpec} (%)`, fmt: PERCENT },
        {
            key: 'tis', label: units === 'ppm' ? 'TIS (ppm)' : 'TIS',
            fmt: value => (units === 'ppm' ? (value * 1e6).toFixed(2) : value.toExponential(3)),
        },
    ];
}

export function scatterRows(calc) {
    if (!calc?.lambda?.length) return [];
    return calc.lambda.map((lambda, index) => ({
        lambda,
        R: calc.R[index],
        T: calc.T[index],
        Rspec: calc.R_spec[index],
        Tspec: calc.T_spec[index],
        tis: calc.TIS_inc[index],
    }));
}
