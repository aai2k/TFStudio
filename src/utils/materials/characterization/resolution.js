/**
 * What a photometric measurement of a film can resolve.
 *
 * Both the fit and its diagnostics need to know where the instrument runs out,
 * so an extracted absorption that is really instrument noise is not carried as
 * if it were a property of the film.
 */

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
