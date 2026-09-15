import { embeddedT } from './spectrum.js';
import { bandCentreAtAngle } from './tiltEnvironment.js';

/**
 * Sum of squared one-sided residuals, in percent, over the target points, with
 * the design evaluated at one angle and its own band shift taken out.
 *
 * Tilting moves a filter's whole passband to shorter wavelengths, by tens of
 * nanometres at the angles a beamsplitter mount uses. That shift is set by the
 * cavity index and the angle (Macleod, Thin-Film Optical Filters 5th ed.,
 * Eq. 8.30) and no choice of integers removes it, so scoring it would only rank
 * designs by their cavity index. The band is located first and every target
 * wavelength moved onto it; what is left to score is the shape the band has
 * once it gets there, which is what the structure does control. The design is
 * brought back to λ₀ afterwards by laying its quarter waves at a longer
 * reference (designReference.js).
 *
 * At angle 0 the shift is exactly 0 and nothing is scanned.
 */
function sumSquaresAt(layers, target, nSub, aoiDeg, reference_nm) {
    const pol = target.pol;
    const shift = aoiDeg > 0
        ? bandCentreAtAngle({ layers, target, nSub, aoiDeg, pol, reference_nm }).centre - target.lambda0_nm
        : 0;
    let ss = 0;
    for (const pt of target.points) {
        const T = 100 * embeddedT(layers, pt.lambda + shift, nSub, aoiDeg, pol);
        const d = pt.band === 'pass' ? Math.min(0, T - pt.target) : Math.max(0, T - pt.target);
        ss += (d / pt.sigma) ** 2;
    }
    return ss;
}

/**
 * Embedded merit function and its two parts: RMS one-sided residual against
 * the sparse target, in percent transmittance.
 *
 * Each point counts only on the side of its level that violates the
 * specification, a passband point when T is below it and a stopband point when
 * T is above it, and is divided by its own residual scale before squaring. This
 * is the function OptiLayer reports on its step-5 page, and it reproduces the
 * three (structure, merit) pairs on record to 2 %.
 *
 * With `target.holdAoi` above the working angle the same points are scored a
 * second time at that larger angle, and the two sums of squares are pooled into
 * one RMS over both point sets. A design that keeps its shape when tilted scores
 * about the same in both; one whose cavities detune against each other scores
 * ten to a hundred times worse in the second (§8.4.1: "Detuned cavities have a
 * seriously degrading effect on multiple-cavity filters"). Nothing weights the
 * two: the second set has the size and the scales of the first.
 *
 * @param {number} [reference_nm]  wavelength `layers` had its quarter waves laid
 *   at, which the band at an angle sits below and the centring brackets against.
 *   Defaults to the target's λ₀, which is where the search lays every candidate.
 *   A stack built at a stretched reference (designReference.js) MUST pass its
 *   own, or the centring scan brackets a window its band is not in and the merit
 *   comes back meaningless rather than wrong-by-a-little.
 * @returns {{ mf:number, mf0:number, mfTilt:number|null }}  mf is what the
 *   search minimises; mf0 and mfTilt are the RMS at each angle on its own,
 *   mfTilt null while the hold angle is off.
 */
export function meritFunctionParts(layers, target, nSub, reference_nm = target.lambda0_nm) {
    const pts = target.points;
    if (!pts.length) return { mf: 0, mf0: 0, mfTilt: null };
    const aoi = target.aoi || 0;
    const ss0 = sumSquaresAt(layers, target, nSub, aoi, reference_nm);
    const mf0 = Math.sqrt(ss0 / pts.length);
    if (!(target.holdAoi > aoi)) return { mf: mf0, mf0, mfTilt: null };
    const ssT = sumSquaresAt(layers, target, nSub, target.holdAoi, reference_nm);
    return { mf: Math.sqrt((ss0 + ssT) / (2 * pts.length)), mf0, mfTilt: Math.sqrt(ssT / pts.length) };
}

/** The merit the search minimises, see `meritFunctionParts`. */
export function meritFunctionEmbedded(layers, target, nSub, reference_nm = target.lambda0_nm) {
    return meritFunctionParts(layers, target, nSub, reference_nm).mf;
}
