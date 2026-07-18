/**
 * CIE standard-observer / illuminant tables and the shared linear-interpolation
 * lookup used to sample them. See ../colorimetry.js for the full physics
 * provenance of every table and formula.
 *
 * Each table is 380–780 nm @ 5 nm. To avoid duplicating the row-tuple literal
 * structure between the two colour-matching functions (and again between the
 * two daylight illuminants), the published data is stored as one comma-
 * separated run of per-row values per table — parsed by `parseFlat()` and
 * reassembled into [λ, …cols] rows by `chunkTable()`.
 */

// Parse a comma-separated run of numbers into a flat array.
function parseFlat(csv) { return csv.split(',').map(Number); }

// Reassemble a flat run of per-row values into [λ, …cols] rows, λ starting at
// `startNm` and advancing `stepNm` per row. `width` is the column count per
// row (3 for x̄,ȳ,z̄ colour-matching functions; 1 for a scalar SPD).
function chunkTable(flat, width, startNm = 380, stepNm = 5) {
  const rows = [];
  for (let i = 0; i < flat.length; i += width) {
    rows.push([startNm + (i / width) * stepNm, ...flat.slice(i, i + width)]);
  }
  return rows;
}

// ── CIE 1931 2° standard observer  (λ nm, x̄, ȳ, z̄) — CIE 15:2004 ─────────────
const CMF_2 = chunkTable(parseFlat(`
0.001368,0.000039,0.00645,0.002236,0.000064,0.01055,0.004243,0.00012,0.02005,
0.00765,0.000217,0.03621,0.01431,0.000396,0.06785,0.02319,0.00064,0.1102,
0.04351,0.00121,0.2074,0.07763,0.00218,0.3713,0.13438,0.004,0.6456,
0.21477,0.0073,1.03905,0.2839,0.0116,1.3856,0.3285,0.01684,1.62296,
0.34828,0.023,1.74706,0.34806,0.0298,1.7826,0.3362,0.038,1.77211,
0.3187,0.048,1.7441,0.2908,0.06,1.6692,0.2511,0.0739,1.5281,
0.19536,0.09098,1.28764,0.1421,0.1126,1.0419,0.09564,0.13902,0.81295,
0.05795,0.1693,0.6162,0.03201,0.20802,0.46518,0.0147,0.2586,0.3533,
0.0049,0.323,0.272,0.0024,0.4073,0.2123,0.0093,0.503,0.1582,
0.0291,0.6082,0.1117,0.06327,0.71,0.07825,0.1096,0.7932,0.05725,
0.1655,0.862,0.04216,0.22575,0.91485,0.02984,0.2904,0.954,0.0203,
0.3597,0.9803,0.0134,0.43345,0.99495,0.00875,0.51205,1,0.00575,
0.5945,0.995,0.0039,0.6784,0.9786,0.00275,0.7621,0.952,0.0021,
0.8425,0.9154,0.0018,0.9163,0.87,0.00165,0.9786,0.8163,0.0014,
1.0263,0.757,0.0011,1.0567,0.6949,0.001,1.0622,0.631,0.0008,
1.0456,0.5668,0.0006,1.0026,0.503,0.00034,0.9384,0.4412,0.00024,
0.85445,0.381,0.00019,0.7514,0.321,0.0001,0.6424,0.265,0.00005,
0.5419,0.217,0.00003,0.4479,0.175,0.00002,0.3608,0.1382,0.00001,
0.2835,0.107,0,0.2187,0.0816,0,0.1649,0.061,0,
0.1212,0.04458,0,0.0874,0.032,0,0.0636,0.0232,0,
0.04677,0.017,0,0.0329,0.01192,0,0.0227,0.00821,0,
0.01584,0.005723,0,0.011359,0.004102,0,0.008111,0.002929,0,
0.00579,0.002091,0,0.004109,0.001484,0,0.002899,0.001047,0,
0.002049,0.00074,0,0.00144,0.00052,0,0.001,0.000361,0,
0.00069,0.000249,0,0.000476,0.000172,0,0.000332,0.00012,0,
0.000235,0.000085,0,0.000166,0.00006,0,0.000117,0.000042,0,
0.000083,0.00003,0,0.000059,0.000021,0,0.000042,0.000015,0
`), 3);

