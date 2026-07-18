/**
 * FWHM / EDGE_LAMBDA evaluation — derived from a dense band scan.
 *
 * Samples the band and finds the peak first, then the two (or one) crossings
 * of level·peak. Uses the same default grid density as the argwave operand so
 * the peak λ here matches CENTRAL_LAMBDA.
 */

import { makeOperand, evaluateOperands, ARGWAVE_DEFAULT_POINTS } from '../../physics/optimizer.js';
import { singleType, channelFromKind } from './channelTypes.js';
import { finishCompare } from './format.js';

// Walk outward from the peak sample to find where the scan crosses `cross`.
// For a max peak we look for the first descent below cross; for a min notch
// we look for the first ascent above cross. `scan` = { lams, vals, peakI,
// peakV, cross, direction } from the caller's band sampling.
function findCross(scan, startI, step) {
    const { lams, vals, peakI, peakV, cross, direction } = scan;
    let prev = peakV, prevLam = lams[peakI];
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

    const N = Math.max(11, qual.bandPoints || ARGWAVE_DEFAULT_POINTS);
    const lams = new Array(N);
    const vals = new Array(N);
    for (let i = 0; i < N; i++) {
        const lam = qual.lambdaStart + (qual.lambdaEnd - qual.lambdaStart) * i / (N - 1);
        lams[i] = lam;
        const probe = makeOperand({
            type: singleType(ch, pol),
            lambdaStart: lam, lambdaEnd: lam,
            aoi: qual.aoi, pol, target: 0, weight: 1,
        });
        vals[i] = evaluateOperands([probe], ctx)[0];
    }
    const direction = qual.direction || 'max';
    // Peak / notch value
    let peakI = 0, peakV = vals[0];
    for (let i = 1; i < N; i++) {
        if (direction === 'min' ? vals[i] < peakV : vals[i] > peakV) {
            peakV = vals[i]; peakI = i;
        }
    }
    const level = Math.max(0.001, Math.min(0.999, qual.level ?? 0.5));
    // For a max peak the crossing level is peakV · level; for a notch
    // (min) we use peakV + level · (1 − peakV) — i.e. recover toward 1.
    const cross = direction === 'min'
        ? peakV + (1 - peakV) * level
        : peakV * level;

    const scan = { lams, vals, peakI, peakV, cross, direction };
    const leftLam  = findCross(scan, peakI - 1, -1);
    const rightLam = findCross(scan, peakI + 1, +1);

    if (k === 'FWHM') {
        if (leftLam == null || rightLam == null) {
            // Couldn't bracket both crossings inside the scan band.
            return {
                value: NaN, pass: false, deviation: NaN,
                displayValue: '— (no crossings)', unit: 'nm',
                summary: `FWHM @ ${(level*100).toFixed(0)}% not bracketed in [${qual.lambdaStart},${qual.lambdaEnd}] nm`,
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
            displayValue: '— (no crossing)', unit: 'nm',
            summary: `Edge level ${(level*100).toFixed(0)}% not crossed in band`,
        };
    }
    return finishCompare(qual, which, 'nm');
}
