/**
 * Colorimetry — CIE color evaluation of a coating's spectral response.
 *
 * Physics / data provenance (every formula and table is from published
 * standards, none invented — see CLAUDE.md scientific-correctness rules):
 *
 *  - Tristimulus integral:  H. A. Macleod, *Thin-Film Optical Filters* 5th ed.,
 *    §12.2 "Color Definition", Eqs. (12.1)–(12.3):
 *        X = 100 · Σ S(λ)R(λ)x̄(λ) / Σ S(λ)ȳ(λ)
 *        Y = 100 · Σ S(λ)R(λ)ȳ(λ) / Σ S(λ)ȳ(λ)
 *        Z = 100 · Σ S(λ)R(λ)z̄(λ) / Σ S(λ)ȳ(λ)
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
 * The integral is evaluated by simple Riemann summation on the chosen
 * integration grid (Macleod's discrete form 12.1–12.3); the constant Δλ
 * cancels between numerator and denominator.
 */

// ── CIE 1931 2° standard observer  (λ nm, x̄, ȳ, z̄) — CIE 15:2004 ─────────────
const CMF_2 = [
  [380,0.001368,0.000039,0.006450],[385,0.002236,0.000064,0.010550],
  [390,0.004243,0.000120,0.020050],[395,0.007650,0.000217,0.036210],
  [400,0.014310,0.000396,0.067850],[405,0.023190,0.000640,0.110200],
  [410,0.043510,0.001210,0.207400],[415,0.077630,0.002180,0.371300],
  [420,0.134380,0.004000,0.645600],[425,0.214770,0.007300,1.039050],
  [430,0.283900,0.011600,1.385600],[435,0.328500,0.016840,1.622960],
  [440,0.348280,0.023000,1.747060],[445,0.348060,0.029800,1.782600],
  [450,0.336200,0.038000,1.772110],[455,0.318700,0.048000,1.744100],
  [460,0.290800,0.060000,1.669200],[465,0.251100,0.073900,1.528100],
  [470,0.195360,0.090980,1.287640],[475,0.142100,0.112600,1.041900],
  [480,0.095640,0.139020,0.812950],[485,0.057950,0.169300,0.616200],
  [490,0.032010,0.208020,0.465180],[495,0.014700,0.258600,0.353300],
  [500,0.004900,0.323000,0.272000],[505,0.002400,0.407300,0.212300],
  [510,0.009300,0.503000,0.158200],[515,0.029100,0.608200,0.111700],
  [520,0.063270,0.710000,0.078250],[525,0.109600,0.793200,0.057250],
  [530,0.165500,0.862000,0.042160],[535,0.225750,0.914850,0.029840],
  [540,0.290400,0.954000,0.020300],[545,0.359700,0.980300,0.013400],
  [550,0.433450,0.994950,0.008750],[555,0.512050,1.000000,0.005750],
  [560,0.594500,0.995000,0.003900],[565,0.678400,0.978600,0.002750],
  [570,0.762100,0.952000,0.002100],[575,0.842500,0.915400,0.001800],
  [580,0.916300,0.870000,0.001650],[585,0.978600,0.816300,0.001400],
  [590,1.026300,0.757000,0.001100],[595,1.056700,0.694900,0.001000],
  [600,1.062200,0.631000,0.000800],[605,1.045600,0.566800,0.000600],
  [610,1.002600,0.503000,0.000340],[615,0.938400,0.441200,0.000240],
  [620,0.854450,0.381000,0.000190],[625,0.751400,0.321000,0.000100],
  [630,0.642400,0.265000,0.000050],[635,0.541900,0.217000,0.000030],
  [640,0.447900,0.175000,0.000020],[645,0.360800,0.138200,0.000010],
  [650,0.283500,0.107000,0.000000],[655,0.218700,0.081600,0.000000],
  [660,0.164900,0.061000,0.000000],[665,0.121200,0.044580,0.000000],
  [670,0.087400,0.032000,0.000000],[675,0.063600,0.023200,0.000000],
  [680,0.046770,0.017000,0.000000],[685,0.032900,0.011920,0.000000],
  [690,0.022700,0.008210,0.000000],[695,0.015840,0.005723,0.000000],
  [700,0.011359,0.004102,0.000000],[705,0.008111,0.002929,0.000000],
  [710,0.005790,0.002091,0.000000],[715,0.004109,0.001484,0.000000],
  [720,0.002899,0.001047,0.000000],[725,0.002049,0.000740,0.000000],
  [730,0.001440,0.000520,0.000000],[735,0.001000,0.000361,0.000000],
  [740,0.000690,0.000249,0.000000],[745,0.000476,0.000172,0.000000],
  [750,0.000332,0.000120,0.000000],[755,0.000235,0.000085,0.000000],
  [760,0.000166,0.000060,0.000000],[765,0.000117,0.000042,0.000000],
  [770,0.000083,0.000030,0.000000],[775,0.000059,0.000021,0.000000],
  [780,0.000042,0.000015,0.000000],
];

