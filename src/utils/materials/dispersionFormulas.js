/**
 * Every dispersion formula TFStudio evaluates, in three number ranges that never
 * meet: the Zemax AGF formulas 1 to 13, the open-ended series and the OptiLayer
 * family from 101, and the refractiveindex.info database's formulas from 201.
 * All formulas take (coeffs: number[], lambda_um: number) → n (real refractive index),
 * or NaN where the formula gives none. λ is always in micrometers. k is handled
 * separately via IT table data.
 *
 * Reference: Zemax OpticStudio Glass Catalog format specification
 */

// ── Helper ────────────────────────────────────────────────────────────────────

function c(coeffs, i) {
    return (coeffs && coeffs[i] != null) ? coeffs[i] : 0;
}

// Nothing is clamped. At a pole, where n² is 0 or negative, or where a form
// that gives n directly reaches 0 or below, the result is NaN: the material has
// no index there, and a calculation at that wavelength has no value either. A
// stand-in such as n = 1 would give a plausible spectrum for a layer that is
// not there.
const realIndex = n => (Number.isFinite(n) && n > 0 ? n : NaN);
const realIndexFromSquare = n2 => realIndex(Math.sqrt(n2));

// a/d. A term whose multiplier a is 0 adds nothing, rather than 0/0 at its own
// pole: a catalog pads unused coefficient pairs with zeros.
const poleTerm = (a, d) => (a ? a / d : 0);

// K·λ²/(λ² − L), a resonance at L µm².
const resonanceTerm = (k, l2, pole) => poleTerm(k * l2, l2 - pole);

// ── Formula evaluators ────────────────────────────────────────────────────────

/** 1 — Schott: n² = a0 + a1·λ² + a2·λ⁻² + a3·λ⁻⁴ + a4·λ⁻⁶ + a5·λ⁻⁸ */
function schott(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + c(coeffs,1)*l2
             + c(coeffs,2)/l2 + c(coeffs,3)/(l2*l2)
             + c(coeffs,4)/(l2*l2*l2) + c(coeffs,5)/(l2*l2*l2*l2);
    return realIndexFromSquare(n2);
}

/** 2 — Sellmeier 1: n²−1 = Σᵢ Kᵢλ²/(λ²−Lᵢ)  (i=1..3) */
function sellmeier1(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = 1 + resonanceTerm(c(coeffs,0), l2, c(coeffs,1))
                 + resonanceTerm(c(coeffs,2), l2, c(coeffs,3))
                 + resonanceTerm(c(coeffs,4), l2, c(coeffs,5));
    return realIndexFromSquare(n2);
}

/**
 * 3 — Herzberger: n = A + B·L + C·L² + D·λ² + E·λ⁴ + F·λ⁶  where L=1/(λ²−0.028).
 * Also the refractiveindex.info database's formula 7, catalog formula 207.
 */
function herzberger(coeffs, lum) {
    const l2 = lum * lum;
    const L = 1 / (l2 - 0.028);
    return realIndex(c(coeffs,0) + c(coeffs,1)*L + c(coeffs,2)*L*L
         + c(coeffs,3)*l2 + c(coeffs,4)*l2*l2 + c(coeffs,5)*l2*l2*l2);
}

/** 4 — Sellmeier 2: n²−1 = A + (B1·λ²)/(λ²−λ1²) + B2/(λ²−λ2²) */
function sellmeier2(coeffs, lum) {
    const l2 = lum * lum;
    const l1sq = c(coeffs,2)*c(coeffs,2);
    const l2sq = c(coeffs,4)*c(coeffs,4);
    const n2 = 1 + c(coeffs,0) + resonanceTerm(c(coeffs,1), l2, l1sq) + poleTerm(c(coeffs,3), l2 - l2sq);
    return realIndexFromSquare(n2);
}

