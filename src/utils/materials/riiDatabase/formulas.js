/**
 * refractiveindex.info dispersion formula evaluators (formulas 1-5; 6-9 are
 * gases / Herzberger and are not supported — see evalFormulaN).
 */

const FORMULAS = { 1: _sellmeier1, 2: _sellmeier2, 3: _formula3, 4: _formula4, 5: _formula5 };

/** Evaluate n at lambda_nm from an RII parsed material. Returns null if not a formula type. */
export function evalFormulaN(mat, lambda_nm) {
    if (!mat.riiFormulaNum || !mat.formulaCoeffs) return null;
    const fn = FORMULAS[mat.riiFormulaNum];
    if (!fn) {
        throw new Error(
            `RII formula ${mat.riiFormulaNum} is not supported (formulas 6–9 are gases / ` +
            `Herzberger). Import refused to avoid silently returning n=1 vacuum.`
        );
    }
    return fn(mat.formulaCoeffs, lambda_nm / 1000);
}

// Formula 1 (Sellmeier-1): n²−1 = c[0] + Σ_{i=1,3,5,…} c[i]·λ²/(λ²−c[i+1]²)
// c[0] is the leading constant; resonances c[i+1] must be squared (λ₀, not λ₀²).
function _sellmeier1(c, lum) {
    const l2 = lum * lum;
    let n2 = 1 + (c[0] || 0);
    for (let i = 1; i + 1 < c.length; i += 2) {
        const res2 = c[i + 1] * c[i + 1];
        const d = l2 - res2;
        if (Math.abs(d) > 1e-15) n2 += c[i] * l2 / d;
    }
    return Math.sqrt(Math.max(n2, 1));
}

// Formula 2 (Sellmeier-2): n²-1 = A + Σ Bᵢλ²/(λ²-Cᵢ)
// Optional constant A when coefficient count is odd; Cᵢ are already λ₀² (NOT to be squared).
function _sellmeier2(c, lum) {
    const l2 = lum * lum;
    let n2 = 1;
    let start = 0;
    if (c.length % 2 === 1) { n2 += c[0]; start = 1; }
    for (let i = start; i + 1 < c.length; i += 2) {
        const d = l2 - c[i+1];
        if (Math.abs(d) > 1e-15) n2 += c[i] * l2 / d;
    }
    return Math.sqrt(Math.max(n2, 1));
}

// Formula 3 (Polynomial / Schott): n² = c[0] + c[1]·λ^c[2] + c[3]·λ^c[4] + ...
// refractiveindex.info coefficients: [A₀, A₁, e₁, A₂, e₂, ...]
function _formula3(c, lum) {
    let n2 = c[0] || 0;
    for (let i = 1; i + 1 < c.length; i += 2) {
        n2 += c[i] * Math.pow(lum, c[i+1]);
    }
    return Math.sqrt(Math.max(n2, 0.01));
}

// Formula 4 (RefractiveIndex.info):
//   n² = c[0]
//      + c[1]·λ^c[2]/(λ²−c[3]^c[4])   (1st resonance Sellmeier term)
//      + c[5]·λ^c[6]/(λ²−c[7]^c[8])   (2nd resonance Sellmeier term)
//      + c[9]·λ^c[10] + c[11]·λ^c[12] + …  (polynomial pairs from index 9)
// All exponents and bases are taken as given; resonances are raised to their
// respective exponent (c[4] and c[8]) before being subtracted from λ².
function _formula4(c, lum) {
    const l2 = lum * lum;
    let n2 = c[0] || 0;
    // Two Sellmeier-with-exponent terms (indices 1-8, in groups of 4)
    for (let g = 0; g < 2; g++) {
        const base = 1 + g * 4;   // 1, then 5
        if (base + 3 >= c.length) break;
        const A   = c[base],     eA  = c[base + 1];
        const res = c[base + 2], eR  = c[base + 3];
        const denom = l2 - Math.pow(Math.abs(res), eR);
        if (Math.abs(denom) > 1e-15) n2 += A * Math.pow(lum, eA) / denom;
    }
    // Polynomial pairs from index 9 onward: c[i]·λ^c[i+1]
    for (let i = 9; i + 1 < c.length; i += 2) {
        n2 += c[i] * Math.pow(lum, c[i + 1]);
    }
    return Math.sqrt(Math.max(n2, 0.01));
}

// Formula 5 (Cauchy): n = c[0] + c[1]·λ^c[2] + c[3]·λ^c[4] + ...
// Same coefficient format as Formula 3 but returns n directly (not n²).
function _formula5(c, lum) {
    let n = c[0] || 0;
    for (let i = 1; i + 1 < c.length; i += 2) {
        n += c[i] * Math.pow(lum, c[i+1]);
    }
    return Math.max(n, 1);
}
