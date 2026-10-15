/**
 * FWHM / EDGE_LAMBDA evaluation — derived from a dense band scan.
 *
 * Finds the band's peak (or notch) with the MXW / MNW row CENTRAL_LAMBDA
 * reads, so the two agree, then the two (or one) crossings of the level on a
 * uniform scan of the band.
 */

import { makeOperand, evaluateOperands } from '../../physics/optimizer.js';
import { singleType, channelFromKind, argwaveType } from './channelTypes.js';
import { finishCompare } from './format.js';

// Samples of the scan the crossings are found on, unless the qualifier sets
// its own bandPoints: a 1 nm step over a 300 nm band.
const SCAN_POINTS = 301;

// Walk outward from the peak to find where the scan crosses `cross`, starting
// at scan sample `startI`. For a max peak we look for the first descent below
// cross; for a min notch we look for the first ascent above cross. `scan` =
// { lams, vals, peakLam, peakV, cross, direction }.
function findCross(scan, startI, step) {
    const { lams, vals, peakLam, peakV, cross, direction } = scan;
    let prev = peakV, prevLam = peakLam;
    const N = vals.length;
    for (let i = startI; i >= 0 && i < N; i += step) {
        const curV = vals[i], curLam = lams[i];
        const isCrossed = direction === 'min'
            ? (curV >= cross && prev < cross)
            : (curV <= cross && prev > cross);
        if (isCrossed) {
            // linear-interp between prev → cur
            const t = (cross - prev) / (curV - prev);
            return prevLam + t * (curLam - prevLam);
        }
        prev = curV; prevLam = curLam;
    }
    return null;
}

export function evalBandDerived(qual, design, ctx) {
    const k   = qual.kind;
    const ch  = channelFromKind(k) || qual.channel || 'T';
    const pol = qual.pol || 'avg';
    const at = lam => evaluateOperands([makeOperand({
        type: singleType(ch, pol),
        lambdaStart: lam, lambdaEnd: lam,
        aoi: qual.aoi, pol, target: 0, weight: 1,
    })], ctx)[0];

    const N = Math.max(11, qual.bandPoints || SCAN_POINTS);
    const lams = new Array(N);
    const vals = new Array(N);
    for (let i = 0; i < N; i++) {
        lams[i] = qual.lambdaStart + (qual.lambdaEnd - qual.lambdaStart) * i / (N - 1);
        vals[i] = at(lams[i]);
    }
    const direction = qual.direction || 'max';
    const peakLam = evaluateOperands([makeOperand({
        type: argwaveType(direction, ch, pol),
        lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
        aoi: qual.aoi, pol, target: 0, weight: 1,
    })], ctx)[0];
    const peakV = at(peakLam);
    const level = Math.max(0.001, Math.min(0.999, qual.level ?? 0.5));
    // For a max peak the crossing level is peakV · level; for a notch
    // (min) we use peakV + level · (1 − peakV) — i.e. recover toward 1.
    const cross = direction === 'min'
        ? peakV + (1 - peakV) * level
        : peakV * level;

    // The first scan sample past the peak on its long-wave side.
    let rightI = lams.findIndex(lam => lam > peakLam);
    if (rightI < 0) rightI = N;
    const scan = { lams, vals, peakLam, peakV, cross, direction };
    const leftLam  = findCross(scan, rightI - 1, -1);
    const rightLam = findCross(scan, rightI, +1);

    if (k === 'FWHM') {
        if (leftLam == null || rightLam == null) {
            // Couldn't bracket both crossings inside the scan band.
            return {
                value: NaN, pass: false, deviation: NaN,
                displayValue: '—', unit: 'nm',
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
    const which = qual.edgeSide === 'right' ? rightLam : (leftLam ?? rightLam);
    if (which == null) {
        return {
            value: NaN, pass: false, deviation: NaN,
            displayValue: '—', unit: 'nm',
            summaryKey: 'edgeNotCrossed', summaryArgs: [(level * 100).toFixed(0)],
        };
    }
    return finishCompare(qual, which, 'nm');
}
