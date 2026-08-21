/**
 * The numbers behind the overlay: at each wavelength the homogeneous design's
 * value and the value with the graded interfaces in place, for whichever
 * channels are plotted.
 */

const CHANNELS = ['T', 'R', 'A'];
// A design with no baseline spectrum leaves the homogeneous column empty rather
// than printing a zero it did not compute.
const PERCENT = value => (value == null ? '' : (value * 100).toFixed(4));

function channelsFor(channel) {
    return channel === 'all' ? CHANNELS : [channel];
}

export function overlayColumns(t, channel) {
    const ih = t.inhomogeneities;
    const columns = [{ key: 'lambda', label: 'λ (nm)', fmt: value => value.toFixed(1) }];
    for (const key of channelsFor(channel)) {
        columns.push({ key: `${key}0`, label: `${key} ${ih.colHomogeneous}`, fmt: PERCENT });
        columns.push({ key, label: `${key} ${ih.colGraded}`, fmt: PERCENT });
    }
    return columns;
}

export function overlayRows(baseline, perturbed, channel) {
    if (!perturbed?.lambda?.length) return [];
    const keys = channelsFor(channel);
    return perturbed.lambda.map((lambda, index) => {
        const row = { lambda };
        for (const key of keys) {
            row[`${key}0`] = baseline ? baseline[key][index] : null;
            row[key] = perturbed[key][index];
        }
        return row;
    });
}
