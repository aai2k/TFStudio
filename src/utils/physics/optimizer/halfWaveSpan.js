/**
 * Largest thickness change, nm, that one model-based refinement step (DLS,
 * Newton, Newton-CG, SQP) may make in one layer.
 *
 * A layer's characteristic matrix (Macleod, Thin-Film Optical Filters 5th ed.,
 * Eq. 2.111) depends on its thickness through the phase thickness
 * δ = 2πNd·cosθ/λ. Grown by a half wave, λ/(2n) at normal incidence, a
 * non-absorbing layer's matrix changes sign and R and T at that wavelength are
 * unchanged: the half wave is an absentee layer. The merit at each sampled
 * wavelength therefore repeats with that period, the derivatives a model step
 * is built on say nothing past it, and a longer step lands on an arbitrary
 * fringe. In a band merit the fringes of a very thick layer are also finer
 * than the wavelength grid, so the sampled merit there stops describing the
 * spectrum. The span of each layer is its half-wave thickness at normal
 * incidence and at the longest wavelength the merit function samples: the
 * longest period of any sampled wavelength, and no longer than the period at
 * oblique incidence, which grows as 1/cosθ. For an absorbing layer
 * |N| = √(n² + k²) replaces n, which keeps the span no longer than the
 * dielectric period. The span limits one step, not the thickness: a layer can
 * grow without bound over successive accepted steps.
 */
import { operandWavelengthSpan } from './sampling.js';

// Span per optimization variable, nm. Infinity where no span can be formed
// (no sampled wavelength, or a material without valid n,k there).
export function halfWaveSpans(operands, mats) {
    const band = operandWavelengthSpan(operands);
    return mats.map(mat => {
        if (!band) return Infinity;
        const lambdaNm = band[1];
        let nk = null;
        try { nk = mat?.getNK?.(lambdaNm); } catch { nk = null; }
        const modulus = nk ? Math.hypot(nk[0], nk[1]) : NaN;
        return modulus > 0 ? lambdaNm / (2 * modulus) : Infinity;
    });
}

// Scale a step in place so no free layer moves by more than its span; the
// direction is kept. `delta[a]` is the change of variable freeIdx[a].
export function limitStepToSpans(delta, freeIdx, spans) {
    let excess = 1;
    for (let a = 0; a < freeIdx.length; a++) {
        const ratio = Math.abs(delta[a]) / spans[freeIdx[a]];
        if (ratio > excess) excess = ratio;
    }
    if (excess > 1) for (let a = 0; a < delta.length; a++) delta[a] /= excess;
    return delta;
}
