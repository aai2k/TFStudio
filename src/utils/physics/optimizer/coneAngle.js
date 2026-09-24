/**
 * Cone-angle (convergent / divergent beam) averaging.
 *
 * Real illumination is never perfectly collimated: a condensing lens delivers a
 * CONE of incidence angles onto the sample, so the measured R/T/A is the
 * power-weighted average over that cone, not a single-angle value.
 *
 * This is the PURE quadrature core. It turns a cone specification (half-angle /
 * f-number / NA + an intensity distribution) plus a cone-axis incidence angle
 * into a set of {aoiDeg, weight} nodes whose weighted sum approximates
 *
 *        ∫∫  Q(θ) · I(α) dΩ
 *   Q̄ = ─────────────────────         (weights normalized to Σ=1)
 *         ∫∫  I(α) dΩ
 *
 * over the rays of the cone that reach the surface (θ < 90°), where α is a
 * ray's angle to the cone axis and θ its angle of incidence. Q depends on θ
 * alone, so nodes.js reduces this to one integral over θ.
 *
 * The implementation is split under `coneAngle/`; this barrel re-exports the
 * public surface:
 *   • conversions.js: f-number / NA / half-angle conversions.
 *   • quadrature.js:  Gauss–Legendre and Clenshaw–Curtis nodes/weights.
 *   • spec.js:        `makeConeSpec` / `coneIsActive` + intensity model.
 *   • arcWeight.js:   the cone's weight at one angle of incidence.
 *   • nodes.js:       `coneNodes`, the quadrature over the angle of incidence.
 *   • average.js:     the node-count rule `resolveConeNodes` and
 *                     `coneAverageResult`.
 *
 * References: Macleod, *Thin-Film Optical Filters* 5e, §16 & §8.2.5.4
 * (Eq. 8.39–8.46).
 *
 * Polarization note (Macleod §16 "Cone Response of Thin-Film Polarizers"): cone
 * averaging is physically meaningful only for AVERAGED (unpolarized) light,
 * because each ray has its own local plane of incidence. s/p results are
 * "formal" — still produced (each node evaluated at its θ with the requested pol
 * code), but they carry no rigorous polarization meaning.
 */

export {
    naFromHalfAngle, halfAngleFromNA, naFromFNumber, fNumberFromNA,
    halfAngleFromFNumber, fNumberFromHalfAngle,
} from './coneAngle/conversions.js';
export { gaussLegendre, clenshawCurtis } from './coneAngle/quadrature.js';
export { makeConeSpec, coneIsActive } from './coneAngle/spec.js';
export { coneNodes } from './coneAngle/nodes.js';
export {
    coneAverageResult, resolveConeNodes, CONE_AVERAGE_TOLERANCE, MAX_CONE_NODES,
} from './coneAngle/average.js';
