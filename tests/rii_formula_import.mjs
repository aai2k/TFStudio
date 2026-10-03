/**
 * C2 regression — RII dispersion-formula evaluation (riiDatabase).
 *
 * Three bugs the browser silently imported around:
 *   • Formula 1 (Sellmeier-1) had an off-by-one in the coefficient pairing AND
 *     never squared the resonance wavelength, so Malitson SiO₂ imported as a
 *     flat n = 1.000 (the negative n² was masked by the max(n²,1) clamp).
 *   • Formula 4 was implemented as polynomial-then-Sellmeier instead of the
 *     RII spec (two λ^e Sellmeier terms, then polynomial pairs).
 *   • Formulas 6 to 9 (Gases, Herzberger, Retro, Exotic) were unsupported and
 *     fell through to n = 1 vacuum with no error. They then threw instead, and
 *     the throw took down the Material Editor whenever a page using one of them
 *     was selected. They are now evaluated as the database defines them.
 *   • Formula 2 dropped its constant C1 when a page gave an even number of
 *     coefficients, formula 4 took |C4| before raising it to C5, and formulas 1
 *     to 5 clamped n, so a pole inside a page's range stored n = 1 or n = 0.1.
 *
 * Oracles:
 *   • Formula 1 vs the canonical Malitson fused-silica Sellmeier (CRC / Malitson
 *     1965), evaluated at the Na-D line and a couple of IR points.
 *   • Formula 4 vs a hand-evaluated coefficient set that exercises the exact
 *     spec  n² = c₀ + c₁λ^c₂/(λ²−c₃^c₄) + c₅λ^c₆/(λ²−c₇^c₈) + c₉λ^c₁₀ + …
 *   • Formulas 6 to 9 vs one value per formula from the page's source paper,
 *     or refractiveindex.info's own value where no paper value could be reached.
 *   • Formulas 2 and 4 and the CS2 pole vs the expressions written out here.
 *   • A formula number outside 1 to 9 throws.
 *   • Every formula page in the database clone: tests/rii_formula_database.mjs.
 *
 * Run: node tests/rii_formula_import.mjs
 */

import { evalFormulaN, leftOutRanges, sampleMaterial } from '../src/utils/materials/riiDatabase.js';

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

// ── Formula 2: C1 is the constant whatever the number of coefficients ───────
// AgGaSe2, Boyd, ordinary ray: four coefficients. Read as two pairs with no
// constant, the page had a pole at 1.49 µm and n = 14 at 1.5 µm.
{
    const c = [3.6453, 2.2057, 0.1879, 1.8377];
    const um = 1.5, l2 = um * um;
    // C5 is not given and reads as 0, so the last term is C4·λ²/λ² = C4.
    const expect = Math.sqrt(1 + 3.6453 + 2.2057 * l2 / (l2 - 0.1879) + 1.8377);
    near(evalFormulaN({ riiFormulaNum: 2, formulaCoeffs: c }, 1500), expect, 1e-12,
        'formula 2 with an even number of coefficients keeps C1 as the constant');
}

// ── Formula 4: an empty second group adds nothing ────────────────────────────
// BeAl2O4, Walling, alpha: C6 to C9 are all 0, and 0⁰ = 1, so the group read
// as written is 0·λ⁰/(λ² − 1), which is 0/0 at exactly 1 µm. The database's
// own script gives NaN there; the sampling grid never lands on 1 µm, but a
// stored material is evaluated wherever a design asks.
{
    const c = [1.78522, 1.21202, 2, 0.01262, 1, 0, 0, 0, 0, -0.01681, 2];
    const expect = Math.sqrt(1.78522 + 1.21202 / (1 - 0.01262) - 0.01681);
    near(evalFormulaN({ riiFormulaNum: 4, formulaCoeffs: c }, 1000), expect, 1e-12,
        'formula 4 with an empty second group is finite at exactly 1 µm');
}

// ── Formula 4: C4^C5 as written, sign included ──────────────────────────────
// LiB3O5, Chen, beta: C4 = −0.0060517 with C5 = 1 puts λ² + 0.0060517 in the
// denominator.
{
    const c = [2.52500, 0.017123, 0, -0.0060517, 1, 0, 0, 0, 1, -0.0087838, 2];
    const um = 0.2894, l2 = um * um;
    const expect = Math.sqrt(2.525 + 0.017123 / (l2 + 0.0060517) - 0.0087838 * l2);
    near(evalFormulaN({ riiFormulaNum: 4, formulaCoeffs: c }, 289.4), expect, 1e-12,
        'formula 4 raises a negative C4 to C5 without dropping its sign');
}

