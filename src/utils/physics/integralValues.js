/**
 * Integral Values & Characteristics — weighted averages of T(λ), R(λ), A(λ).
 *
 * Computes integral figures of merit such as
 *   • Photopic transmittance/reflectance:  Tvis, Rvis (CIE V(λ) × D65)
 *   • Solar transmittance/reflectance:     Tsol, Rsol (ASTM G173 AM1.5G)
 *   • Flat-band UV/NIR integrals
 *   • Arbitrary user-defined spectral weighting
 *
 * All integrals are of the form
 *
 *     C̄ = ∫ C(λ)·w(λ)·dλ  /  ∫ w(λ)·dλ
 *
 * evaluated by trapezoidal integration on the *design's* spectrum λ grid
 * (so the result respects the same spectral resolution as the rest of the
 * Optical Evaluation tool). The weighting w(λ) is sampled by linear
 * interpolation on its own table.
 *
 * Photopic Tvis/Rvis are computed by routing T (or R) through
 * `tristimulus(..., '2', 'D65')` in `colorimetry.js` — `Y` is exactly
 * the V(λ)·D65-weighted average (Macleod Eq. (12.2), Y = luminance factor).
 * That avoids duplicating the CIE tables here.
 *
 * Provenance:
 *   - Photopic V(λ): CIE 1924 photopic standard observer (= y-CMF of CIE
 *     1931 2°; CIE 15:2004 Table T.4)
 *   - D65 illuminant: CIE 15:2004 Table T.1
 *   - AM1.5G:        ASTM G173-03, NREL public-domain dataset (see solarSpectrum.js)
 */

export { BUILTIN_WEIGHTINGS, makeUserWeighting } from './integralValues/builtinWeightings.js';
export { computeIntegralValue, computeIntegralValueBatch } from './integralValues/computeIntegral.js';
export {
    DEFAULT_INTEGRALS, useIntegralPresets, buildMfePresetList,
} from './integralValues/presets.js';
export { parseWeightingCSV } from './integralValues/csv.js';