/** 5 — Conrady: n = n0 + A/λ + B/λ^3.5 */
function conrady(coeffs, lum) {
    return realIndex(c(coeffs,0) + c(coeffs,1)/lum + c(coeffs,2)/Math.pow(lum, 3.5));
}

/** 6 — Sellmeier 3: n²−1 = Σᵢ Kᵢλ²/(λ²−Lᵢ)  (i=1..4) */
function sellmeier3(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = 1 + resonanceTerm(c(coeffs,0), l2, c(coeffs,1))
                 + resonanceTerm(c(coeffs,2), l2, c(coeffs,3))
                 + resonanceTerm(c(coeffs,4), l2, c(coeffs,5))
                 + resonanceTerm(c(coeffs,6), l2, c(coeffs,7));
    return realIndexFromSquare(n2);
}

/** 7 — Handbook of Optics 1: n² = A + B/(λ²−C) − D·λ² */
function handbookOfOptics1(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + poleTerm(c(coeffs,1), l2 - c(coeffs,2)) - c(coeffs,3)*l2;
    return realIndexFromSquare(n2);
}

/** 8 — Handbook of Optics 2: n² = A + (B·λ²)/(λ²−C) − D·λ² */
function handbookOfOptics2(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + resonanceTerm(c(coeffs,1), l2, c(coeffs,2)) - c(coeffs,3)*l2;
    return realIndexFromSquare(n2);
}

/** 9 — Sellmeier 4: n² = A + (B·λ²)/(λ²−C) + (D·λ²)/(λ²−E) */
function sellmeier4(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + resonanceTerm(c(coeffs,1), l2, c(coeffs,2))
                            + resonanceTerm(c(coeffs,3), l2, c(coeffs,4));
    return realIndexFromSquare(n2);
}

/** 10 — Extended: n² = a0 + a1λ² + a2λ⁻² + a3λ⁻⁴ + a4λ⁻⁶ + a5λ⁻⁸ + a6λ⁻¹⁰ + a7λ⁻¹² */
function extended(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + c(coeffs,1)*l2
             + c(coeffs,2)/l2 + c(coeffs,3)/(l2*l2)
             + c(coeffs,4)/(l2*l2*l2) + c(coeffs,5)/(l2*l2*l2*l2)
             + c(coeffs,6)/(l2*l2*l2*l2*l2) + c(coeffs,7)/(l2*l2*l2*l2*l2*l2);
    return realIndexFromSquare(n2);
}

/** 11 — Sellmeier 5: n²−1 = Σᵢ Kᵢλ²/(λ²−Lᵢ)  (i=1..5) */
function sellmeier5(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = 1 + resonanceTerm(c(coeffs,0), l2, c(coeffs,1))
                 + resonanceTerm(c(coeffs,2), l2, c(coeffs,3))
                 + resonanceTerm(c(coeffs,4), l2, c(coeffs,5))
                 + resonanceTerm(c(coeffs,6), l2, c(coeffs,7))
                 + resonanceTerm(c(coeffs,8), l2, c(coeffs,9));
    return realIndexFromSquare(n2);
}

/** 12 — Extended 2: n² = a0 + a1λ² + a2λ⁻² + a3λ⁻⁴ + a4λ⁻⁶ + a5λ⁻⁸ + a6λ⁴ + a7λ⁶ */
function extended2(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + c(coeffs,1)*l2
             + c(coeffs,2)/l2 + c(coeffs,3)/(l2*l2)
             + c(coeffs,4)/(l2*l2*l2) + c(coeffs,5)/(l2*l2*l2*l2)
             + c(coeffs,6)*l2*l2 + c(coeffs,7)*l2*l2*l2;
    return realIndexFromSquare(n2);
}