// ── CIE 1964 10° supplementary observer  (λ nm, x̄₁₀, ȳ₁₀, z̄₁₀) — CIE 15:2004 ─
const CMF_10 = chunkTable(parseFlat(`
0.00016,0.000017,0.000705,0.000662,0.000072,0.002928,0.002362,0.000253,0.010482,
0.007242,0.000769,0.032344,0.01911,0.002004,0.086011,0.0434,0.004509,0.19712,
0.084736,0.008756,0.389366,0.140638,0.014456,0.65676,0.204492,0.021391,0.972542,
0.264737,0.029497,1.2825,0.314679,0.038676,1.55348,0.357719,0.049602,1.7985,
0.383734,0.062077,1.96728,0.386726,0.074704,2.0273,0.370702,0.089456,1.9948,
0.342957,0.106256,1.9007,0.302273,0.128201,1.74537,0.254085,0.152761,1.5549,
0.195618,0.18519,1.31756,0.132349,0.21994,1.0302,0.080507,0.253589,0.772125,
0.041072,0.297665,0.57006,0.016172,0.339133,0.415254,0.005132,0.395379,0.302356,
0.003816,0.460777,0.218502,0.015444,0.53136,0.159249,0.037465,0.606741,0.112044,
0.071358,0.68566,0.082248,0.117749,0.761757,0.060709,0.172953,0.82333,0.04305,
0.236491,0.875211,0.030451,0.304213,0.92381,0.020584,0.376772,0.961988,0.013676,
0.451584,0.9822,0.007918,0.529826,0.991761,0.003988,0.616053,0.99911,0.001091,
0.705224,0.99734,0,0.793832,0.98238,0,0.878655,0.955552,0,
0.951162,0.915175,0,1.01416,0.868934,0,1.0743,0.825623,0,
1.11852,0.777405,0,1.1343,0.720353,0,1.12399,0.658341,0,
1.0891,0.593878,0,1.03048,0.527963,0,0.95074,0.461834,0,
0.856297,0.398057,0,0.75493,0.339554,0,0.647467,0.283493,0,
0.53511,0.228254,0,0.431567,0.179828,0,0.34369,0.140211,0,
0.268329,0.107633,0,0.2043,0.081187,0,0.152568,0.060281,0,
0.11221,0.044096,0,0.081261,0.0318,0,0.05793,0.022602,0,
0.040851,0.015905,0,0.028623,0.01113,0,0.019941,0.007749,0,
0.013842,0.005375,0,0.009577,0.003718,0,0.006605,0.002565,0,
0.004553,0.001768,0,0.003145,0.001222,0,0.002175,0.000846,0,
0.001506,0.000586,0,0.001045,0.000407,0,0.000727,0.000284,0,
0.000508,0.000199,0,0.000356,0.00014,0,0.000251,0.000098,0,
0.000178,0.00007,0,0.000126,0.00005,0,0.00009,0.000036,0,
0.000065,0.000025,0,0.000046,0.000018,0,0.000033,0.000013,0
`), 3);

// ── Standard illuminant D65 relative SPD — CIE 15:2004 Table T.1 ───────────────
const SPD_D65 = chunkTable(parseFlat(`
49.9755,52.3118,54.6482,68.7015,82.7549,87.1204,91.486,92.4589,93.4318,90.057,
86.6823,95.7736,104.865,110.936,117.008,117.41,117.812,116.336,114.861,115.392,
115.923,112.367,108.811,109.082,109.354,108.578,107.802,106.296,104.79,106.239,
107.689,106.047,104.405,104.225,104.046,102.023,100,98.1671,96.3342,96.0611,
95.788,92.2368,88.6856,89.3459,90.0062,89.8026,89.5991,88.6489,87.6987,85.4936,
83.2886,83.4939,83.6992,81.863,80.0268,80.1207,80.2146,81.2462,82.2778,80.281,
78.2842,74.0027,69.7213,70.6652,71.6091,72.979,74.349,67.9765,61.604,65.7448,
69.8856,72.4863,75.087,69.3398,63.5927,55.0054,46.4182,56.6118,66.8054,65.0941,
63.3828
`), 1);

// ── Standard illuminant D50 relative SPD — CIE 15:2004 (ICC profile values) ────
const SPD_D50 = chunkTable(parseFlat(`
24.488,27.179,29.871,39.589,49.308,52.91,56.513,58.273,60.034,58.926,
57.818,66.321,74.825,81.036,87.247,88.93,90.612,90.99,91.368,93.238,
95.109,93.536,91.963,93.843,95.724,96.169,96.613,96.871,97.129,99.614,
102.099,101.427,100.755,101.536,102.317,101.159,100,98.868,97.735,98.327,
98.918,96.208,93.499,95.593,97.688,98.478,99.269,99.155,99.042,97.382,
95.722,97.29,98.857,97.262,95.667,96.929,98.19,100.597,103.003,101.068,
99.133,93.257,87.381,89.492,91.604,92.246,92.889,84.872,76.854,81.683,
86.511,89.546,92.58,85.405,78.23,67.961,57.692,70.307,82.923,80.599,
78.274
`), 1);

// Illuminant A — CIE Planckian formula (Tc ≈ 2856 K), exact, no table needed.
function spdA(lambda_nm) {
  const c2 = 1.435e7; // nm·K (CIE value)
  return 100 * Math.pow(560 / lambda_nm, 5) *
    (Math.exp(c2 / (2848 * 560)) - 1) / (Math.exp(c2 / (2848 * lambda_nm)) - 1);
}

// Blackbody relative SPD (Planck's law, c2 = 1.4388e7 nm·K) — for CCT/Duv locus.
export function planck(lambda_nm, T) {
  const c2 = 1.4388e7;
  return Math.pow(lambda_nm, -5) / (Math.exp(c2 / (lambda_nm * T)) - 1);
}

export const OBSERVERS   = [{ id: '2',  label: 'CIE 1931 2°' },
                            { id: '10', label: 'CIE 1964 10°' }];
export const ILLUMINANTS  = [{ id: 'D65', label: 'D65 (daylight 6504 K)' },
                            { id: 'D50', label: 'D50 (daylight 5003 K)' },
                            { id: 'A',   label: 'A (incandescent 2856 K)' },
                            { id: 'E',   label: 'E (equal energy)' }];

export function cmfTable(observer) { return observer === '10' ? CMF_10 : CMF_2; }

// Linear-interpolated table lookup (tables are monotone λ, 5 nm spacing).
export function interp(table, lambda, col) {
  const lo = table[0][0], hi = table[table.length - 1][0];
  if (lambda <= lo) return table[0][col];
  if (lambda >= hi) return table[table.length - 1][col];
  const f = (lambda - lo) / 5;
  const i = Math.floor(f);
  const t = f - i;
  return table[i][col] * (1 - t) + table[i + 1][col] * t;
}

export function illumValue(illuminant, lambda) {
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

export const RANGE_MIN = 380, RANGE_MAX = 780;
