/**
 * Zemax AGF dispersion formula evaluators.
 * All formulas take (coeffs: number[], lambda_um: number) → n (real refractive index).
 * λ is always in micrometers. k is handled separately via IT table data.
 *
 * Reference: Zemax OpticStudio Glass Catalog format specification
 */

// ── Helper ────────────────────────────────────────────────────────────────────

function c(coeffs, i) {
    return (coeffs && coeffs[i] != null) ? coeffs[i] : 0;
}

// Guard a near-zero resonance denominator: floor |x| to ±POLE_EPS (sign-
// preserving) so an in-band pole (λ² ≈ a resonance Lᵢ) yields a large-but-FINITE
// index instead of Inf/NaN that would propagate into the TMM and corrupt every
// spectrum. Mirrors the existing guards on the OptiLayer-variant evaluators.
const POLE_EPS = 1e-12;
function den(x) { return Math.abs(x) >= POLE_EPS ? x : (x < 0 ? -POLE_EPS : POLE_EPS); }

// ── Formula evaluators ────────────────────────────────────────────────────────

/** 1 — Schott: n² = a0 + a1·λ² + a2·λ⁻² + a3·λ⁻⁴ + a4·λ⁻⁶ + a5·λ⁻⁸ */
function schott(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + c(coeffs,1)*l2
             + c(coeffs,2)/l2 + c(coeffs,3)/(l2*l2)
             + c(coeffs,4)/(l2*l2*l2) + c(coeffs,5)/(l2*l2*l2*l2);
    return Math.sqrt(Math.max(n2, 1));
}

/** 2 — Sellmeier 1: n²−1 = Σᵢ Kᵢλ²/(λ²−Lᵢ)  (i=1..3) */
function sellmeier1(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = 1 + c(coeffs,0)*l2/den(l2-c(coeffs,1))
                 + c(coeffs,2)*l2/den(l2-c(coeffs,3))
                 + c(coeffs,4)*l2/den(l2-c(coeffs,5));
    return Math.sqrt(Math.max(n2, 1));
}

/** 3 — Herzberger: n = A + B·L + C·L² + D·λ² + E·λ⁴ + F·λ⁶  where L=1/(λ²−0.028) */
function herzberger(coeffs, lum) {
    const l2 = lum * lum;
    const L = 1 / den(l2 - 0.028);
    return c(coeffs,0) + c(coeffs,1)*L + c(coeffs,2)*L*L
         + c(coeffs,3)*l2 + c(coeffs,4)*l2*l2 + c(coeffs,5)*l2*l2*l2;
}

/** 4 — Sellmeier 2: n²−1 = A + (B1·λ²)/(λ²−λ1²) + B2/(λ²−λ2²) */
function sellmeier2(coeffs, lum) {
    const l2 = lum * lum;
    const l1sq = c(coeffs,2)*c(coeffs,2);
    const l2sq = c(coeffs,4)*c(coeffs,4);
    const n2 = 1 + c(coeffs,0) + c(coeffs,1)*l2/den(l2-l1sq) + c(coeffs,3)/den(l2-l2sq);
    return Math.sqrt(Math.max(n2, 1));
}

/** 5 — Conrady: n = n0 + A/λ + B/λ^3.5 */
function conrady(coeffs, lum) {
    return c(coeffs,0) + c(coeffs,1)/lum + c(coeffs,2)/Math.pow(lum, 3.5);
}

/** 6 — Sellmeier 3: n²−1 = Σᵢ Kᵢλ²/(λ²−Lᵢ)  (i=1..4) */
function sellmeier3(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = 1 + c(coeffs,0)*l2/den(l2-c(coeffs,1))
                 + c(coeffs,2)*l2/den(l2-c(coeffs,3))
                 + c(coeffs,4)*l2/den(l2-c(coeffs,5))
                 + c(coeffs,6)*l2/den(l2-c(coeffs,7));
    return Math.sqrt(Math.max(n2, 1));
}

/** 7 — Handbook of Optics 1: n² = A + B/(λ²−C) − D·λ² */
function handbookOfOptics1(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + c(coeffs,1)/den(l2-c(coeffs,2)) - c(coeffs,3)*l2;
    return Math.sqrt(Math.max(n2, 1));
}

/** 8 — Handbook of Optics 2: n² = A + (B·λ²)/(λ²−C) − D·λ² */
function handbookOfOptics2(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + c(coeffs,1)*l2/den(l2-c(coeffs,2)) - c(coeffs,3)*l2;
    return Math.sqrt(Math.max(n2, 1));
}