/** 13 — Extended 3: n² = a0 + a1λ² + a2λ⁴ + a3λ⁻² + a4λ⁻⁴ + a5λ⁻⁶ + a6λ⁻⁸ + a7λ⁻¹⁰ + a8λ⁻¹² */
function extended3(coeffs, lum) {
    const l2 = lum * lum;
    const n2 = c(coeffs,0) + c(coeffs,1)*l2 + c(coeffs,2)*l2*l2
             + c(coeffs,3)/l2 + c(coeffs,4)/(l2*l2)
             + c(coeffs,5)/(l2*l2*l2) + c(coeffs,6)/(l2*l2*l2*l2)
             + c(coeffs,7)/(l2*l2*l2*l2*l2) + c(coeffs,8)/(l2*l2*l2*l2*l2*l2);
    return realIndexFromSquare(n2);
}

// ── Open-ended series and the OptiLayer family (101+) ─────────────────────────
//
// A separate formula-number space from the Zemax AGF set above, so the two
// never collide. λ is in micrometers, exactly as for the Zemax evaluators.
// 101 and 102 are the general Sellmeier and Cauchy series: they take any number
// of terms, which is what OptiLayer, Essential Macleod and TFCalc formula
// materials import onto.
//
// CONFIRMED forms — reverse-engineered by exact numerical agreement (Δn < 1e-6)
// against the precomputed n-tables embedded in OptiLayer's own .lm/.sub files and
// cross-checked against the formula shown in the OptiLayer "Formula" material
// editor (docs/optilayer docs → edmat_formula.png):
//   • Cauchy series:       n = Σ Aᵢ λ⁻²ⁱ  (OptiLayer writes three terms)   (file nType 5)
//   • Sellmeier, general:  n² = A₀ + Σᵢ Bᵢλ²/(λ²−Cᵢ)  (Cᵢ in µm²)         (file nType 4)
//   • OptiLayer Schott:    n² = A₀ + A₁λ² + A₂/λ² + A₃/λ⁴ + A₄/λ⁶ + A₅/λ⁸ + A₆λ⁴
//                          a 7-coefficient extended Schott (NOTE the trailing
//                          A₆·λ⁴ term — required to reproduce e.g. H-ZK3.sub at
//                          2400 nm; omitting it gives Δn > 4)                (file nType 7)

/**
 * 102, Cauchy series: n = A₀ + A₁·λ⁻² + A₂·λ⁻⁴ + …
 * One coefficient per term, as many terms as the material carries.
 */
function cauchySeries(coeffs, lum) {
    const inverseSquared = 1 / (lum * lum);
    let n = 0, power = 1;
    for (let i = 0; i < (coeffs?.length || 0); i++) {
        n += c(coeffs, i) * power;
        power *= inverseSquared;
    }
    return realIndex(n);
}

/**
 * 101, Sellmeier, general: n² = A₀ + Σᵢ Bᵢλ²/(λ²−Cᵢ)
 * Coefficients: [A₀, B₁, C₁, B₂, C₂, …] — a leading constant followed by
 * (Bᵢ, Cᵢ) pairs. Cᵢ are already squared resonance wavelengths (µm²), so they
 * are NOT squared again here. Any number of pairs is supported.
 */
function olSellmeier(coeffs, lum) {
    const l2 = lum * lum;
    let n2 = c(coeffs, 0);
    for (let i = 1; i + 1 < coeffs.length; i += 2) {
        n2 += resonanceTerm(coeffs[i], l2, coeffs[i + 1]);
    }
    return realIndexFromSquare(n2);
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
    return realIndexFromSquare(n2);
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
    return realIndex(c(coeffs, 0) + poleTerm(c(coeffs, 1), c(coeffs, 2) - lum));
}

/** 105 — Hartmann-2 (1.2-exponent variant): n = A₀ + A₁/(A₂ − λ)^1.2
 *  (A₂ − λ)^1.2 has no real value past λ = A₂, so neither has n.
 *  UNCONFIRMED OptiLayer coefficient order. */
function olHartmann2(coeffs, lum) {
    return realIndex(c(coeffs, 0) + poleTerm(c(coeffs, 1), Math.pow(c(coeffs, 2) - lum, 1.2)));
}

