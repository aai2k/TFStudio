/**
 * C2 regression — RII dispersion-formula evaluation (riiDatabase).
 *
 * Three bugs the browser silently imported around:
 *   • Formula 1 (Sellmeier-1) had an off-by-one in the coefficient pairing AND
 *     never squared the resonance wavelength, so Malitson SiO₂ imported as a
 *     flat n = 1.000 (the negative n² was masked by the max(n²,1) clamp).
 *   • Formula 4 was implemented as polynomial-then-Sellmeier instead of the
 *     RII spec (two λ^e Sellmeier terms, then polynomial pairs).
 *   • Formulas 6–9 (gases / Herzberger) were unsupported and fell through to
 *     n = 1 vacuum with NO error — a placeholder-physics / silent-failure bug.
 *
 * Oracles:
 *   • Formula 1 vs the canonical Malitson fused-silica Sellmeier (CRC / Malitson
 *     1965), evaluated at the Na-D line and a couple of IR points.
 *   • Formula 4 vs a hand-evaluated coefficient set that exercises the exact
 *     spec  n² = c₀ + c₁λ^c₂/(λ²−c₃^c₄) + c₅λ^c₆/(λ²−c₇^c₈) + c₉λ^c₁₀ + …
 *   • Formulas 6–9 must THROW (fail loudly), not return n = 1.
 *
 * Run: node tests/rii_formula_import.mjs
 */

import { evalFormulaN } from '../src/utils/materials/riiDatabase.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ✓', msg); } };
const near = (a, b, t, msg) => ok(Math.abs(a - b) <= t, `${msg} (got ${a}, want ${b}, Δ=${Math.abs(a - b).toExponential(2)})`);

// ── Formula 1 — Malitson fused silica ─────────────────────────────────────────
// n²−1 = Σ Bᵢλ²/(λ²−Cᵢ²), C in µm (must be squared).
{
    const sio2 = { riiFormulaNum: 1, formulaCoeffs:
        [0, 0.6961663, 0.0684043, 0.4079426, 0.1162414, 0.8974794, 9.896161] };
    // Closed-form Malitson reference, computed independently here.
    const malitson = (um) => {
        const l2 = um * um;
        const n2 = 1
            + 0.6961663 * l2 / (l2 - 0.0684043 ** 2)
            + 0.4079426 * l2 / (l2 - 0.1162414 ** 2)
            + 0.8974794 * l2 / (l2 - 9.896161  ** 2);
        return Math.sqrt(n2);
    };
    for (const lam_nm of [587.6, 1064, 1550]) {
        near(evalFormulaN(sio2, lam_nm), malitson(lam_nm / 1000), 1e-6,
            `SiO₂ Malitson formula-1 n @ ${lam_nm} nm`);
    }
    // Sanity: NOT the flat-vacuum value the bug produced.
    ok(evalFormulaN(sio2, 587.6) > 1.45, 'SiO₂ is NOT the buggy flat n=1.0');
}

// ── Formula 4 — exact spec via a hand-evaluated coefficient set ────────────────
{
    const c = [2.0, 0.5, 2, 0.04, 1, 0.3, 2, 0.01, 1, 0.001, 2];
    // At λ = 1 µm: n² = 2.0 + 0.5/(1−0.04) + 0.3/(1−0.01) + 0.001·1²
    const expect = Math.sqrt(2.0 + 0.5 / (1 - 0.04) + 0.3 / (1 - 0.01) + 0.001);
    near(evalFormulaN({ riiFormulaNum: 4, formulaCoeffs: c }, 1000), expect, 1e-9,
        'formula-4 matches the RII Sellmeier-with-exponent + polynomial spec');
}

// ── Formulas 6–9 — must fail loudly, never return n = 1 ───────────────────────
for (const f of [6, 7, 8, 9]) {
    let threw = false;
    try { evalFormulaN({ riiFormulaNum: f, formulaCoeffs: [1, 2, 3] }, 600); }
    catch (_) { threw = true; }
    ok(threw, `formula ${f} (gas/Herzberger) throws instead of importing n=1 vacuum`);
}

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll tests passed.');