/** 9 — Sellmeier 4: n² = A + (B·λ²)/(λ²−C) + (D·λ²)/(λ²−E) */
function sellmeier4(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + c(coeffs,1)*l2/den(l2-c(coeffs,2))
                            + c(coeffs,3)*l2/den(l2-c(coeffs,4));
    return Math.sqrt(Math.max(n2, 1));
}

/** 10 — Extended: n² = a0 + a1λ² + a2λ⁻² + a3λ⁻⁴ + a4λ⁻⁶ + a5λ⁻⁸ + a6λ⁻¹⁰ + a7λ⁻¹² */
function extended(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + c(coeffs,1)*l2
             + c(coeffs,2)/l2 + c(coeffs,3)/(l2*l2)
             + c(coeffs,4)/(l2*l2*l2) + c(coeffs,5)/(l2*l2*l2*l2)
             + c(coeffs,6)/(l2*l2*l2*l2*l2) + c(coeffs,7)/(l2*l2*l2*l2*l2*l2);
    return Math.sqrt(Math.max(n2, 1));
}

/** 11 — Sellmeier 5: n²−1 = Σᵢ Kᵢλ²/(λ²−Lᵢ)  (i=1..5) */
function sellmeier5(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = 1 + c(coeffs,0)*l2/den(l2-c(coeffs,1))
                 + c(coeffs,2)*l2/den(l2-c(coeffs,3))
                 + c(coeffs,4)*l2/den(l2-c(coeffs,5))
                 + c(coeffs,6)*l2/den(l2-c(coeffs,7))
                 + c(coeffs,8)*l2/den(l2-c(coeffs,9));
    return Math.sqrt(Math.max(n2, 1));
}

/** 12 — Extended 2: n² = a0 + a1λ² + a2λ⁻² + a3λ⁻⁴ + a4λ⁻⁶ + a5λ⁻⁸ + a6λ⁴ + a7λ⁶ */
function extended2(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + c(coeffs,1)*l2
             + c(coeffs,2)/l2 + c(coeffs,3)/(l2*l2)
             + c(coeffs,4)/(l2*l2*l2) + c(coeffs,5)/(l2*l2*l2*l2)
             + c(coeffs,6)*l2*l2 + c(coeffs,7)*l2*l2*l2;
    return Math.sqrt(Math.max(n2, 1));
}

/** 13 — Extended 3: n² = a0 + a1λ² + a2λ⁴ + a3λ⁻² + a4λ⁻⁴ + a5λ⁻⁶ + a6λ⁻⁸ + a7λ⁻¹⁰ + a8λ⁻¹² */
function extended3(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + c(coeffs,1)*l2 + c(coeffs,2)*l2*l2
             + c(coeffs,3)/l2 + c(coeffs,4)/(l2*l2)
             + c(coeffs,5)/(l2*l2*l2) + c(coeffs,6)/(l2*l2*l2*l2)
             + c(coeffs,7)/(l2*l2*l2*l2*l2) + c(coeffs,8)/(l2*l2*l2*l2*l2*l2);
    return Math.sqrt(Math.max(n2, 1));
}

// ── OptiLayer dispersion formulas ──────────────────────────────────────────────
//
// OptiLayer (.lm / .sub) uses its own dispersion-model family, distinct from the
// Zemax AGF set above. We give them a separate formula-number space (101+) so the
// two never collide. λ is in micrometers, exactly as for the Zemax evaluators.
//
// CONFIRMED forms — reverse-engineered by exact numerical agreement (Δn < 1e-6)
// against the precomputed n-tables embedded in OptiLayer's own .lm/.sub files and
// cross-checked against the formula shown in the OptiLayer "Formula" material
// editor (docs/optilayer docs → edmat_formula.png):
//   • OptiLayer Cauchy:    n = A₀ + A₁/λ² + A₂/λ⁴                    (file nType 5)
//   • OptiLayer Sellmeier: n² = A₀ + Σᵢ Bᵢλ²/(λ²−Cᵢ)  (Cᵢ in µm²)    (file nType 4)
//   • OptiLayer Schott:    n² = A₀ + A₁λ² + A₂/λ² + A₃/λ⁴ + A₄/λ⁶ + A₅/λ⁸ + A₆λ⁴
//                          a 7-coefficient extended Schott (NOTE the trailing
//                          A₆·λ⁴ term — required to reproduce e.g. H-ZK3.sub at
//                          2400 nm; omitting it gives Δn > 4)                (file nType 7)