// ── CIE 1964 10° supplementary observer  (λ nm, x̄₁₀, ȳ₁₀, z̄₁₀) — CIE 15:2004 ─
const CMF_10 = [
  [380,0.000160,0.000017,0.000705],[385,0.000662,0.000072,0.002928],
  [390,0.002362,0.000253,0.010482],[395,0.007242,0.000769,0.032344],
  [400,0.019110,0.002004,0.086011],[405,0.043400,0.004509,0.197120],
  [410,0.084736,0.008756,0.389366],[415,0.140638,0.014456,0.656760],
  [420,0.204492,0.021391,0.972542],[425,0.264737,0.029497,1.282500],
  [430,0.314679,0.038676,1.553480],[435,0.357719,0.049602,1.798500],
  [440,0.383734,0.062077,1.967280],[445,0.386726,0.074704,2.027300],
  [450,0.370702,0.089456,1.994800],[455,0.342957,0.106256,1.900700],
  [460,0.302273,0.128201,1.745370],[465,0.254085,0.152761,1.554900],
  [470,0.195618,0.185190,1.317560],[475,0.132349,0.219940,1.030200],
  [480,0.080507,0.253589,0.772125],[485,0.041072,0.297665,0.570060],
  [490,0.016172,0.339133,0.415254],[495,0.005132,0.395379,0.302356],
  [500,0.003816,0.460777,0.218502],[505,0.015444,0.531360,0.159249],
  [510,0.037465,0.606741,0.112044],[515,0.071358,0.685660,0.082248],
  [520,0.117749,0.761757,0.060709],[525,0.172953,0.823330,0.043050],
  [530,0.236491,0.875211,0.030451],[535,0.304213,0.923810,0.020584],
  [540,0.376772,0.961988,0.013676],[545,0.451584,0.982200,0.007918],
  [550,0.529826,0.991761,0.003988],[555,0.616053,0.999110,0.001091],
  [560,0.705224,0.997340,0.000000],[565,0.793832,0.982380,0.000000],
  [570,0.878655,0.955552,0.000000],[575,0.951162,0.915175,0.000000],
  [580,1.014160,0.868934,0.000000],[585,1.074300,0.825623,0.000000],
  [590,1.118520,0.777405,0.000000],[595,1.134300,0.720353,0.000000],
  [600,1.123990,0.658341,0.000000],[605,1.089100,0.593878,0.000000],
  [610,1.030480,0.527963,0.000000],[615,0.950740,0.461834,0.000000],
  [620,0.856297,0.398057,0.000000],[625,0.754930,0.339554,0.000000],
  [630,0.647467,0.283493,0.000000],[635,0.535110,0.228254,0.000000],
  [640,0.431567,0.179828,0.000000],[645,0.343690,0.140211,0.000000],
  [650,0.268329,0.107633,0.000000],[655,0.204300,0.081187,0.000000],
  [660,0.152568,0.060281,0.000000],[665,0.112210,0.044096,0.000000],
  [670,0.081261,0.031800,0.000000],[675,0.057930,0.022602,0.000000],
  [680,0.040851,0.015905,0.000000],[685,0.028623,0.011130,0.000000],
  [690,0.019941,0.007749,0.000000],[695,0.013842,0.005375,0.000000],
  [700,0.009577,0.003718,0.000000],[705,0.006605,0.002565,0.000000],
  [710,0.004553,0.001768,0.000000],[715,0.003145,0.001222,0.000000],
  [720,0.002175,0.000846,0.000000],[725,0.001506,0.000586,0.000000],
  [730,0.001045,0.000407,0.000000],[735,0.000727,0.000284,0.000000],
  [740,0.000508,0.000199,0.000000],[745,0.000356,0.000140,0.000000],
  [750,0.000251,0.000098,0.000000],[755,0.000178,0.000070,0.000000],
  [760,0.000126,0.000050,0.000000],[765,0.000090,0.000036,0.000000],
  [770,0.000065,0.000025,0.000000],[775,0.000046,0.000018,0.000000],
  [780,0.000033,0.000013,0.000000],
];

