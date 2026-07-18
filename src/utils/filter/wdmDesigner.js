/**
 * WDM Filter Design — multi-cavity Fabry-Perot prototype generator.
 *
 * References:
 *   - H. A. Macleod, *Thin-Film Optical Filters* 5th ed., Ch. 7-8
 *     "Multiple-cavity Narrow Band-pass Filters", esp. §8.2
 *   - Tikhonravov & Trubetskov, *Appl. Opt.* **41**, 3176 (2002), §3
 *
 * Canonical topology (q cavities, k QW pairs per mirror, spacer order m):
 *
 *   Substrate | M_1  S_1  M_2  S_2  …  M_q  S_q  M_{q+1} | optional AR | Air
 *
 * Where (using L-spacer as the example — H-spacer mirrors all materials):
 *   - S_i  = one physical layer of L (or H), thickness 2m·d_L
 *            (m half-waves at λ₀; m=1 ⇒ half-wave, m=2 ⇒ full-wave, …)
 *   - M_1  = (LH)^k        — 2k layers, starts L (substrate), ends H (spacer-facing)
 *   - M_2…M_q = H(LH)^k    — 2k+1 layers, starts H, ends H (both faces = spacer-side)
 *   - M_{q+1} = (HL)^k     — 2k layers, starts H (spacer-facing), ends L (air-side)
 *
 * For dispersive materials we sample n(λ₀) once; the TMM evaluator handles
 * full dispersion at run time.
 *
 * Multi-peak preview: the SYMMETRIC prototype has q sub-peaks across the
 * passband (textbook Chebyshev ripple, Macleod Fig 8.16) that merge into a
 * flat-top after Global Integer Search / Refinement / Needle. Users seeing
 * "N peaks for an N-cavity filter" are looking at the unoptimized starting
 * prototype — that's expected, not a bug.
 *
 * Total layer count: 2k·(q+1) + 2q − 1   (+1 for optional AR top L)
 */

export { WDM_LOSSY_THRESHOLD, isMaterialLosslessForWDM } from './wdmDesigner/materials.js';
export { buildWDMStack, wdmLayerCount } from './wdmDesigner/stack.js';
export { buildWDMOperands } from './wdmDesigner/operands.js';
export { buildWDMDesign } from './wdmDesigner/design.js';
export { notationM_to_mirrorPairs, mirrorPairs_to_notationM } from './wdmDesigner/notation.js';
export {
    multicavityFwhmFactor,
    WDM_K_MIRROR_MIN, WDM_K_MIRROR_MAX,
    WDM_M_SPACER_MIN, WDM_M_SPACER_MAX,
    estimateFWHM_nm,
    solveMirrorPairsFromFWHM,
    suggestCavities,
    buildPrototypeCandidates,
} from './wdmDesigner/fwhm.js';
