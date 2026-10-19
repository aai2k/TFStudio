/**
 * What a band-extremum row looks for, and the band grid it starts its search
 * from. The rows are the wavelength of the band's maximum or minimum (MXW*,
 * MNW*) and the worst case (TMN..AMX and their dB and density forms); the
 * search itself is evalCore/bandExtremum.js.
 */

import {
    AVG_POINTS, extremumStepNm, isArgwave, isArgwaveMin, argwaveOpticalChar, argwavePolCode,
    polFromType, isMinType, isMinmax, isBandGridRow,
} from './operandModel.js';
import { logOperand } from './logReadings.js';

/**
 * Channel, polarization, whether the row's linear quantity C (T, R or A) is
 * maximised, and whether that makes it a peak row: one that looks for a peak
 * of T, 1 − R or A, where a narrow resonance can sit. A dB reading rises with C
 * and a density falls with it, so a lowest density is a highest T.
 */
export function extremumRowSpec(op) {
    const t = op.type;
    if (isArgwave(t)) {
        const char = argwaveOpticalChar(t);
        const maxC = !isArgwaveMin(t);
        return { char, pol: argwavePolCode(t) ?? op.pol ?? 'avg', maxC, peak: isPeakOf(char, maxC), argwave: true };
    }
    const log = logOperand(t);
    const char = log?.channel ?? t[0];
    const maxC = (log?.unit === 'OD') === isMinType(t);
    return { char, pol: polFromType(t) ?? op.pol, maxC, peak: isPeakOf(char, maxC), argwave: false };
}

// A peak of T or A is their maximum; a peak of 1 − R is the minimum of R.
function isPeakOf(char, maxC) {
    return char === 'R' ? !maxC : maxC;
}

/** Whether the row is a band-extremum row: worst case or MXW* / MNW*. */
export function isExtremumRow(type) {
    return isArgwave(type) || isMinmax(type);
}

/**
 * Whether the row takes a step flag: a band-extremum row that looks for a peak,
 * whose flag sets its search step, and a band row (isBandGridRow), whose flag
 * sets the coarsest step of its grid. A row that looks for a dip searches the
 * design's fringe grid.
 */
export function takesStepFlag(op) {
    if (!op) return false;
    return isBandGridRow(op.type) || (isExtremumRow(op.type) && extremumRowSpec(op).peak);
}

// Grid points per fringe of the search. A fringe needs more than two samples
// to show as its own grid extremum. On random stacks of up to 100 layers, two
// per fringe lost fringe peaks and three lost none.
const SEARCH_SAMPLES_PER_FRINGE = 3;

// The row's band, low end first, whichever way it was entered.
function bandOf(op) {
    return [Math.min(op.lambdaStart, op.lambdaEnd), Math.max(op.lambdaStart, op.lambdaEnd)];
}

/**
 * `n` uniform samples over [a, b], the last one exactly b, so a wavelength found
 * on a band end compares equal to it; a band of zero width is its one
 * wavelength.
 */
export function bandGridOfCount(a, b, n) {
    if (!(b !== a) || n < 2) return [a];
    const out = new Array(n);
    for (let i = 0; i < n - 1; i++) out[i] = a + ((b - a) * i) / (n - 1);
    out[n - 1] = b;
    return out;
}

// Samples of the row's own grid: its step for a peak row (extremumStepNm),
// AVG_POINTS for a row that looks for a dip, and never fewer than AVG_POINTS.
function ownCount(op) {
    const [lo, hi] = bandOf(op);
    const step = extremumRowSpec(op).peak ? extremumStepNm(op) : Infinity;
    return Math.max(AVG_POINTS, Number.isFinite(step) ? Math.ceil((hi - lo) / step) + 1 : 0);
}

/**
 * Samples a row searches on a coating whose group optical thickness at the
 * band's short end is `groupThicknessNm` (nm): its own grid, or three per
 * fringe of period λ²/(2G) where that is finer (fringeSampling.js).
 */
export function extremumSearchCount(op, groupThicknessNm) {
    const [lo, hi] = bandOf(op);
    const own = ownCount(op);
    if (!(groupThicknessNm > 0) || !(hi > lo)) return own;
    const fringeStep = (lo * lo) / (2 * groupThicknessNm * SEARCH_SAMPLES_PER_FRINGE);
    return Math.max(own, Math.ceil((hi - lo) / fringeStep) + 1);
}

/**
 * Samples of the uniform grid a row's search starts from: its own grid, or
 * `count` when a count is given and larger (a run fixes one from the design's
 * fringes, evalCore/fringeSampling.js).
 */
export function extremumGridCount(op, count = null) {
    return Math.max(ownCount(op), count ?? 0);
}

/** The grid of extremumGridCount samples over the row's band, low end first. */
export function extremumBaseLambdas(op, count = null) {
    const [lo, hi] = bandOf(op);
    return bandGridOfCount(lo, hi, extremumGridCount(op, count));
}