// ── Standard illuminant D65 relative SPD — CIE 15:2004 Table T.1 ───────────────
const SPD_D65 = [
  [380,49.9755],[385,52.3118],[390,54.6482],[395,68.7015],[400,82.7549],
  [405,87.1204],[410,91.4860],[415,92.4589],[420,93.4318],[425,90.0570],
  [430,86.6823],[435,95.7736],[440,104.8650],[445,110.9360],[450,117.0080],
  [455,117.4100],[460,117.8120],[465,116.3360],[470,114.8610],[475,115.3920],
  [480,115.9230],[485,112.3670],[490,108.8110],[495,109.0820],[500,109.3540],
  [505,108.5780],[510,107.8020],[515,106.2960],[520,104.7900],[525,106.2390],
  [530,107.6890],[535,106.0470],[540,104.4050],[545,104.2250],[550,104.0460],
  [555,102.0230],[560,100.0000],[565,98.1671],[570,96.3342],[575,96.0611],
  [580,95.7880],[585,92.2368],[590,88.6856],[595,89.3459],[600,90.0062],
  [605,89.8026],[610,89.5991],[615,88.6489],[620,87.6987],[625,85.4936],
  [630,83.2886],[635,83.4939],[640,83.6992],[645,81.8630],[650,80.0268],
  [655,80.1207],[660,80.2146],[665,81.2462],[670,82.2778],[675,80.2810],
  [680,78.2842],[685,74.0027],[690,69.7213],[695,70.6652],[700,71.6091],
  [705,72.9790],[710,74.3490],[715,67.9765],[720,61.6040],[725,65.7448],
  [730,69.8856],[735,72.4863],[740,75.0870],[745,69.3398],[750,63.5927],
  [755,55.0054],[760,46.4182],[765,56.6118],[770,66.8054],[775,65.0941],
  [780,63.3828],
];

// ── Standard illuminant D50 relative SPD — CIE 15:2004 (ICC profile values) ────
const SPD_D50 = [
  [380,24.4880],[385,27.1790],[390,29.8710],[395,39.5890],[400,49.3080],
  [405,52.9100],[410,56.5130],[415,58.2730],[420,60.0340],[425,58.9260],
  [430,57.8180],[435,66.3210],[440,74.8250],[445,81.0360],[450,87.2470],
  [455,88.9300],[460,90.6120],[465,90.9900],[470,91.3680],[475,93.2380],
  [480,95.1090],[485,93.5360],[490,91.9630],[495,93.8430],[500,95.7240],
  [505,96.1690],[510,96.6130],[515,96.8710],[520,97.1290],[525,99.6140],
  [530,102.0990],[535,101.4270],[540,100.7550],[545,101.5360],[550,102.3170],
  [555,101.1590],[560,100.0000],[565,98.8680],[570,97.7350],[575,98.3270],
  [580,98.9180],[585,96.2080],[590,93.4990],[595,95.5930],[600,97.6880],
  [605,98.4780],[610,99.2690],[615,99.1550],[620,99.0420],[625,97.3820],
  [630,95.7220],[635,97.2900],[640,98.8570],[645,97.2620],[650,95.6670],
  [655,96.9290],[660,98.1900],[665,100.5970],[670,103.0030],[675,101.0680],
  [680,99.1330],[685,93.2570],[690,87.3810],[695,89.4920],[700,91.6040],
  [705,92.2460],[710,92.8890],[715,84.8720],[720,76.8540],[725,81.6830],
  [730,86.5110],[735,89.5460],[740,92.5800],[745,85.4050],[750,78.2300],
  [755,67.9610],[760,57.6920],[765,70.3070],[770,82.9230],[775,80.5990],
  [780,78.2740],
];

// Illuminant A — CIE Planckian formula (Tc ≈ 2856 K), exact, no table needed.
function spdA(lambda_nm) {
  const c2 = 1.435e7; // nm·K (CIE value)
  return 100 * Math.pow(560 / lambda_nm, 5) *
    (Math.exp(c2 / (2848 * 560)) - 1) / (Math.exp(c2 / (2848 * lambda_nm)) - 1);
}

