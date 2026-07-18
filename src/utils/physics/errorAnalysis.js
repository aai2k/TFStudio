/**
 * Error Analysis & Layer Sensitivity utilities.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Layer Sensitivity
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each variable layer is ranked by the sensitivity of the merit function
 * to a small variation of its thickness:
 *
 *     ΔMF_j = MF(d₁, …, d_j + Δd_j, …, d_N) − MF(d₁, …, d_j, …, d_N)
 *
 * Layers are then scaled to the maximum |ΔMF| and expressed as a percentage,
 * with the most sensitive layer = 100 %.
 *
 * We compute ΔMF via central differences against the existing merit-operand
 * machinery (`buildEvalContext` / `evaluateOperands` / `calcMF`), so the
 * sensitivity is naturally surface-mode-aware (front_only / back_only /
 * symmetric / both_independent) and consistent with what the optimizer sees.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Monte Carlo Error Analysis
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Statistical evaluation of the influence of random manufacturing errors on a
 * spectral characteristic — following Macleod §13.7 ("Tolerances"):
 *
 *     RMS_j^res = RMS_abs + RMS_rel · d_j
 *
 * for layer thicknesses, plus optional absolute σ on Re(n) and Im(n). For each
 * Monte-Carlo trial we draw independent Gaussian deviations for every layer,
 * rebuild a perturbed design, evaluate the chosen spectral characteristic
 * (T, R or A; s/p/avg; one AOI), and accumulate online sums. The output is the
 * theoretical curve plus the sample mean ("Exp") and ±kσ corridors (k = 1 by
 * default).
 *
 * Reference: Macleod 5th ed. §13.7 — Monte Carlo is the established way to
 * model manufacturing tolerances:
 *   "Such modeling, almost invariably of the Monte Carlo type, allows the
 *    study of errors and tolerances in an almost completely realistic way."
 *
 *
 * No new physics is introduced here — every spectral evaluation routes through
 * the validated `evaluateSpectrum` / `evaluateSpectrumBack` / `evaluateSpectrumTotal`
 * TMM in `thinFilmMath.js`, and the merit-function path reuses
 * `evaluateOperands` / `calcMF` from `optimizer.js`.
 */

export { computeLayerSensitivity } from './errorAnalysis/layerSensitivity.js';
export { runErrorAnalysisMC } from './errorAnalysis/monteCarlo.js';
