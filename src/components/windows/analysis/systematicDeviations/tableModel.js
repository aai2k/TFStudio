/**
 * The numbers behind whichever plot is on screen: the deviated spectrum against
 * the design in Single mode, and the swept grid itself in Sweep mode, one row
 * per parameter value and wavelength.
 */

const CHANNELS = ['T', 'R', 'A'];
const SWEEP_KEYS = { T: 'T2D', R: 'R2D', A: 'A2D' };
const PERCENT = value => (value == null ? '' : (value * 100).toFixed(4));

function channelsFor(channel) {
    return channel === 'all' ? CHANNELS : [channel];
}

export function deviationColumns(t, channel) {
    const sd = t.systematicDeviations;
    const columns = [{ key: 'lambda', label: 'λ (nm)', fmt: value => value.toFixed(1) }];
    for (const key of channelsFor(channel)) {
        columns.push({ key: `${key}0`, label: `${key} ${sd.colBaseline}`, fmt: PERCENT });
        columns.push({ key, label: `${key} ${sd.colDeviated}`, fmt: PERCENT });
    }
    return columns;
}

export function deviationRows(baseline, deviated, channel) {
    if (!deviated?.lambda?.length) return [];
    const keys = channelsFor(channel);
    return deviated.lambda.map((lambda, index) => {
        const row = { lambda };
        for (const key of keys) {
            row[`${key}0`] = baseline ? baseline[key][index] : null;
            row[key] = deviated[key][index];
        }
        return row;
    });
}

export function sweepColumns(t, channel) {
    const sd = t.systematicDeviations;
    return [
        { key: 'param', label: sd.colParam, fmt: value => String(Number(value.toPrecision(6))) },
        { key: 'lambda', label: 'λ (nm)', fmt: value => value.toFixed(1) },
        ...channelsFor(channel).map(key => ({ key, label: `${key} (%)`, fmt: PERCENT })),
    ];
}

/** The swept grid flattened: one row per (parameter value, wavelength) pair. */
export function sweepRows(sweepResult, channel) {
    if (!sweepResult?.lambda?.length) return [];
    const keys = channelsFor(channel);
    const rows = [];
    sweepResult.paramValues.forEach((param, paramIndex) => {
        sweepResult.lambda.forEach((lambda, index) => {
            const row = { param, lambda };
            for (const key of keys) row[key] = sweepResult[SWEEP_KEYS[key]][paramIndex][index];
            rows.push(row);
        });
    });
    return rows;
}