// Blackbody relative SPD (Planck's law, c2 = 1.4388e7 nm·K) — for CCT/Duv locus.
function planck(lambda_nm, T) {
  const c2 = 1.4388e7;
  return Math.pow(lambda_nm, -5) / (Math.exp(c2 / (lambda_nm * T)) - 1);
}

export const OBSERVERS   = [{ id: '2',  label: 'CIE 1931 2°' },
                            { id: '10', label: 'CIE 1964 10°' }];
export const ILLUMINANTS  = [{ id: 'D65', label: 'D65 (daylight 6504 K)' },
                            { id: 'D50', label: 'D50 (daylight 5003 K)' },
                            { id: 'A',   label: 'A (incandescent 2856 K)' },
                            { id: 'E',   label: 'E (equal energy)' }];

function cmfTable(observer) { return observer === '10' ? CMF_10 : CMF_2; }

// Linear-interpolated table lookup (tables are monotone λ, 5 nm spacing).
function interp(table, lambda, col) {
  const lo = table[0][0], hi = table[table.length - 1][0];
  if (lambda <= lo) return table[0][col];
  if (lambda >= hi) return table[table.length - 1][col];
  const f = (lambda - lo) / 5;
  const i = Math.floor(f);
  const t = f - i;
  return table[i][col] * (1 - t) + table[i + 1][col] * t;
}

function illumValue(illuminant, lambda) {
  if (illuminant === 'E')   return 100;
  if (illuminant === 'A')   return spdA(lambda);
  if (illuminant === 'D50') return interp(SPD_D50, lambda, 1);
  return interp(SPD_D65, lambda, 1); // D65 default
}

/**
 * Public sampler for standard illuminants: D65, D50, A (Planckian Tc≈2856K), E.
 * Returns the *relative* SPD value (no normalization — only ratios matter when
 * used as a weighting). Tables defined on 380–780 nm @ 5 nm; A is analytic.
 * Out of range D65/D50: clamped to endpoints (use the CIE table edges).
 */
export function illuminantSPD(id, lambda_nm) {
  return illumValue(id, lambda_nm);
}

/**
 * Photopic V(λ) = ȳ-CMF of the CIE 1931 2° standard observer (CIE 15:2004
 * Table T.4 / CIE 1924). Linearly interpolated, clamped to [380, 780] nm
 * edges. Returns 0 outside the table.
 */
export function photopicV(lambda_nm) {
  if (lambda_nm < CMF_2[0][0] || lambda_nm > CMF_2[CMF_2.length - 1][0]) return 0;
  return interp(CMF_2, lambda_nm, 2);
}

export const PHOTOPIC_RANGE_NM = [CMF_2[0][0], CMF_2[CMF_2.length - 1][0]];
export const D65_RANGE_NM      = [SPD_D65[0][0], SPD_D65[SPD_D65.length - 1][0]];
export const D50_RANGE_NM      = [SPD_D50[0][0], SPD_D50[SPD_D50.length - 1][0]];

const RANGE_MIN = 380, RANGE_MAX = 780;

/**
 * Tristimulus X,Y,Z of a spectral response — Macleod Eqs. (12.1)–(12.3).
 *
 * @param {(lam:number)=>number} Rfn  response R(λ)|T(λ) as a *fraction* (0–1)
 * @param {string} observer    '2' | '10'
 * @param {string} illuminant  'D65' | 'D50' | 'A' | 'E'
 * @param {number} step        integration step (nm)
 * @returns {{X,Y,Z}}  with Y in percent (luminance factor)
 */
export function tristimulus(Rfn, observer, illuminant, step = 5) {
  const cmf = cmfTable(observer);
  let sumX = 0, sumY = 0, sumZ = 0, norm = 0;
  for (let lam = RANGE_MIN; lam <= RANGE_MAX + 1e-9; lam += step) {
    const S  = illumValue(illuminant, lam);
    const xb = interp(cmf, lam, 1);
    const yb = interp(cmf, lam, 2);
    const zb = interp(cmf, lam, 3);
    const Sy = S * yb;
    norm += Sy;
    const SR = S * Rfn(lam);
    sumX += SR * xb;
    sumY += SR * yb;
    sumZ += SR * zb;
  }
  if (norm <= 0) return { X: 0, Y: 0, Z: 0 };
  const k = 100 / norm;
  return { X: k * sumX, Y: k * sumY, Z: k * sumZ };
}

