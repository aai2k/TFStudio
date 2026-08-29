/**
 * Whether an extracted set of film constants can be believed.
 *
 * A characterization that reports only its residual is not much use: Macleod's
 * own worked examples show a model fitting its data perfectly while describing
 * the wrong film. Two of those examples are checked for here directly, because
 * the residual will not catch either one.
 *
 * Reference throughout: Macleod, Thin-Film Optical Filters, 5th ed.,
 * "Measurement of the Optical Properties" (Figures 14.13 and 14.14 and the
 * surrounding text).
 */

import { evaluateDispersionFit } from '../dispersionFits.js';
import { channelDifference } from './sampleSpectrum.js';
import { EXTINCTION_MAX } from './pointwiseNk.js';

// The accuracy a careful reflectance and transmittance measurement reaches,
// from Macleod's discussion of the extraction: "unlikely to be much better than
// 0.1% absolute". Used to decide when an extracted k is large enough to mean
// anything, and when R + T exceeding one is a calibration fault rather than
// rounding.
export const PHOTOMETRIC_ACCURACY = 0.001;

/**
 * The smallest extinction coefficient a measurement of this film could resolve.
 *
 * Single-pass absorptance is 4πkd/λ, so a photometric uncertainty of ΔT puts a
 * floor of ΔT·λ/(4πd) under k. Below it, an extracted k is describing the
 * instrument.
 */
export function resolvableExtinction(lambdaNm, thicknessNm) {
    if (!(thicknessNm > 0)) return Infinity;
    return PHOTOMETRIC_ACCURACY * lambdaNm / (4 * Math.PI * thicknessNm);
}

function residualSummary(calculated, measured, quantity) {
    let sumSquared = 0;
    let maximum = 0;
    for (let point = 0; point < measured.length; point++) {
        const error = channelDifference(quantity, calculated[point], measured[point]);
        sumSquared += error * error;
        maximum = Math.max(maximum, Math.abs(error));
    }
    return {
        rms: Math.sqrt(sumSquared / Math.max(1, measured.length)),
        max: maximum,
        points: measured.length,
    };
}

export function channelResiduals(calculated, measured) {
    const residuals = {};
    for (const channel of Object.keys(measured || {})) {
        if (Array.isArray(measured[channel])) {
            residuals[channel] = residualSummary(calculated[channel], measured[channel], channel);
        }
    }
    return residuals;
}

/**
 * A smooth model that misses the measured spectrum by more than the instrument
 * can plausibly explain should not be mistaken for a faithful material.
 * Three times the stated 0.1% absolute photometric accuracy is a conservative
 * boundary; the residual values remain available for the exact judgement.
 */
export function modelMismatch(residuals) {
    const channels = Object.entries(residuals || {})
        .filter(([quantity]) => quantity === 'T' || quantity === 'R');
    if (channels.length === 0) return null;
    const [quantity, worst] = channels.reduce((current, entry) => (
        entry[1].rms > current[1].rms ? entry : current));
    return worst.rms > 3 * PHOTOMETRIC_ACCURACY
        ? { quantity, rms: worst.rms, expected: PHOTOMETRIC_ACCURACY }
        : null;
}

function sampleFit(fit, rangeNm, samples = 200) {
    const [low, high] = rangeNm;
    const rows = [];
    for (let index = 0; index <= samples; index++) {
        const lambda = low + ((high - low) * index) / samples;
        const [n, k] = evaluateDispersionFit(fit, lambda);
        rows.push({ lambda, n, k });
    }
    return rows;
}

/**
 * Macleod's danger signal: an extinction coefficient that grows toward longer
 * wavelengths.
 *
 * A dielectric film absorbs at its band edge, in the ultraviolet, so k falls as
 * wavelength rises. Extracted k that does the opposite means the model is wrong
 * rather than the film unusual. Macleod shows two ways to produce it: fitting a
 * homogeneous absorbing film to data from an inhomogeneous transparent one
 * (Figure 14.13), and a photometric scale error of one percent (Figure 14.14).
 * Both recalculate the input perfectly. "Once again, the rising extinction
 * coefficient with wavelength should be looked upon with deep suspicion."
 *
 * Only flagged when the rise is above what the measurement could resolve;
 * a k of 1e-6 rising to 2e-6 is describing nothing.
 */
export function risingExtinction(rows, thicknessNm) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (!first || !last) return null;
    const floor = resolvableExtinction(last.lambda, thicknessNm);
    if (!(last.k > first.k) || !(last.k > floor)) return null;
    return { fromK: first.k, toK: last.k, floor };
}

// A rise smaller than this is floating-point noise in an analytic model
// sampled at 201 points, not a turn in the curve. It is not a physical
// threshold: any real turn is orders of magnitude larger than this.
const INDEX_RISE_EPSILON = 1e-6;

/**
 * The index analogue of the rising-extinction signal above.
 *
 * A film that absorbs nowhere across the measured range sits far from any
 * absorption band, and away from a band the index falls as wavelength rises.
 * A fitted model that turns upward inside the range is describing something the
 * film cannot do.
 *
 * This is worth its own check because the residual does not reliably catch it.
 * The turn appears where the fringes thin out, which is exactly where the
 * spectrum stops constraining the index, so the model can bend a long way there
 * while the calculated spectrum still matches the measurement.
 *
 * Reported only for a film whose extinction stayed under what the measurement
 * could resolve. Near a real absorption edge the index does rise, and flagging
 * that would be wrong.
 */
