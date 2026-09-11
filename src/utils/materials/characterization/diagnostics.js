/**
 * Whether an extracted set of film constants can be believed.
 *
 * A characterization that reports only its residual is not much use: Macleod's
 * own worked examples show a model fitting its data perfectly while describing
 * the wrong film. Two of those examples are checked for here directly, because
 * the residual will not catch either one.
 *
 * The checks that read the fitted curve itself are in modelChecks.js; this file
 * holds the ones that read the measurement and its residuals, and assembles
 * everything into one report.
 *
 * Reference throughout: Macleod, Thin-Film Optical Filters, 5th ed.,
 * "Measurement of the Optical Properties" (Figures 14.13 and 14.14 and the
 * surrounding text).
 */

import { channelDifference } from './sampleSpectrum.js';
import { PHOTOMETRIC_ACCURACY, resolvableExtinction } from './resolution.js';
import {
    extinctionOutOfRange,
    indexOutOfRange,
    risingExtinction,
    risingIndex,
    sampleFit,
} from './modelChecks.js';

export { PHOTOMETRIC_ACCURACY, resolvableExtinction } from './resolution.js';
export { risingExtinction, risingIndex } from './modelChecks.js';

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
 *
 * Photometry only. Ψ and Δ have no accuracy in the sources this module follows
 * to compare a residual against, and a limit picked here would fail sound fits
 * on films whose model error genuinely exceeds it. Their residuals are reported
 * as numbers and read on the Residual plot instead.
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

/**
 * Sum of reflectance and transmittance above unity, beyond rounding.
 *
 * Judged on the average over the range rather than on the worst wavelength. A
 * calibration fault is a scale error: it lifts every wavelength together, and
 * the average carries it. The worst single point does not, because noise on
 * two channels at the accuracy this module assumes puts the largest of a few
 * hundred sums about three times that accuracy above one on its own. Testing
 * the maximum reported a calibration fault on every measurement made to the
 * stated accuracy, which is the opposite of useful.
 *
 * The worst point still travels in the detail, as the place to go and look.
 */
export function energyExcess(measured) {
    if (!Array.isArray(measured.T) || !Array.isArray(measured.R)) return null;
    let worst = 0;
    let at = null;
    let sum = 0;
    let count = 0;
    for (let point = 0; point < measured.T.length; point++) {
        const total = measured.T[point] + measured.R[point];
        if (total > worst) { worst = total; at = point; }
        sum += total;
        count++;
    }
    if (count === 0) return null;
    const mean = sum / count;
    return mean > 1 + PHOTOMETRIC_ACCURACY ? { total: worst, mean, point: at } : null;
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
export function fitDiagnostics({ fit, rangeNm, thicknessNm, measured, residuals, metallic, energyComparable = true }) {
    const rows = sampleFit(fit, rangeNm);
    const warnings = [];
    const resolvableFloor = resolvableExtinction((rangeNm[0] + rangeNm[1]) / 2, thicknessNm);
    const transparent = !metallic && rows.every(row => row.k <= resolvableFloor);

    const anomalous = risingIndex(rows, transparent);
    if (anomalous) warnings.push({ code: 'anomalousDispersion', detail: anomalous });

    if (!metallic) {
        const rising = risingExtinction(rows, thicknessNm);
        if (rising) warnings.push({ code: 'risingExtinction', detail: rising });

        const outOfRange = indexOutOfRange(rows);
        if (outOfRange) warnings.push({ code: 'indexOutOfRange', detail: outOfRange });
        const absorbing = extinctionOutOfRange(rows);
        if (absorbing) warnings.push({ code: 'extinctionOutOfRange', detail: absorbing });
    }

    // R + T is an energy balance only for the same illumination conditions.
    const excess = energyComparable ? energyExcess(measured) : null;
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