/** Reference-white XYZ for an illuminant/observer (R≡1). */
export function whitePoint(observer, illuminant, step = 5) {
  return tristimulus(() => 1, observer, illuminant, step);
}

export function chromaticityXy({ X, Y, Z }) {
  const s = X + Y + Z;
  if (s <= 0) return { x: 0, y: 0 };
  return { x: X / s, y: Y / s };
}

// CIE 1976 UCS u',v'  and  CIE 1960 UCS u,v  (v = 1.5·v').
export function uvPrime({ X, Y, Z }) {
  const d = X + 15 * Y + 3 * Z;
  if (d <= 0) return { up: 0, vp: 0 };
  return { up: 4 * X / d, vp: 9 * Y / d };
}
export function uv1960(XYZ) {
  const { up, vp } = uvPrime(XYZ);
  return { u: up, v: (2 / 3) * vp };
}

const f_lab = (t) => t > 0.008856451679 ? Math.cbrt(t) : (7.787037037 * t + 16 / 116);

/** CIE L*a*b* + C*ab, h°ab (CIE 15:2004 §8.2). White Yn = 100. */
export function lab(XYZ, white) {
  const fx = f_lab(XYZ.X / white.X);
  const fy = f_lab(XYZ.Y / white.Y);
  const fz = f_lab(XYZ.Z / white.Z);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  const C = Math.hypot(a, b);
  let h = Math.atan2(b, a) * 180 / Math.PI; if (h < 0) h += 360;
  return { L, a, b, C, h };
}

/** CIE L*u*v* + C*uv, h°uv, suv (CIE 15:2004 §8.2.1). */
export function luv(XYZ, white) {
  const yr = XYZ.Y / white.Y;
  const L = yr > 0.008856451679 ? 116 * Math.cbrt(yr) - 16 : 903.296296 * yr;
  const s  = uvPrime(XYZ), sw = uvPrime(white);
  const u = 13 * L * (s.up - sw.up);
  const v = 13 * L * (s.vp - sw.vp);
  const C = Math.hypot(u, v);
  let h = Math.atan2(v, u) * 180 / Math.PI; if (h < 0) h += 360;
  const suv = L > 0 ? C / L : 0;
  return { L, u, v, C, h, s: suv };
}

/** Hunter Lab (Hunter, *JOSA* 48, 985 (1958); CIE 15 Annex). */
export function hunterLab(XYZ, white) {
  const Ka = 175 / 198.04 * (white.X + white.Y);
  const Kb =  70 / 218.11 * (white.Y + white.Z);
  const xr = XYZ.X / white.X, yr = XYZ.Y / white.Y, zr = XYZ.Z / white.Z;
  const sy = Math.sqrt(Math.max(yr, 0));
  const L = 100 * sy;
  const a = sy > 0 ? Ka * (xr - yr) / sy : 0;
  const b = sy > 0 ? Kb * (yr - zr) / sy : 0;
  return { L, a, b };
}

// Spectrum locus (monochromatic-stimulus chromaticities) for the observer.
function spectrumLocus(observer) {
  const cmf = cmfTable(observer);
  return cmf.map(([lam, X, Y, Z]) => {
    const s = X + Y + Z;
    return { lam, x: s > 0 ? X / s : 0, y: s > 0 ? Y / s : 0 };
  });
}
export function spectralLocusXy(observer) { return spectrumLocus(observer); }

/**
 * Dominant/complementary wavelength + excitation purity — Macleod §12.2.
 * Ray from white point W through sample S; first intersection with the
 * spectrum-locus polyline gives the dominant λ (purity = |WS|/|W·locus|).
 * If the ray exits through the purple line, report the *complementary*
 * wavelength (opposite ray) and a negative-purity convention.
 */
// First crossing of the ray W + s·(vx,vy), s>0, with the spectrum-locus
// polyline `loc`. Returns the nearest hit { lam, s, dist } (dist = |W→hit|) or
// null if the ray misses every segment.
function _locusRayHit(loc, wx, wy, vx, vy) {
  let best = null;
  for (let i = 0; i < loc.length - 1; i++) {
    const ax = loc[i].x,   ay = loc[i].y;
    const bx = loc[i + 1].x, by = loc[i + 1].y;
    const ex = bx - ax, ey = by - ay;
    const den = vx * ey - vy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const s = ((ax - wx) * ey - (ay - wy) * ex) / den;
    const u = ((ax - wx) * vy - (ay - wy) * vx) / -den;
    if (s > 1e-9 && u >= -1e-6 && u <= 1 + 1e-6) {
      const lam = loc[i].lam + u * (loc[i + 1].lam - loc[i].lam);
      const px = wx + s * vx, py = wy + s * vy;
      const cand = { lam, s, dist: Math.hypot(px - wx, py - wy) };
      if (!best || s < best.s) best = cand;
    }
  }
  return best;
}