/** 106 — Drude free-carrier dielectric: ε(λ) = ε∞ − A·λ² / (1 − i·λ/B);
 *  here returns the real index n = Re√ε of the simplified non-damped limit
 *  n² = A₀ − A₁·λ². Ashcroft & Mermin, Solid State Physics, ch. 1.
 *  UNCONFIRMED OptiLayer coefficient order — placeholder real part only. */
function olDrude(coeffs, lum) {
    return realIndexFromSquare(c(coeffs, 0) - c(coeffs, 1) * lum * lum);
}

/** Exponential extinction coefficient: k(λ) = B₁·exp(B₂·λ⁻¹ + B₃·λ)
 *  CONFIRMED form (OptiLayer material editor, edmat_formula.png) but its integer
 *  kType code is unconfirmed, so it is not auto-applied on import yet. */
export function olExtinctionExponential(coeffs, lum) {
    return c(coeffs, 0) * Math.exp(c(coeffs, 1) / lum + c(coeffs, 2) * lum);
}

// ── refractiveindex.info formulas (201+) ──────────────────────────────────────
//
// The nine forms of the refractiveindex.info database, as it defines them in
// database/doc/Dispersion formulas.pdf (RefractiveIndex.INFO, 2014-06-29). The
// database's formula N is 200 + N here. c[0], c[1], … are a page's C1, C2, …
// in order. A coefficient the page does not give reads as 0, as in the
// database's own evaluator (database/tools/nkexplorer.py), so a series that
// stops after a term's multiplier keeps that term with its partner at 0.

/** Offset of the refractiveindex.info range: the database's formula N is formula 200 + N. */
export const RII_FORMULA_OFFSET = 200;

// `start` plus a term of two coefficients from c[first] on, as far as the page goes.
function riiSeries(coeffs, first, start, term) {
    let sum = start;
    for (let i = first; i < (coeffs?.length ?? 0); i += 2) {
        if (coeffs[i]) sum += term(coeffs[i], c(coeffs, i + 1));
    }
    return sum;
}

/** 201, Sellmeier: n² − 1 = C1 + Σ Cᵢλ²/(λ² − Cᵢ₊₁²), resonances as wavelengths in µm. */
function riiSellmeier(coeffs, lum) {
    const l2 = lum * lum;
    return realIndexFromSquare(riiSeries(coeffs, 1, 1 + c(coeffs, 0), (b, r) => b * l2 / (l2 - r * r)));
}

/**
 * 202, Sellmeier-2: n² − 1 = C1 + Σ Cᵢλ²/(λ² − Cᵢ₊₁), resonances in µm².
 * C1 is the constant whatever the number of coefficients.
 */
function riiSellmeier2(coeffs, lum) {
    const l2 = lum * lum;
    return realIndexFromSquare(riiSeries(coeffs, 1, 1 + c(coeffs, 0), (b, r) => b * l2 / (l2 - r)));
}

/** 203, Polynomial: n² = C1 + Σ Cᵢλ^Cᵢ₊₁. */
function riiPolynomial(coeffs, lum) {
    return realIndexFromSquare(riiSeries(coeffs, 1, c(coeffs, 0), (a, e) => a * Math.pow(lum, e)));
}

/**
 * 204, RefractiveIndex.INFO:
 *   n² = C1 + C2λ^C3/(λ² − C4^C5) + C6λ^C7/(λ² − C8^C9) + Σ Cᵢλ^Cᵢ₊₁ from C10.
 * C4^C5 and C8^C9 are taken as written, sign included: C4 = −0.006 with C5 = 1
 * puts λ² + 0.006 in the denominator.
 */
