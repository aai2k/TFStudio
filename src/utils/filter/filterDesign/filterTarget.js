/**
 * Number of points across the passband, the two outermost carrying the
 * specified pass level and the rest 100 %.
 *
 * OptiLayer draws its target as crosses on the step-5 plot: a dense row at
 * 100 % across the passband and one cross at the pass level at each ±halfPass.
 * The crosses were read off a native-resolution video frame at 1530 nm and off
 * a photograph at 600 nm; the two readings put the outermost 100 % cross at
 * 0.93 and 0.73 of halfPass, which no single layout satisfies, so the count
 * here is fitted instead. 17 points reproduces all three (structure, merit)
 * pairs on record to 2 %, and puts that cross at 0.875 of halfPass, between the
 * two readings.
 */
const PASSBAND_POINTS = 17;

/** Stopband points, as multiples of halfStop on each side. Nothing lies further out. */
const STOPBAND_MULTIPLES = [1, 1.1, 1.2, 2];

/**
 * Residual scale of a stopband point, in percent. A stop point five times
 * tighter than a pass point is what reproduces the searched design's merit;
 * without it the rejection edge cannot compete with the passband and the search
 * widens the whole filter to flatten its top.
 */
const STOP_SIGMA = 0.2;

/**
 * Build the filter target: the sparse point set OptiLayer scores its step-5
 * designs on, in percent.
 *
 * The specification is two half-widths: T at or above `passLevel` out to
 * ±halfPass, and T at or below the stop level by ±halfStop. Those are the
 * points the target carries and nothing else. Every point is one-sided: a
 * passband point contributes only when T is BELOW its level and a stopband
 * point only when T is ABOVE zero, which is what lets a design spend the 0.5 dB
 * allowance it was granted instead of being punished for the roll-off.
 *
 * Each point carries its own (λ, aoi, pol), so a second environment can be
 * added without changing the layout.
 *
 * @param {number} p.lambda0_nm
 * @param {number} p.halfPass   half-width of the transmission band (nm)
 * @param {number} p.halfStop   half-width where rejection must hold (nm)
 * @param {number} [p.passLevel=89.13]  transmittance the passband half-width is quoted at, %
 * @param {number} [p.aoi=0] @param {string} [p.pol='s']
 * @param {number} [p.tiltDeg=0]  angle in air, degrees, the passband is held
 *   to: above zero the merit scores every design tilted to it as well
 *   (meritFunction.js); 0 scores at normal incidence only
 * @returns {{ points: {lambda:number, target:number, band:'pass'|'stop', sigma:number, aoi:number, pol:string}[],
 *   lambda0_nm:number, halfPass:number, halfStop:number, tiltDeg:number }}
 */
export function buildFilterTarget({
    lambda0_nm, halfPass, halfStop, passLevel = 89.13, aoi = 0, pol = 's', tiltDeg = 0,
}) {
    const points = [];
    const add = (lambda, target, band, sigma) => points.push({ lambda, target, band, sigma, aoi, pol });

    const half = (PASSBAND_POINTS - 1) / 2;
    for (let i = -half; i <= half; i++) {
        add(lambda0_nm + (i / half) * halfPass, Math.abs(i) === half ? passLevel : 100, 'pass', 1);
    }
    for (const side of [-1, 1]) {
        for (const m of STOPBAND_MULTIPLES) add(lambda0_nm + side * m * halfStop, 0, 'stop', STOP_SIGMA);
    }
    return { points, lambda0_nm, halfPass, halfStop, tiltDeg };
}

/** How far out from λ₀ the target reaches (nm): the window a search has to sample. */
export function targetSpan(halfPass, halfStop) {
    return Math.max(halfPass, halfStop * Math.max(...STOPBAND_MULTIPLES));
}