export function dominantWavelength(xy, white, observer) {
  const loc = spectrumLocus(observer);
  const wx = white.x, wy = white.y;
  const dx = xy.x - wx, dy = xy.y - wy;
  const sampleDist = Math.hypot(dx, dy);
  if (sampleDist < 1e-9) return { dom: null, comp: null, purity: 0 };

  const fwd = _locusRayHit(loc, wx, wy, dx, dy);
  if (fwd) {
    return { dom: fwd.lam, comp: null,
             purity: fwd.dist > 0 ? sampleDist / fwd.dist : 0 };
  }
  // Ray hit the purple line → use complementary (opposite direction).
  const bwd = _locusRayHit(loc, wx, wy, -dx, -dy);
  if (bwd) {
    return { dom: null, comp: bwd.lam,
             purity: bwd.dist > 0 ? sampleDist / bwd.dist : 0 };
  }
  return { dom: null, comp: null, purity: 0 };
}

/**
 * Correlated colour temperature (McCamy 1992 cubic) + Duv.
 * Duv = signed distance from the sample to the Planckian locus in CIE 1960
 * (u,v) (positive above the locus).
 */
export function correlatedColorTemperature(xy, observer) {
  // McCamy 1992: n = (x − xe)/(y − ye), epicenter (0.3320, 0.1858). The formula
  // is singular at the epicenter; guard the division so y=0.1858 can't emit
  // ±Infinity/NaN that would then break the Duv search loop below.
  const denom = xy.y - 0.1858;
  if (!(Math.abs(denom) > 1e-6)) return { cct: NaN, duv: NaN, locusT: NaN };
  const n = (xy.x - 0.3320) / denom;
  const cct = -449 * n * n * n + 3525 * n * n - 6823.3 * n + 5520.33;
  // Outside the McCamy-valid range CCT is meaningless; report N/A.
  if (!Number.isFinite(cct) || cct < 1000 || cct > 1e6) {
    return { cct: NaN, duv: NaN, locusT: NaN };
  }
  // Duv: nearest blackbody on the locus near the McCamy estimate.
  const uvOf = (T) => {
    let X = 0, Y = 0, Z = 0;
    const cmf = cmfTable(observer);
    for (const [lam, xb, yb, zb] of cmf) {
      const P = planck(lam, T); X += P * xb; Y += P * yb; Z += P * zb;
    }
    return uv1960({ X, Y, Z });
  };
  const sample = uv1960(xyToXYZ(xy));
  let bestT = cct, bestD = Infinity;
  for (let T = Math.max(1000, cct - 400); T <= cct + 400; T += 5) {
    const p = uvOf(T);
    const d = Math.hypot(p.u - sample.u, p.v - sample.v);
    if (d < bestD) { bestD = d; bestT = T; }
  }
  const pl = uvOf(bestT);
  const duv = (sample.v > pl.v ? 1 : -1) * bestD;
  // McCamy CCT is only meaningful near the Planckian locus. Beyond |Duv| ~ 0.05
  // (where the ±400 K search also tends to rail at its window edge) the colour
  // is too far off-locus for a correlated temperature — report N/A for cct but
  // still return the measured Duv.
  if (Math.abs(duv) > 0.05) return { cct: NaN, duv, locusT: bestT };
  return { cct, duv, locusT: bestT };
}

function xyToXYZ(xy, Y = 1) {
  if (xy.y <= 0) return { X: 0, Y: 0, Z: 0 };
  return { X: xy.x * Y / xy.y, Y, Z: (1 - xy.x - xy.y) * Y / xy.y };
}

// CIEDE2000 hue angle h'(b,a) in degrees [0,360); 0 when both components are 0.
const _hueP = (b, a) => {
  if (b === 0 && a === 0) return 0;
  const v = Math.atan2(b, a) * 180 / Math.PI;
  return v < 0 ? v + 360 : v;
};