function riiFormula4(coeffs, lum) {
    const l2 = lum * lum;
    const resonance = first => c(coeffs, first) * Math.pow(lum, c(coeffs, first + 1))
        / (l2 - Math.pow(c(coeffs, first + 2), c(coeffs, first + 3)));
    let n2 = c(coeffs, 0);
    if (c(coeffs, 1)) n2 += resonance(1);
    if (c(coeffs, 5)) n2 += resonance(5);
    return realIndexFromSquare(riiSeries(coeffs, 9, n2, (a, e) => a * Math.pow(lum, e)));
}

/** 205, Cauchy: n = C1 + Σ Cᵢλ^Cᵢ₊₁. */
function riiCauchy(coeffs, lum) {
    return realIndex(riiSeries(coeffs, 1, c(coeffs, 0), (a, e) => a * Math.pow(lum, e)));
}

/**
 * 206, Gases: n − 1 = C1 + Σ Cᵢ/(Cᵢ₊₁ − λ⁻²), Cᵢ₊₁ the squared resonance
 * wavenumbers in µm⁻². The liquid-crystal pages use the same form.
 */
function riiGases(coeffs, lum) {
    const sigma2 = 1 / (lum * lum);
    return realIndex(riiSeries(coeffs, 1, 1 + c(coeffs, 0), (b, s) => b / (s - sigma2)));
}

// 207, Herzberger, is Zemax formula 3 term for term; 0.028 µm² is part of the
// formula in both.

/**
 * 208, Retro: (n² − 1)/(n² + 2) = R, R = C1 + C2λ²/(λ² − C3) + C4λ², C3 in µm².
 * The left side is the Lorentz-Lorenz form (Macleod, Thin-Film Optical
 * Filters, 5th ed., eq. 15.9, with εr = n²), so n² = (1 + 2R)/(1 − R).
 */
function riiRetro(coeffs, lum) {
    const l2 = lum * lum;
    const r = c(coeffs, 0) + c(coeffs, 1) * l2 / (l2 - c(coeffs, 2)) + c(coeffs, 3) * l2;
    return realIndexFromSquare((1 + 2 * r) / (1 - r));
}

