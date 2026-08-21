/**
 * The numbers behind the overlay: at each wavelength the homogeneous design's
 * value and the value with the graded interfaces in place, for whichever
 * channels are plotted.
 */

import { enabledOverlayCurves } from './figure.js';

// A design with no baseline spectrum leaves the homogeneous column empty rather
// than printing a zero it did not compute.
const PERCENT = value => (value == null ? '' : (value * 100).toFixed(4));

export function overlayColumns(t, showCurves) {
    const ih = t.inhomogeneities;
    const columns = [{ key: 'lambda', label: 'λ (nm)', fmt: value => value.toFixed(1) }];
    for (const key of enabledOverlayCurves(showCurves)) {
        columns.push({ key: `${key}0`, label: `${key} ${ih.colHomogeneous}`, fmt: PERCENT });
        columns.push({ key, label: `${key} ${ih.colGraded}`, fmt: PERCENT });
    }
    return columns;
}

export function overlayRows(baseline, perturbed, showCurves) {
    if (!perturbed?.lambda?.length) return [];
    const keys = enabledOverlayCurves(showCurves).filter(key => perturbed[key]);
    return perturbed.lambda.map((lambda, index) => {
        const row = { lambda };
        for (const key of keys) {
            row[`${key}0`] = baseline?.[key] ? baseline[key][index] : null;
            row[key] = perturbed[key][index];
        }
        return row;
    });
}