/** 102 — OptiLayer Cauchy: n = A₀ + A₁·λ⁻² + A₂·λ⁻⁴ */
function olCauchy(coeffs, lum) {
    const l2 = lum * lum;
    return c(coeffs, 0) + c(coeffs, 1) / l2 + c(coeffs, 2) / (l2 * l2);
}

/**
 * 101 — OptiLayer Sellmeier: n² = A₀ + Σᵢ Bᵢλ²/(λ²−Cᵢ)
 * Coefficients: [A₀, B₁, C₁, B₂, C₂, …] — a leading constant followed by
 * (Bᵢ, Cᵢ) pairs. Cᵢ are already squared resonance wavelengths (µm²), so they
 * are NOT squared again here. Any number of pairs is supported.
 */
function olSellmeier(coeffs, lum) {
    const l2 = lum * lum;
    let n2 = c(coeffs, 0);
    for (let i = 1; i + 1 < coeffs.length; i += 2) {
        const d = l2 - coeffs[i + 1];
        if (Math.abs(d) > 1e-15) n2 += coeffs[i] * l2 / d;
    }
    return Math.sqrt(Math.max(n2, 1e-6));
}

/**
 * 103 — OptiLayer Schott (extended): n² = A₀ + A₁λ² + A₂/λ² + A₃/λ⁴ + A₄/λ⁶ + A₅/λ⁸ + A₆λ⁴
 * Same as the classical Schott series plus a trailing A₆·λ⁴ IR term. Confirmed
 * to reproduce OptiLayer's own sampled n-table to Δn < 1e-6 across the catalog.
 */
function olSchott(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs, 0) + c(coeffs, 1) * l2
             + c(coeffs, 2) / l2 + c(coeffs, 3) / (l2 * l2)
             + c(coeffs, 4) / (l2 * l2 * l2) + c(coeffs, 5) / (l2 * l2 * l2 * l2)
             + c(coeffs, 6) * l2 * l2;
    return Math.sqrt(Math.max(n2, 1e-6));
}

// ── OptiLayer forms NOT yet wired to an integer code ─────────────────────────────
//
// OptiLayer's documented index families also include Hartmann, Hartmann-2 and
// Drude, plus an Exponential extinction-coefficient model. None of these appear in
// the shipped .lm/.sub catalogs, so their integer nType/kType codes cannot be
// confirmed by numerical decoding (and OptiLayer does not publish the file format).
// The math below uses the classical / OptiLayer-documented forms with citations,
// but the importer deliberately does NOT route any file to them yet — an
// unrecognised nType falls back to the file's embedded sampled table instead
// (see optilayerParser.js). Wire these in once a sample file pins the code down.

/** 104 — Hartmann (classical): n = A₀ + A₁/(A₂ − λ)
 *  Hartmann, Astrophys. J. 8, 218 (1898). UNCONFIRMED OptiLayer coefficient order. */
function olHartmann(coeffs, lum) {
    const d = c(coeffs, 2) - lum;
    return c(coeffs, 0) + (Math.abs(d) > 1e-15 ? c(coeffs, 1) / d : 0);
}

/** 105 — Hartmann-2 (1.2-exponent variant): n = A₀ + A₁/(A₂ − λ)^1.2
 *  UNCONFIRMED OptiLayer coefficient order. */
function olHartmann2(coeffs, lum) {
    const d = c(coeffs, 2) - lum;
    return c(coeffs, 0) + (d > 1e-15 ? c(coeffs, 1) / Math.pow(d, 1.2) : 0);
}

/** 106 — Drude free-carrier dielectric: ε(λ) = ε∞ − A·λ² / (1 − i·λ/B);
 *  here returns the real index n = Re√ε of the simplified non-damped limit
 *  n² = A₀ − A₁·λ². Ashcroft & Mermin, Solid State Physics, ch. 1.
 *  UNCONFIRMED OptiLayer coefficient order — placeholder real part only. */
function olDrude(coeffs, lum) {
    const n2 = c(coeffs, 0) - c(coeffs, 1) * lum * lum;
    return Math.sqrt(Math.max(n2, 1e-6));
}

/** Exponential extinction coefficient: k(λ) = B₁·exp(B₂·λ⁻¹ + B₃·λ)
 *  CONFIRMED form (OptiLayer material editor, edmat_formula.png) but its integer
 *  kType code is unconfirmed, so it is not auto-applied on import yet. */