// CIEDE2000 hue difference Δh' (Sharma, Wu & Dalal 2005, Eq. 10).
function _deltaHueP(C1p, C2p, h1p, h2p) {
  if (C1p * C2p === 0) return 0;
  let dhp = h2p - h1p;
  if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  return dhp;
}

// CIEDE2000 mean hue h̄' (Sharma, Wu & Dalal 2005, Eq. 14).
function _meanHueP(C1p, C2p, h1p, h2p) {
  if (C1p * C2p === 0) return h1p + h2p;
  if (Math.abs(h1p - h2p) <= 180) return (h1p + h2p) / 2;
  return (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
}

/**
 * CIEDE2000 colour difference (Sharma, Wu & Dalal 2005). kL=kC=kH=1.
 */
export function ciede2000(l1, l2) {
  const { L: L1, a: a1, b: b1 } = l1;
  const { L: L2, a: a2, b: b2 } = l2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = _hueP(b1, a1p), h2p = _hueP(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dhp = _deltaHueP(C1p, C2p, h1p, h2p);
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  const hbp = _meanHueP(C1p, C2p, h1p, h2p);
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
              + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Cbp7 = Math.pow(Cbp, 7);
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2)
    + Rt * (dCp / Sc) * (dHp / Sh));
}

// Bradford chromatic-adaptation matrix product (von Kries in LMS).
const M_BFD     = [[ 0.8951, 0.2664,-0.1614],
                   [-0.7502, 1.7135, 0.0367],
                   [ 0.0389,-0.0685, 1.0296]];
const M_BFD_INV = [[ 0.9869929,-0.1470543, 0.1599627],
                   [ 0.4323053, 0.5183603, 0.0492912],
                   [-0.0085287, 0.0400428, 0.9684867]];
const M_XYZ_RGB = [[ 3.2406255,-1.5372080,-0.4986286],
                   [-0.9689307, 1.8757561, 0.0415175],
                   [ 0.0557101,-0.2040211, 1.0569959]]; // sRGB, D65

function mul3(M, v) {
  return [M[0][0]*v[0]+M[0][1]*v[1]+M[0][2]*v[2],
          M[1][0]*v[0]+M[1][1]*v[1]+M[1][2]*v[2],
          M[2][0]*v[0]+M[2][1]*v[1]+M[2][2]*v[2]];
}

/**
 * sRGB swatch for the sample, Bradford-adapted from the source illuminant
 * white to D65 so the patch shows the perceived colour under that source.
 * Returns 'rgb(r,g,b)' (clamped, gamut-projected by clipping).
 */
export function xyzToSRGB(XYZ, white) {
  // Normalise so white maps to Y=1; adapt source-white → D65.
  const src = [XYZ.X / 100, XYZ.Y / 100, XYZ.Z / 100];
  const wS  = [white.X / 100, white.Y / 100, white.Z / 100];
  const wD  = [0.95047, 1.0, 1.08883]; // D65 reference white
  const lmsS = mul3(M_BFD, wS), lmsD = mul3(M_BFD, wD);
  const lms  = mul3(M_BFD, src);
  const adapted = mul3(M_BFD_INV,
    [lms[0]*lmsD[0]/lmsS[0], lms[1]*lmsD[1]/lmsS[1], lms[2]*lmsD[2]/lmsS[2]]);
  let rgb = mul3(M_XYZ_RGB, adapted);
  rgb = rgb.map(v => {
    v = Math.max(0, Math.min(1, v));
    v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, v)) * 255);
  });
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * Full colour report for one spectral response.
 * @param {(lam:number)=>number} Rfn  R|T as a fraction (0–1)
 */
export function colorReport(Rfn, { observer = '2', illuminant = 'D65', step = 5 } = {}) {
  const XYZ   = tristimulus(Rfn, observer, illuminant, step);
  const white = whitePoint(observer, illuminant, step);
  const xy    = chromaticityXy(XYZ);
  const wxy   = chromaticityXy(white);
  return {
    XYZ, xy,
    white, whiteXy: wxy,
    Lab:   lab(XYZ, white),
    Luv:   luv(XYZ, white),
    Hunter: hunterLab(XYZ, white),
    uvP:   uvPrime(XYZ),
    uv60:  uv1960(XYZ),
    dom:   dominantWavelength(xy, wxy, observer),
    cct:   correlatedColorTemperature(xy, observer),
    rgb:   xyzToSRGB(XYZ, white),
  };
}
