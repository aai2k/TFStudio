/**
 * FWHM / EDGE_LAMBDA evaluation: where the channel crosses a level either side
 * of the band's peak.
 *
 * Finds the band's peak (or notch) with the MXW / MNW row CENTRAL_LAMBDA
 * reads, so the two agree, then walks a uniform scan of the band out from it,
 * working out only the samples it passes, to bracket the two (or one)
 * crossings of the level, and finds each crossing by bisection inside its
 * bracket.
 */

import { makeOperand, evaluateOperands, extremumStepNm } from '../../physics/optimizer.js';
import { singleType, channelFromKind, argwaveType } from './channelTypes.js';
import { finishCompare } from './format.js';

// Samples of the scan the crossings are bracketed on, unless the qualifier
// sets its own bandPoints: a 1 nm step over a 300 nm band.
const SCAN_POINTS = 301;

// The scan's sample count. An evaluation that asks for a step flag
// (evaluate.js) gets a sample at every step of that flag, and never fewer than
// SCAN_POINTS; the qualifier's own bandPoints always wins.
export function scanCount(qual, options) {
    if (qual.bandPoints || !options?.flag) return Math.max(11, qual.bandPoints || SCAN_POINTS);
    const span = Math.abs(qual.lambdaEnd - qual.lambdaStart);
    return Math.max(SCAN_POINTS, Math.ceil(span / extremumStepNm({ flag: options.flag })) + 1);
}

// The crossing of `cross` between `inside`, a wavelength on the peak's side of
// the level, and `outside`, one past it. The pair is halved until the two are
// neighbouring doubles, so the crossing is exact whatever the scan's step; the
// step decides only which crossing gets bracketed.
function bisectCross({ at, cross, direction }, inside, outside) {
    const past = direction === 'min' ? v => v >= cross : v => v <= cross;
    for (;;) {
        const mid = 0.5 * (inside + outside);
        if (mid === inside || mid === outside) return mid;
        if (past(at(mid))) outside = mid;
        else inside = mid;
    }
}

// The first scan sample past `lam` on its long-wave side, or N when none is.
// It is found from the scan's own formula and then stepped to the exact
// sample, so it is the one a search of every sample would find.
function firstSampleAfter({ lamAt, N }, lam) {
    const lo = lamAt(0), hi = lamAt(N - 1);
    const guess = hi > lo ? Math.floor(((lam - lo) / (hi - lo)) * (N - 1)) + 1 : 0;
    let i = Number.isFinite(guess) ? Math.min(N, Math.max(0, guess)) : 0;
    while (i > 0 && lamAt(i - 1) > lam) i--;
    while (i < N && lamAt(i) <= lam) i++;
    return i;
}

// Walk outward from the peak to the first scan sample past `cross`, starting
// at scan sample `startI`: for a max peak the first at or below cross, for a
// min notch the first at or above it. The crossing lies between that sample
// and the one before it. A sample is worked out only when the walk reaches
// it. `scan` = { at, lamAt, N, peakLam, peakV, cross, direction }.
function findCross(scan, startI, step) {
    const { at, lamAt, N, peakLam, peakV, cross, direction } = scan;
    let prev = peakV, prevLam = peakLam;
    for (let i = startI; i >= 0 && i < N; i += step) {
        const curLam = lamAt(i), curV = at(curLam);
        const isCrossed = direction === 'min'
            ? (curV >= cross && prev < cross)
            : (curV <= cross && prev > cross);
        if (isCrossed) return bisectCross(scan, prevLam, curLam);
        prev = curV; prevLam = curLam;
    }
    return null;
}

export function evalBandDerived(qual, design, ctx, options) {
    const k   = qual.kind;
    const ch  = channelFromKind(k) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const at = lam => evaluateOperands([makeOperand({
        type: singleType(ch, pol),
        lambdaStart: lam, lambdaEnd: lam,
        aoi: qual.aoi, pol, target: 0, weight: 1,
    })], ctx)[0];

    // The scan rises in wavelength whichever way round the band was typed, as
    // the walk out from the peak below assumes.
    const lo = Math.min(qual.lambdaStart, qual.lambdaEnd);
    const hi = Math.max(qual.lambdaStart, qual.lambdaEnd);
    const N = scanCount(qual, options);
    const lamAt = i => lo + (hi - lo) * i / (N - 1);
    const direction = qual.direction || 'max';
    const peakLam = evaluateOperands([makeOperand({
        type: argwaveType(direction, ch, pol),
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: 0, weight: 1, ...(options?.flag ? { flag: options.flag } : {}),
    })], ctx)[0];
    const peakV = at(peakLam);
    const level = Math.max(0.001, Math.min(0.999, qual.level ?? 0.5));
    // For a max peak the crossing level is peakV · level; for a notch
    // (min) we use peakV + level · (1 − peakV) — i.e. recover toward 1.
    const cross = direction === 'min'
        ? peakV + (1 - peakV) * level
        : peakV * level;

    const scan = { at, lamAt, N, peakLam, peakV, cross, direction };
    const rightI = firstSampleAfter(scan, peakLam);
    // Each side is walked only when its crossing is needed.
    const leftCross = () => findCross(scan, rightI - 1, -1);
    const rightCross = () => findCross(scan, rightI, +1);

    if (k === 'FWHM') {
        const leftLam = leftCross();
        const rightLam = leftLam == null ? null : rightCross();
        if (leftLam == null || rightLam == null) {
            // Couldn't bracket both crossings inside the scan band.
            return {
                value: NaN, pass: false, deviation: NaN, unit: 'nm',
                summaryKey: 'fwhmNotBracketed',
                summaryArgs: [(level * 100).toFixed(0), qual.lambdaStart, qual.lambdaEnd],
            };
        }
        const fwhm = rightLam - leftLam;
        return finishCompare(qual, fwhm, 'nm');
    }

    // EDGE_LAMBDA — for an LP / SP edge there's typically one crossing in the
    // band. Pick whichever side has a real crossing (left for LP↑, right for
    // SP↓ etc.); if both exist, the qualifier carries `edgeSide`
    // ('left' | 'right'); default 'left'.
    const which = qual.edgeSide === 'right' ? rightCross() : (leftCross() ?? rightCross());
    if (which == null) {
        return {
            value: NaN, pass: false, deviation: NaN, unit: 'nm',
            summaryKey: 'edgeNotCrossed', summaryArgs: [(level * 100).toFixed(0)],
        };
    }
    return finishCompare(qual, which, 'nm');
}
