/**
 * The readout under the plot and the Results table, from the worker's numbers.
 *
 * Durations carry four significant figures, trailing zeros kept so 15.00 and
 * 15.42 read alike: a femtosecond pulse is read to the hundredth, and from a
 * picosecond up to the whole femtosecond, and neither needs more.
 */

const finite = value => Number.isFinite(value);
const duration = (value) => {
    if (!finite(value)) return '–';
    return Math.abs(value) >= 1000 ? value.toFixed(0) : value.toPrecision(4);
};
const fixed = digits => value => (finite(value) ? value.toFixed(digits) : '–');
const percent = value => (finite(value) ? (100 * value).toFixed(1) : '–');

/** The one line under the plot, as separate parts the window joins. */
export function readoutParts(metrics, text) {
    return [
        text.readoutFlp(duration(metrics.flpFwhmFs)),
        text.readoutOut(duration(metrics.outputFwhmFs)),
        text.readoutPeak(percent(metrics.peakVsFlp)),
        text.readoutDelay(fixed(1)(metrics.delayFs)),
        text.readoutGdd(fixed(1)(metrics.residualGddFs2)),
    ];
}

/**
 * Every number the run produced, one row each, for the Results strip and CSV.
 * A row holds the raw value and how it is shown, so the CSV keeps every digit.
 */
export function resultsTable(view, text) {
    const m = view.metrics;
    const rows = [
        { quantity: text.rowFlp, value: m.flpFwhmFs, format: duration, unit: 'fs' },
        ...(view.chirped ? [{ quantity: text.rowInput, value: m.inputFwhmFs, format: duration, unit: 'fs' }] : []),
        { quantity: text.rowOutput, value: m.outputFwhmFs, format: duration, unit: 'fs' },
        { quantity: text.rowRms, value: m.outputRmsFs, format: duration, unit: 'fs' },
        { quantity: text.rowPeak, value: 100 * m.peakVsFlp, format: fixed(1), unit: '%' },
        { quantity: text.rowTransformLimit, value: 100 * m.transformLimitedRatio, format: fixed(1), unit: '%' },
        { quantity: text.rowEnergy, value: 100 * m.energyRatio, format: fixed(1), unit: '%' },
        { quantity: text.rowDelay, value: m.delayFs, format: fixed(1), unit: 'fs' },
        { quantity: text.rowGdd, value: m.residualGddFs2, format: fixed(1), unit: 'fs²' },
        { quantity: text.rowTod, value: m.residualTodFs3, format: duration, unit: 'fs³' },
        { quantity: text.rowInputBand, value: m.inputBandwidthNm, format: fixed(1), unit: 'nm' },
        { quantity: text.rowOutputBand, value: m.outputBandwidthNm, format: fixed(1), unit: 'nm' },
        { quantity: text.rowTbp, value: m.outputTimeBandwidth, format: fixed(3), unit: '' },
    ];
    const columns = [
        { key: 'quantity', label: text.quantityColumn, align: 'left' },
        { key: 'value', label: text.valueColumn, fmt: (value, row) => row.format(value) },
        { key: 'unit', label: text.unitColumn, align: 'left' },
    ];
    return { columns, rows };
}