export function olExtinctionExponential(coeffs, lum) {
    return c(coeffs, 0) * Math.exp(c(coeffs, 1) / lum + c(coeffs, 2) * lum);
}

// ── Dispatch table ────────────────────────────────────────────────────────────

const FORMULA_FN = [
    null,            // 0 — unused
    schott,
    sellmeier1,
    herzberger,
    sellmeier2,
    conrady,
    sellmeier3,
    handbookOfOptics1,
    handbookOfOptics2,
    sellmeier4,
    extended,
    sellmeier5,
    extended2,
    extended3,
];

// OptiLayer formula-number space (101+), kept separate from Zemax 1–13.
const OPTILAYER_FN = {
    101: olSellmeier,
    102: olCauchy,
    103: olSchott,
    104: olHartmann,    // gated: not produced by the parser yet (code unconfirmed)
    105: olHartmann2,   // gated
    106: olDrude,       // gated
};

/**
 * Evaluate refractive index n for a given dispersion formula number.
 * @param {number} formulaNum  Zemax 1–13, or OptiLayer 101+
 * @param {number[]} coeffs    dispersion coefficients
 * @param {number} lambda_um   wavelength in micrometers
 * @returns {number} real refractive index n
 */
export function evalN(formulaNum, coeffs, lambda_um) {
    const fn = formulaNum >= 100 ? OPTILAYER_FN[formulaNum] : FORMULA_FN[formulaNum];
    if (!fn) {
        // Fail LOUD rather than silently substituting placeholder physics: an
        // unknown formula number means the material's dispersion is unmodelled.
        console.warn(`evalN: unsupported dispersion formula ${formulaNum} — ` +
            `returning placeholder n=1.5; this material's index is NOT physical.`);
        return 1.5;
    }
    return fn(coeffs, lambda_um);
}

// ── LaTeX templates ───────────────────────────────────────────────────────────