/** 209, Exotic: n² = C1 + C2/(λ² − C3) + C4(λ − C5)/((λ − C5)² + C6), C3 and C6 in µm², C5 in µm. */
function riiExotic(coeffs, lum) {
    const d = lum - c(coeffs, 4);
    return realIndexFromSquare(c(coeffs, 0) + c(coeffs, 1) / (lum * lum - c(coeffs, 2))
        + c(coeffs, 3) * d / (d * d + c(coeffs, 5)));
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

// The series and OptiLayer space (101+) and the refractiveindex.info space
// (201+), kept separate from Zemax 1–13.
const NUMBERED_FN = {
    101: olSellmeier,
    102: cauchySeries,
    103: olSchott,
    104: olHartmann,    // gated: not produced by the parser yet (code unconfirmed)
    105: olHartmann2,   // gated
    106: olDrude,       // gated
    201: riiSellmeier,
    202: riiSellmeier2,
    203: riiPolynomial,
    204: riiFormula4,
    205: riiCauchy,
    206: riiGases,
    207: herzberger,
    208: riiRetro,
    209: riiExotic,
};

function formulaEvaluator(formulaNum) {
    if (!Number.isInteger(formulaNum)) return null;
    return (formulaNum >= 100 ? NUMBERED_FN[formulaNum] : FORMULA_FN[formulaNum]) || null;
}

/** Whether `formulaNum` is one of the Zemax AGF formulas, 1 to 13. */
export function isZemaxFormula(formulaNum) {
    return Number.isInteger(formulaNum) && formulaNum >= 1 && formulaNum < FORMULA_FN.length;
}

/** Whether evalN has an evaluator for `formulaNum`. */
export function isSupportedFormula(formulaNum) {
    return formulaEvaluator(formulaNum) !== null;
}

/**
 * Evaluate refractive index n for a given dispersion formula number.
 * @param {number} formulaNum  Zemax 1–13, series and OptiLayer 101+, refractiveindex.info 201+
 * @param {number[]} coeffs    dispersion coefficients
 * @param {number} lambda_um   wavelength in micrometers
 * @returns {number} real refractive index n; NaN where the formula gives no
 *          real, positive n, and NaN for a formula number with no evaluator:
 *          the material's dispersion is unknown, and no stand-in value is
 *          given for it
 */
export function evalN(formulaNum, coeffs, lambda_um) {
    const fn = formulaEvaluator(formulaNum);
    return fn ? fn(coeffs, lambda_um) : NaN;
}

export { evalNJet } from './dispersionFormulaJet.js';

// ── LaTeX templates ───────────────────────────────────────────────────────────

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
function subscript(n) {
    return String(n).split('').map(d => SUBSCRIPT_DIGITS[+d]).join('');
}

/**
 * Coefficient labels for `count` coefficients of a formula. Fixed formulas
 * return their own list; an open-ended series extends it as far as needed.
 */
export function coefficientNames(formulaNum, count) {
    const info = FORMULA_LATEX[formulaNum];
    if (!info) return Array.from({ length: count }, (_, i) => `c${i}`);
    const names = info.coeffNames.slice(0, Math.max(count, info.termSize ? info.coeffNames.length : count));
    for (let i = names.length; i < count; i++) names.push(info.extraName ? info.extraName(i) : `c${i}`);
    return names;
}

// LaTeX of the refractiveindex.info range. C(i) is a page's i-th coefficient,
// counted from 1 as the database counts them.
const C = i => `C_{${i}}`;
const L2 = '\\lambda^2';

// The terms of a series whose next term starts `size` coefficients after the
// last, from `first`, as far as `count` coefficients reach. A term is shown
// once its multiplier is given, as the evaluators count it.
function seriesTerms(count, first, size, term) {
    const terms = [];
    for (let i = first; i <= count; i += size) terms.push(term(i));
    return terms;
}

function equation(lhs, terms) {
    return `${lhs} = ${terms.length ? terms.join(' + ') : '0'}`;
}

const lead = count => (count >= 1 ? [C(1)] : []);
const power = i => `${C(i)}\\lambda^{${C(i + 1)}}`;

// C1, then a term of two coefficients from C2 on, as far as the material goes.
const riiSeriesLatex = (lhs, term) => count => equation(lhs, [...lead(count), ...seriesTerms(count, 2, 2, term)]);

const riiName = i => `C${subscript(i + 1)}`;

// A refractiveindex.info entry: the first `base` coefficients always shown,
// and for a series a term of two coefficients after them, as many as it has.
function riiEntry(name, base, latex, series = true) {
    return {
        name,
        latex,
        coeffNames: Array.from({ length: base }, (_, i) => riiName(i)),
        extraName: riiName,
        ...(series ? { termSize: 2 } : {}),
    };
}

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
    // ── Open-ended series and the OptiLayer family (101+) ──
    // `termSize` marks a series that takes any number of terms: coeffNames are
    // the terms always shown, `extraName(i)` names a coefficient beyond them.
    101: {
        name: 'Sellmeier (general)',
        template: 'n^2 = A_0 + \\sum_i \\dfrac{B_i\\lambda^2}{\\lambda^2 - C_i}',
        coeffNames: ['A₀','B₁','C₁','B₂','C₂','B₃','C₃'],
        termSize: 2,
        extraName: i => (i % 2 ? 'B' : 'C') + subscript(i % 2 ? (i + 1) / 2 : i / 2),
    },
    102: {
        name: 'Cauchy',
        template: 'n = A_0 + \\dfrac{A_1}{\\lambda^2} + \\dfrac{A_2}{\\lambda^4} + \\cdots',
        coeffNames: ['A₀','A₁','A₂'],
        termSize: 1,
        extraName: i => 'A' + subscript(i),
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
    // ── refractiveindex.info (201+), under the database's own names ──
    // `latex(count)` writes the formula out for a material's `count`
    // coefficients: a series shows the terms it has, a fixed form all of them.
    201: riiEntry('Sellmeier', 3, riiSeriesLatex('n^2 - 1', i => `\\dfrac{${C(i)}${L2}}{${L2} - ${C(i + 1)}^2}`)),
    202: riiEntry('Sellmeier-2', 3, riiSeriesLatex('n^2 - 1', i => `\\dfrac{${C(i)}${L2}}{${L2} - ${C(i + 1)}}`)),
    203: riiEntry('Polynomial', 3, riiSeriesLatex('n^2', power)),
    204: riiEntry('RefractiveIndex.INFO', 9, count => equation('n^2', [
        ...lead(count),
        ...seriesTerms(Math.min(count, 9), 2, 4, i => `\\dfrac{${C(i)}\\lambda^{${C(i + 1)}}}{${L2} - ${C(i + 2)}^{${C(i + 3)}}}`),
        ...seriesTerms(count, 10, 2, power),
    ])),
    205: riiEntry('Cauchy', 3, riiSeriesLatex('n', power)),
    206: riiEntry('Gases', 3, riiSeriesLatex('n - 1', i => `\\dfrac{${C(i)}}{${C(i + 1)} - \\lambda^{-2}}`)),
    207: riiEntry('Herzberger', 6, () => `n = ${C(1)} + \\dfrac{${C(2)}}{${L2} - 0.028} + ${C(3)}\\left(\\dfrac{1}{${L2} - 0.028}\\right)^2 + ${C(4)}${L2} + ${C(5)}\\lambda^4 + ${C(6)}\\lambda^6`, false),
    208: riiEntry('Retro', 4, () => `\\dfrac{n^2 - 1}{n^2 + 2} = ${C(1)} + \\dfrac{${C(2)}${L2}}{${L2} - ${C(3)}} + ${C(4)}${L2}`, false),
    209: riiEntry('Exotic', 6, () => `n^2 = ${C(1)} + \\dfrac{${C(2)}}{${L2} - ${C(3)}} + \\dfrac{${C(4)}(\\lambda - ${C(5)})}{(\\lambda - ${C(5)})^2 + ${C(6)}}`, false),
};

export const FORMULA_NAMES = Object.fromEntries(
    Object.entries(FORMULA_LATEX).map(([k, v]) => [Number(k), v.name])
);

/**
 * LaTeX for formula `formulaNum` written out for `count` coefficients: a
 * refractiveindex.info series shows the terms it has, every other formula its
 * fixed template. Null for a number with no entry.
 */
export function formulaLatex(formulaNum, count) {
    const info = FORMULA_LATEX[formulaNum];
    if (!info) return null;
    return info.latex ? info.latex(count) : info.template;
}

// Where each number range comes from, in the order the ranges run, and how far
// its numbers sit from the ones that source gives its formulas.
const FORMULA_SOURCES = [
    { source: 'zemax', from: 1, offset: 0 },
    { source: 'general', from: 101, offset: 0 },
    { source: 'rii', from: 201, offset: RII_FORMULA_OFFSET },
];

/**
 * Every formula with an entry, grouped by where it comes from, in the order the
 * Material Editor lists them: Zemax, the series and OptiLayer family, then
 * refractiveindex.info. `number` is the one the source itself gives the
 * formula, so database formula 1 is 1 under refractiveindex.info.
 * @returns {{ source: string, formulas: { formulaNum: number, number: number, name: string }[] }[]}
 */
export function formulasBySource() {
    const groups = FORMULA_SOURCES.map(({ source }) => ({ source, formulas: [] }));
    for (const [key, info] of Object.entries(FORMULA_LATEX)) {
        const formulaNum = Number(key);
        const index = FORMULA_SOURCES.findLastIndex(({ from }) => formulaNum >= from);
        groups[index].formulas.push({ formulaNum, number: formulaNum - FORMULA_SOURCES[index].offset, name: info.name });
    }
    return groups;
}
