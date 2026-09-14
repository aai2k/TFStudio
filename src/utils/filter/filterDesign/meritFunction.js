import { embeddedT } from './spectrum.js';
import { tiltedLayers, tiltedBandCentre } from './tiltEnvironment.js';

/** Sum of squared one-sided residuals, in percent, over the target points. */
function sumSquares(pts, Tof) {
    let ss = 0;
    for (const pt of pts) {
        const T = 100 * Tof(pt);
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
 * With `target.tiltDeg` above zero the same points are scored a second time on
 * the candidate tilted to that angle (tiltEnvironment.js), every wavelength
 * moved by the shift of the candidate's own band centre, and the two sums of
 * squares are pooled into one RMS over both point sets. A design that keeps its
 * shape when tilted scores about the same in both; one whose cavities detune
 * against each other scores ten to a hundred times worse in the second.
 * Nothing weights the two: the second set has the size and the scales of the
 * first.
 *
 * @returns {{ mf:number, mf0:number, mfTilt:number|null }}  mf is what the
 *   search minimises; mf0 and mfTilt are the RMS of each environment on its
 *   own, mfTilt null while the tilt is off.
 */
export function meritFunctionParts(layers, target, nSub) {
    const pts = target.points;
    if (!pts.length) return { mf: 0, mf0: 0, mfTilt: null };
    const ss0 = sumSquares(pts, (pt) => embeddedT(layers, pt.lambda, nSub, pt.aoi, pt.pol));
    const mf0 = Math.sqrt(ss0 / pts.length);
    if (!(target.tiltDeg > 0)) return { mf: mf0, mf0, mfTilt: null };
    const tilted = tiltedLayers(layers, target.tiltDeg);
    const shift = tiltedBandCentre(tilted, target, nSub).centre - target.lambda0_nm;
    const ssT = sumSquares(pts, (pt) => embeddedT(tilted, pt.lambda + shift, nSub));
    return { mf: Math.sqrt((ss0 + ssT) / (2 * pts.length)), mf0, mfTilt: Math.sqrt(ssT / pts.length) };
}

/** The merit the search minimises, see `meritFunctionParts`. */
export function meritFunctionEmbedded(layers, target, nSub) {
    return meritFunctionParts(layers, target, nSub).mf;
}