export const FORMULA_LATEX = {
    1: {
        name: 'Schott',
        template: 'n^2 = a_0 + a_1\\lambda^2 + \\dfrac{a_2}{\\lambda^2} + \\dfrac{a_3}{\\lambda^4} + \\dfrac{a_4}{\\lambda^6} + \\dfrac{a_5}{\\lambda^8}',
        coeffNames: ['a₀','a₁','a₂','a₃','a₄','a₅'],
    },
    2: {
        name: 'Sellmeier 1',
        template: 'n^2 - 1 = \\dfrac{K_1\\lambda^2}{\\lambda^2 - L_1} + \\dfrac{K_2\\lambda^2}{\\lambda^2 - L_2} + \\dfrac{K_3\\lambda^2}{\\lambda^2 - L_3}',
        coeffNames: ['K₁','L₁','K₂','L₂','K₃','L₃'],
    },
    3: {
        name: 'Herzberger',
        template: 'n = A + BL + CL^2 + D\\lambda^2 + E\\lambda^4 + F\\lambda^6,\\quad L = \\dfrac{1}{\\lambda^2 - 0.028}',
        coeffNames: ['A','B','C','D','E','F'],
    },
    4: {
        name: 'Sellmeier 2',
        template: 'n^2 - 1 = A + \\dfrac{B_1\\lambda^2}{\\lambda^2 - \\lambda_1^2} + \\dfrac{B_2}{\\lambda^2 - \\lambda_2^2}',
        coeffNames: ['A','B₁','λ₁','B₂','λ₂'],
    },
    5: {
        name: 'Conrady',
        template: 'n = n_0 + \\dfrac{A}{\\lambda} + \\dfrac{B}{\\lambda^{3.5}}',
        coeffNames: ['n₀','A','B'],
    },
    6: {
        name: 'Sellmeier 3',
        template: 'n^2 - 1 = \\dfrac{K_1\\lambda^2}{\\lambda^2 - L_1} + \\dfrac{K_2\\lambda^2}{\\lambda^2 - L_2} + \\dfrac{K_3\\lambda^2}{\\lambda^2 - L_3} + \\dfrac{K_4\\lambda^2}{\\lambda^2 - L_4}',
        coeffNames: ['K₁','L₁','K₂','L₂','K₃','L₃','K₄','L₄'],
    },
    7: {
        name: 'Handbook of Optics 1',
        template: 'n^2 = A + \\dfrac{B}{\\lambda^2 - C} - D\\lambda^2',
        coeffNames: ['A','B','C','D'],
    },
    8: {
        name: 'Handbook of Optics 2',
        template: 'n^2 = A + \\dfrac{B\\lambda^2}{\\lambda^2 - C} - D\\lambda^2',
        coeffNames: ['A','B','C','D'],
    },
    9: {
        name: 'Sellmeier 4',
        template: 'n^2 = A + \\dfrac{B\\lambda^2}{\\lambda^2 - C} + \\dfrac{D\\lambda^2}{\\lambda^2 - E}',
        coeffNames: ['A','B','C','D','E'],
    },
    10: {
        name: 'Extended',
        template: 'n^2 = a_0 + a_1\\lambda^2 + \\dfrac{a_2}{\\lambda^2} + \\dfrac{a_3}{\\lambda^4} + \\dfrac{a_4}{\\lambda^6} + \\dfrac{a_5}{\\lambda^8} + \\dfrac{a_6}{\\lambda^{10}} + \\dfrac{a_7}{\\lambda^{12}}',
        coeffNames: ['a₀','a₁','a₂','a₃','a₄','a₅','a₆','a₇'],
    },
    11: {
        name: 'Sellmeier 5',
        template: 'n^2 - 1 = \\sum_{i=1}^{5} \\dfrac{K_i\\lambda^2}{\\lambda^2 - L_i}',
        coeffNames: ['K₁','L₁','K₂','L₂','K₃','L₃','K₄','L₄','K₅','L₅'],
    },
    12: {
        name: 'Extended 2',
        template: 'n^2 = a_0 + a_1\\lambda^2 + \\dfrac{a_2}{\\lambda^2} + \\dfrac{a_3}{\\lambda^4} + \\dfrac{a_4}{\\lambda^6} + \\dfrac{a_5}{\\lambda^8} + a_6\\lambda^4 + a_7\\lambda^6',
        coeffNames: ['a₀','a₁','a₂','a₃','a₄','a₅','a₆','a₇'],
    },
    13: {
        name: 'Extended 3',
        template: 'n^2 = a_0 + a_1\\lambda^2 + a_2\\lambda^4 + \\dfrac{a_3}{\\lambda^2} + \\dfrac{a_4}{\\lambda^4} + \\dfrac{a_5}{\\lambda^6} + \\dfrac{a_6}{\\lambda^8} + \\dfrac{a_7}{\\lambda^{10}} + \\dfrac{a_8}{\\lambda^{12}}',
        coeffNames: ['a₀','a₁','a₂','a₃','a₄','a₅','a₆','a₇','a₈'],
    },
    // ── OptiLayer formula space (101+) ──
    101: {
        name: 'OptiLayer Sellmeier',
        template: 'n^2 = A_0 + \\sum_i \\dfrac{B_i\\lambda^2}{\\lambda^2 - C_i}',
        coeffNames: ['A₀','B₁','C₁','B₂','C₂','B₃','C₃'],
    },
    102: {
        name: 'OptiLayer Cauchy',
        template: 'n = A_0 + \\dfrac{A_1}{\\lambda^2} + \\dfrac{A_2}{\\lambda^4}',
        coeffNames: ['A₀','A₁','A₂'],
    },
    103: {
        name: 'OptiLayer Schott',
        template: 'n^2 = A_0 + A_1\\lambda^2 + \\dfrac{A_2}{\\lambda^2} + \\dfrac{A_3}{\\lambda^4} + \\dfrac{A_4}{\\lambda^6} + \\dfrac{A_5}{\\lambda^8} + A_6\\lambda^4',
        coeffNames: ['A₀','A₁','A₂','A₃','A₄','A₅','A₆'],
    },
    104: {
        name: 'OptiLayer Hartmann',
        template: 'n = A_0 + \\dfrac{A_1}{A_2 - \\lambda}',
        coeffNames: ['A₀','A₁','A₂'],
    },
    105: {
        name: 'OptiLayer Hartmann-2',
        template: 'n = A_0 + \\dfrac{A_1}{(A_2 - \\lambda)^{1.2}}',
        coeffNames: ['A₀','A₁','A₂'],
    },
    106: {
        name: 'OptiLayer Drude',
        template: 'n^2 = A_0 - A_1\\lambda^2',
        coeffNames: ['A₀','A₁'],
    },
};

export const FORMULA_NAMES = Object.fromEntries(
    Object.entries(FORMULA_LATEX).map(([k, v]) => [Number(k), v.name])
);