export function risingIndex(rows, transparent) {
    if (!transparent) return null;
    let turnsAt = null;
    let rise = 0;
    for (let index = 1; index < rows.length; index++) {
        const step = rows[index].n - rows[index - 1].n;
        if (step <= 0) continue;
        if (turnsAt === null) turnsAt = rows[index - 1].lambda;
        rise += step;
    }
    return rise > INDEX_RISE_EPSILON
        ? { turnsAt, toLambda: rows[rows.length - 1].lambda, rise }
        : null;
}

/**
 * Where a fitted extinction leaves the values a dielectric film can have.
 *
 * The pointwise extraction brackets its own solve at the same value (see
 * EXTINCTION_MAX in pointwiseNk.js), so a model that leaves it is describing
 * something the measurement could not have produced. It is reached by a
 * degenerate extinction model rather than by an unusual film: two of its
 * parameters trade off exactly, the residual goes flat along that direction, and
 * the fit runs out along it until the numbers overflow.
 *
 * Metals are excluded, as they are for the index: their k passes ten in the
 * infrared.
 */
function extinctionOutOfRange(rows) {
    for (const row of rows) {
        if (!Number.isFinite(row.k)) return { k: NaN, lambda: row.lambda };
        if (row.k > EXTINCTION_MAX) return { k: row.k, lambda: row.lambda };
    }
    return null;
}

/** Where a transparent-film model leaves the indices such a film can have. */
function indexOutOfRange(rows) {
    let lowest = Infinity;
    let highest = -Infinity;
    for (const row of rows) {
        if (!Number.isFinite(row.n)) return { n: NaN, lambda: row.lambda };
        if (row.n < lowest) lowest = row.n;
        if (row.n > highest) highest = row.n;
    }
    if (lowest < 1) return { n: lowest, lambda: rows.find(row => row.n === lowest).lambda };
    if (highest > 8) return { n: highest, lambda: rows.find(row => row.n === highest).lambda };
    return null;
}

/** Sum of reflectance and transmittance above unity, beyond rounding. */
export function energyExcess(measured) {
    if (!Array.isArray(measured.T) || !Array.isArray(measured.R)) return null;
    let worst = 0;
    let at = null;
    for (let point = 0; point < measured.T.length; point++) {
        const total = measured.T[point] + measured.R[point];
        if (total > worst) { worst = total; at = point; }
    }
    return worst > 1 + PHOTOMETRIC_ACCURACY ? { total: worst, point: at } : null;
}

/**
 * Everything worth saying about a finished fit.
 *
 * Warnings name a condition a source calls wrong. Anything that is a matter of
 * degree is reported as a number instead and left to the reader, so nothing
 * here fails a fit against a limit that was picked rather than derived.
 *
 * @returns {{ warnings:{code:string, detail:object}[], indexRange:[number,number],
 *             extinctionRange:[number,number], resolvableExtinction:number }}
 */
export function fitDiagnostics({ fit, rangeNm, thicknessNm, measured, residuals, metallic }) {
    const rows = sampleFit(fit, rangeNm);
    const warnings = [];
    const resolvableFloor = resolvableExtinction((rangeNm[0] + rangeNm[1]) / 2, thicknessNm);
    const transparent = !metallic && rows.every(row => row.k <= resolvableFloor);

    const rising = risingExtinction(rows, thicknessNm);
    if (rising) warnings.push({ code: 'risingExtinction', detail: rising });

    const anomalous = risingIndex(rows, transparent);
    if (anomalous) warnings.push({ code: 'anomalousDispersion', detail: anomalous });

    if (!metallic) {
        const outOfRange = indexOutOfRange(rows);
        if (outOfRange) warnings.push({ code: 'indexOutOfRange', detail: outOfRange });
        const absorbing = extinctionOutOfRange(rows);
        if (absorbing) warnings.push({ code: 'extinctionOutOfRange', detail: absorbing });
    }

    const excess = energyExcess(measured);
    if (excess) warnings.push({ code: 'energyExcess', detail: excess });

    const mismatch = modelMismatch(residuals);
    if (mismatch) warnings.push({ code: 'modelMismatch', detail: mismatch });

    // Macleod is explicit that reflectance fringes on their own must not be used
    // to extract an extinction coefficient: reflectance is insensitive to
    // absorption unless it is very large.
    if (!Array.isArray(measured.T) && !Array.isArray(measured.PSI)
        && !Array.isArray(measured.DEL) && rows.some(row => row.k > 0)) {
        warnings.push({ code: 'extinctionFromReflectanceOnly', detail: {} });
    }

    const indices = rows.map(row => row.n);
    const extinctions = rows.map(row => row.k);
    return {
        warnings,
        indexRange: [Math.min(...indices), Math.max(...indices)],
        extinctionRange: [Math.min(...extinctions), Math.max(...extinctions)],
        resolvableExtinction: resolvableFloor,
    };
}
