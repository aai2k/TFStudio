/**
 * What a finished characterization reports.
 *
 * Two kinds of statement, kept apart on purpose. A warning names a condition a
 * source calls wrong, and there are only a few of them. Everything that is a
 * matter of degree, such as the residual, the spread on the thickness or how
 * strongly two parameters are correlated, is a number in the table for the
 * reader to judge.
 * A tool that turned those into verdicts would be inventing limits it cannot
 * defend.
 */

import {
    dispersionFitParameters, evaluateDispersionFit,
} from '../../../../utils/materials/dispersionFits.js';

function fixed(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function exponential(value, digits = 2) {
    return Number.isFinite(value) ? value.toExponential(digits) : '-';
}

/** The thickness with its spread, or on its own when it was held. */
export function thicknessText(result, nk) {
    if (!Number.isFinite(result.thicknessNm)) return '-';
    const value = `${fixed(result.thicknessNm, 2)} nm`;
    if (result.thicknessSpreadNm == null) return `${value} (${nk.thicknessHeld})`;
    return `${value} ± ${fixed(result.thicknessSpreadNm, 2)}`;
}

export function resultColumns(nk) {
    return [
        { key: 'quantity', label: nk.columnQuantity, width: 220 },
        { key: 'value', label: nk.columnValue, width: 200, align: 'right' },
    ];
}

/**
 * Every number the run produced, as label and value pairs.
 *
 * The parameter spread is included even though few readers will use it, because
 * it is the only thing in the window that says how much of the answer the
 * measurement actually determined. A thickness and an index enter a spectrum
 * largely as their product, and when a measurement holds too few fringes to
 * separate them the residual stays small while the correlation goes to one.
 */
export function resultRows(result, nk) {
    const rows = [
        { quantity: nk.rowThickness, value: thicknessText(result, nk) },
        { quantity: nk.rowModel, value: result.modelName.replace(/^Fit: /, '') },
    ];
    for (const quantity of ['T', 'R']) {
        const residual = result.residuals[quantity];
        if (!residual) continue;
        rows.push({
            quantity: nk.rowResidual(quantity),
            value: `${exponential(residual.rms)} ${nk.rms}, `
                + `${exponential(residual.max)} ${nk.max}`,
        });
    }
    rows.push(
        {
            quantity: nk.rowIndexRange,
            value: result.diagnostics.indexRange.map(value => fixed(value, 4)).join(' - '),
        },
        {
            quantity: nk.rowExtinctionRange,
            value: result.diagnostics.extinctionRange.map(value => exponential(value, 1)).join(' - '),
        },
        {
            quantity: nk.rowResolvableExtinction,
            value: exponential(result.diagnostics.resolvableExtinction, 1),
        },
        {
            quantity: nk.rowSolvedPoints,
            value: `${result.pointwise.resolved.filter(Boolean).length} / ${result.lambdas.length}`,
        },
    );
    if (result.envelope && !result.envelope.error) {
        rows.push({
            quantity: nk.rowEnvelopeThickness,
            value: `${fixed(result.envelope.thicknessNm, 1)} nm, `
                + `${result.envelope.extremaCount} ${nk.fringes}`,
        });
    }
    if (result.spread) {
        const [left, right] = result.spread.maxCorrelationPair;
        rows.push({
            quantity: nk.rowCorrelation,
            value: `${fixed(result.spread.maxCorrelation, 3)} `
                + `(${result.spread.labels[left]}, ${result.spread.labels[right]})`,
        });
    }
    const { parameters } = dispersionFitParameters(result.fit);
    for (const parameter of parameters) {
        rows.push({
            quantity: `${nk.modelParameter} ${parameter.label}`,
            value: Math.abs(parameter.value) < 1e-3 && parameter.value !== 0
                ? exponential(parameter.value, 4)
                : fixed(parameter.value, 6),
        });
    }
    return rows;
}

/** Warnings and errors, as the notice badge takes them. */
export function characterizationNotices(result, nk, stale) {
    if (!result) return [];
    if (result.error) return [{ label: nk.errors[result.error] || result.error, tone: 'error' }];
    const notices = result.diagnostics.warnings.map(warning => ({
        label: nk.warnings[warning.code] || warning.code,
        tone: 'error',
    }));
    if (result.resampled?.length) {
        notices.push({ label: nk.resampled(result.resampled.join(', ')) });
    }
    if (stale) notices.push({ label: nk.stale });
    return notices;
}

/**
 * The extracted constants as CSV: the model and the pointwise extraction it was
 * fitted to, side by side, at every measured wavelength.
 *
 * Both are exported because they answer different questions. The model is what
 * the material carries; the points are what the measurement said before a model
 * was imposed on it, and a column saying which of them were solved is what makes
 * the difference readable.
 */
export function constantsCsv(result) {
    const lines = ['lambda_nm,n,k,n_pointwise,k_pointwise,solved'];
    result.pointwise.lambdas.forEach((lambda, index) => {
        const [n, k] = evaluateDispersionFit(result.fit, lambda);
        lines.push([
            lambda,
            n.toFixed(6),
            Math.max(0, k).toExponential(6),
            result.pointwise.n[index].toFixed(6),
            result.pointwise.k[index].toExponential(6),
            result.pointwise.resolved[index] ? 1 : 0,
        ].join(','));
    });
    return `${lines.join('\n')}\n`;
}
