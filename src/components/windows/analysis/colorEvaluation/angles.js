/**
 * The angles the colour window computes: the list as typed, or a range from a
 * first to a last angle in equal steps, in that order. Either way no more than
 * the window's list holds (analysisDefaults.js says why).
 */

import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';

export const ANGLE_CAP = ANALYSIS_DEFAULTS.colorEvaluation.lists.thetas.maxLength;

// Angles are kept to the 0.1° the angle chips hold.
const tenth = value => Math.round(value * 10) / 10;

/**
 * The angles from `from` to `to`, `step` apart, first to last, as `angles`,
 * and how many the range holds before the cap, as `total`. A last angle the
 * step does not land on is left out; a range that runs downward is kept in
 * that order.
 */
export function rangeAngles(from, to, step) {
    const size = Math.abs(step);
    if (!(size > 0) || !Number.isFinite(from) || !Number.isFinite(to)) return { angles: [tenth(from || 0)], total: 1 };
    const total = Math.floor(Math.abs(to - from) / size + 1e-9) + 1;
    const sign = to < from ? -1 : 1;
    const angles = Array.from({ length: Math.min(total, ANGLE_CAP) }, (_, k) => tenth(from + sign * k * size));
    return { angles, total };
}

/** The angles a window state asks for, and how many there would be without the cap. */
export function windowAngles(state) {
    if (state.angleMode === 'range') return rangeAngles(state.angleStart, state.angleEnd, state.angleStep);
    const angles = state.thetas || [];
    return { angles: angles.slice(0, ANGLE_CAP), total: angles.length };
}
