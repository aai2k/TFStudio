/**
 * The trial statistics behind the plot: at each wavelength the nominal design
 * value, the mean over the trials, the standard deviation, the corridor the plot
 * shades, and the realized extremes.
 */

// Fractions of 1, shown and written in percent.
const PERCENT = { fmt: value => (value == null ? '' : (value * 100).toFixed(4)), scale: 100 };

export function statisticsColumns(t, char, corridorSigma) {
    const ea = t.errorAnalysis;
    return [
        { key: 'lambda', label: t.spectralAxis.lambdaShort, fmt: value => value.toFixed(1) },
        { key: 'theory', label: `${char} ${ea.colNominalSpectrum}`, ...PERCENT },
        { key: 'mean', label: `${char} ${ea.colMean}`, ...PERCENT },
        { key: 'stdev', label: `${char} σ (%)`, ...PERCENT },
        { key: 'lower', label: `−${corridorSigma}σ (%)`, ...PERCENT },
        { key: 'upper', label: `+${corridorSigma}σ (%)`, ...PERCENT },
        { key: 'envLower', label: ea.colMin, ...PERCENT },
        { key: 'envUpper', label: ea.colMax, ...PERCENT },
    ];
}

export function statisticsRows(result, corridorSigma) {
    if (!result?.lambda?.length) return [];
    const k = corridorSigma;
    return result.lambda.map((lambda, index) => {
        const mean = result.mean?.[index];
        const stdev = result.stdev?.[index];
        return {
            lambda,
            theory: result.theory?.[index] ?? null,
            mean: mean ?? null,
            stdev: stdev ?? null,
            lower: stdev == null ? null : Math.max(0, mean - k * stdev),
            upper: stdev == null ? null : Math.min(1, mean + k * stdev),
            envLower: result.envLower?.[index] ?? null,
            envUpper: result.envUpper?.[index] ?? null,
        };
    });
}