// ── No clamp: a pole inside the stated range leaves points out ───────────────
// CS2, Chemnitz: the resonance at 6.592 µm lies inside 0.3 to 12 µm, and just
// short of it n² is negative. Those grid points are left out and reported,
// where a clamp used to store n = 1; a real n² below 1 is kept as it is.
{
    const cs2 = {
        type: 'formula', riiFormulaNum: 1, formulaCoeffs: [0, 1.499426, 0.178763, 0.089531, 6.591946],
        wavelengthRange: [300, 12000], references: '', comments: '', dataPath: 'main/CS2/nk/Chemnitz.yml',
    };
    ok(Number.isNaN(evalFormulaN(cs2, 6492.71)), 'formula 1 gives no real n where n² is negative');
    near(evalFormulaN(cs2, 6428.42), Math.sqrt(1 + 1.499426 * 6.42842 ** 2 / (6.42842 ** 2 - 0.178763 ** 2)
        + 0.089531 * 6.42842 ** 2 / (6.42842 ** 2 - 6.591946 ** 2)), 1e-12, 'and n below 1 where n² is between 0 and 1');
    const rows = sampleMaterial(cs2);
    ok(!rows.some(([lam]) => lam === 6492.71 || lam === 6557.63), 'the two grid points in the band are left out');
    ok(rows.every(([, n]) => Number.isFinite(n)), 'every stored n is finite');
    ok(JSON.stringify(leftOutRanges(cs2)) === JSON.stringify([[6492.71, 6557.63]]),
        `the left-out band is reported: ${JSON.stringify(leftOutRanges(cs2))}`);
}

// ── Formulas 6 to 9: one value per formula from the page's source ────────────
// Coefficients as the database pages give them. Each tolerance is half a unit
// of the last digit printed.

// Formula 6 (Gases), air. E. R. Peck and K. Reeder, J. Opt. Soc. Am. 62, 958
// (1972), Table V, the value their Eq. (3) gives at 0.214506 µm:
// (n − 1)·10⁸ = 31 496.6.
{
    const air = { riiFormulaNum: 6, formulaCoeffs: [8.06051E-5, 2.480990E-2, 132.274, 1.74557E-4, 39.32957] };
    near((evalFormulaN(air, 214.506) - 1) * 1e8, 31496.6, 0.05,
        'formula 6, air (Peck and Reeder): (n − 1)·10⁸ at 214.506 nm');
}

// Formula 7 (Herzberger), Si. D. F. Edwards and E. Ochoa, Appl. Opt. 19, 4130
// (1980), Table I, 26 °C: n = 3.4215 at 10.00 µm. The page gives five
// coefficients, so C6 reads as 0.
{
    const si = { riiFormulaNum: 7, formulaCoeffs: [3.41983, 0.159906, -0.123109, 1.26878E-6, -1.95104E-9] };
    near(evalFormulaN(si, 10000), 3.4215, 5e-5, 'formula 7, Si (Edwards and Ochoa) at 10 µm');
}

// Formula 8 (Retro), AgBr. H. Schröter, Z. Phys. 67, 24 (1931), Tabelle 5,
// "n berechnet" at the mercury green line 0.54607 µm: n = 2.2777. Schröter
// computed that column by hand: at five of its other 23 lines it is off his
// own formula by 6e-5 to 1.1e-4, past its last printed digit.
{
    const agbr = { riiFormulaNum: 8, formulaCoeffs: [0.452505, 0.09939, 0.070537, -0.000150] };
    near(evalFormulaN(agbr, 546.07), 2.2777, 5e-5, 'formula 8, AgBr (Schröter) at 546.07 nm');
}

// Formula 9 (Exotic), urea, extraordinary ray. M. J. Rosker, K. Cheng and
// C. L. Tang, IEEE J. Quantum Electron. 21, 1600 (1985) print no index in any
// copy that could be reached. The value is refractiveindex.info's own for the
// page, n = 1.602824038612 at 0.6344 µm: it checks the expression as the
// database evaluates it, not the paper.
{
    const urea = { riiFormulaNum: 9, formulaCoeffs: [2.51527, 0.0240, 0.0300, 0.020, 1.52, 0.8771] };
    near(evalFormulaN(urea, 634.4), 1.602824038612, 5e-13, 'formula 9, urea e (Rosker) at 634.4 nm');
}

// ── A formula number the database does not define ───────────────────────────
{
    let threw = false;
    try { evalFormulaN({ riiFormulaNum: 10, formulaCoeffs: [1, 2, 3] }, 600); }
    catch (_) { threw = true; }
    ok(threw, 'formula 10 throws instead of returning a number');
}

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll tests passed.');
