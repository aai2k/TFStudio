import { bandCentreAtAngle } from './tiltEnvironment.js';

/**
 * Fixed-point steps taken on the reference wavelength.
 *
 * For materials without dispersion every thickness scales with the reference, so
 * the band position is proportional to it and one step is exact. Dispersion
 * breaks the proportionality, because the quarter waves are laid at the index at
 * the reference rather than at the index at λ₀. Two steps then put the band
 * within 0.01 nm of λ₀ on the designs a search at 45° returns with the builtin
 * Nb2O5 and SiO2 pair, a hundredth of the passband half-width of a filter that
 * narrow, and a third step moves it by less than the centring scan can resolve.
 */
const REFERENCE_STEPS = 2;

/**
 * Wavelength to lay the design's quarter waves at, so that its passband sits on
 * λ₀ when the filter is used at its working angle.
 *
 * A filter tilted away from normal moves its passband to shorter wavelengths
 * (Macleod, Thin-Film Optical Filters 5th ed., §8.2.5, p. 276), so a filter for
 * 600 nm at 45° has to be built for a longer wavelength than 600 nm: about
 * 670 nm for a first-order low-index cavity in the builtin pair. The standard
 * estimate of the factor needs the cavity's effective index (Eq. 8.30), which a
 * design of several cavities of different orders and materials does not have a
 * single value of, so the factor is measured on the design instead: build it,
 * see where its band lands, and stretch the reference by the ratio it fell short
 * by.
 *
 * The reference kept is the one whose band was measured closest to λ₀, not
 * whichever the last step produced. A design torn apart at the angle has no band
 * to centre, only the highest point of a broken one, and stepping on that can
 * walk away from the answer instead of towards it. Keeping the best measurement
 * bounds the result by the starting point in the worst case.
 *
 * At a working angle of 0 the answer is λ₀ and nothing is built.
 *
 * @param {object} p
 * @param {function} p.buildAt  (reference_nm) => engine layers
 * @param {object}   p.target   from buildFilterTarget, carrying pol and, when
 *   omitted below, the embedded working angle to measure at
 * @param {function} p.nSub     substrate index fn
 * @param {function} [p.nInc]   incident index fn, to solve on the finished filter
 *   in its own medium rather than on the embedded prototype; needs `aoiDeg`
 * @param {number}   [p.aoiDeg] angle in that incident medium, degrees
 * @returns {number} reference wavelength, nm
 */
export function designReference({ buildAt, target, nSub, nInc = nSub, aoiDeg = target.aoi }) {
    const { lambda0_nm, pol } = target;
    if (!(aoiDeg > 0)) return lambda0_nm;
    let reference = lambda0_nm, best = lambda0_nm, bestErr = Infinity;
    for (let i = 0; i <= REFERENCE_STEPS; i++) {
        const layers = buildAt(reference);
        const { centre } = bandCentreAtAngle({ layers, target, nSub, nInc, aoiDeg, pol, reference_nm: reference });
        if (!(centre > 0)) break;
        const err = Math.abs(centre - lambda0_nm);
        if (err < bestErr) { best = reference; bestErr = err; }
        // The last pass only measures: a step taken there produces a reference
        // nothing builds or scores, so it could never be the one kept.
        if (i < REFERENCE_STEPS) reference *= lambda0_nm / centre;
    }
    return best;
}
