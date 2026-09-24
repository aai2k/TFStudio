/**
 * Colorimetry — CIE color evaluation of a coating's spectral response.
 *
 * Physics / data provenance (every formula and table is from published
 * standards, none invented — see the project scientific-correctness rules):
 *
 *  - Tristimulus integral:  H. A. Macleod, *Thin-Film Optical Filters* 5th ed.,
 *    §12.2 "Color Definition", Eqs. (12.1)–(12.3):
 *        X = 100 · ∫S(λ)R(λ)x̄(λ)dλ / ∫S(λ)ȳ(λ)dλ
 *        Y = 100 · ∫S(λ)R(λ)ȳ(λ)dλ / ∫S(λ)ȳ(λ)dλ
 *        Z = 100 · ∫S(λ)R(λ)z̄(λ)dλ / ∫S(λ)ȳ(λ)dλ
 *    (Y = luminous reflectance/transmittance in %, the "luminance factor").
 *    Chromaticity x,y — Macleod Eqs. (12.4)–(12.5).
 *  - CIE 1931 2° and CIE 1964 10° colour-matching functions: CIE 15:2004
 *    standard tables (identical to Wyszecki & Stiles, *Color Science* 2nd ed.,
 *    Table I(3.3.1)/I(3.3.3)), 380–780 nm @ 5 nm.
 *  - Standard illuminant D65 / D50 relative SPD: CIE 15:2004 Table T.1
 *    (D50 = ICC/CIE), 380–780 nm @ 5 nm.
 *  - Standard illuminant A: CIE 15:2004 analytic Planckian formula (Tc≈2856 K).
 *  - Standard illuminant E: equal-energy, S(λ)≡100.
 *  - CIELAB / CIELUV / u'v' / 1960 uv / Hunter Lab: CIE 15:2004 §8.
 *  - Dominant/complementary wavelength + excitation purity: Macleod §12.2
 *    (white-point → sample → spectrum-locus construction); CIE 15 §F.
 *  - Correlated colour temperature: McCamy, *Color Res. Appl.* 17, 142 (1992)
 *    cubic approximation; Duv via Planckian locus in CIE 1960 (u,v).
 *  - Colour difference ΔE₀₀: CIE 142-2001 / Sharma, Wu & Dalal,
 *    *Color Res. Appl.* 30, 21 (2005).
 *  - XYZ→sRGB swatch: IEC 61966-2-1 (sRGB) primaries + Bradford chromatic
 *    adaptation (illuminant white → D65) so the patch shows the perceived
 *    colour under the selected source.
 *
 * The integrals 12.1–12.3 are evaluated by the trapezoidal rule on the
 * wavelength grid the response was computed on, with the 5 nm illuminant and
 * colour-matching tables linearly interpolated to that grid. The reference
 * white is integrated on the same grid.
 */

export {
  OBSERVERS, ILLUMINANTS, illuminantSPD, photopicV,
  PHOTOPIC_RANGE_NM, D65_RANGE_NM, D50_RANGE_NM, COLOR_RANGE_NM,
} from './colorimetry/tables.js';
export {
  tristimulus, whitePoint, chromaticityXy, uvPrime, uv1960, lab, luv, hunterLab,
} from './colorimetry/colorSpaces.js';
export {
  spectralLocusXy, dominantWavelength, correlatedColorTemperature,
} from './colorimetry/locus.js';
export { ciede2000 } from './colorimetry/deltaE.js';
export { xyzToSRGB } from './colorimetry/srgb.js';
export { colorReport } from './colorimetry/report.js';
