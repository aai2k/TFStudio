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
 *        ∫∫  Q(θ(α,φ)) · I(α) · sinα  dα dφ
 *   Q̄ = ───────────────────────────────────         (weights normalized to Σ=1)
 *            ∫∫  I(α) · sinα  dα dφ
 *
 * where α is the polar offset from the cone axis, φ the azimuth around it, and
 * θ(α,φ) the resulting incidence angle (spherical-cosine law
 * cos θ = cos γ · cos α − sin γ · sin α · cos φ, γ = cone-axis AOI).
 *
 * The implementation is split under `coneAngle/`; this barrel re-exports the
 * public surface:
 *   • conversions.js — f-number / NA / half-angle conversions.
 *   • quadrature.js  — Gauss–Legendre nodes/weights.
 *   • spec.js        — `makeConeSpec` / `coneIsActive` + intensity model.
 *   • nodes.js       — `coneNodes` quadrature and `coneAverageResult`.
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
export { gaussLegendre } from './coneAngle/quadrature.js';
export { makeConeSpec, coneIsActive } from './coneAngle/spec.js';
export { coneNodes, coneAverageResult } from './coneAngle/nodes.js';
