/**
 * Integral Values tests.
 *
 * Run: node tests/integral_values.mjs
 *
 * Properties asserted:
 *   • Trapezoidal integral of a known closed-form spectrum is correct.
 *   • Photopic Tvis of a uniform T(λ) ≡ 1.0 equals 1.0 exactly (V(λ)·D65
 *     denominator cancels by Macleod Eq. 12.2 → Y of perfect white = 100 %).
 *   • Solar Tsol of T ≡ 1.0 equals 1.0 (any weighting integrated against a
 *     constant is the constant).
 *   • CSV parser tolerates blank lines, headers, comments, and separators.
 *   • User weighting integrates correctly (closed-form comparison).
 *   • Built-in weighting bands have the documented spans.
 */

import {
    BUILTIN_WEIGHTINGS,
    DEFAULT_INTEGRALS,
    computeIntegralValue,
    computeIntegralValueBatch,
    makeUserWeighting,
    parseWeightingCSV,
} from '../src/utils/physics/integralValues.js';
import { solarIrradianceAt, AM1_5G_5NM } from '../src/utils/physics/solarSpectrum.js';
import {
    BUILTIN_SOURCES,
    BUILTIN_DETECTORS,
    composeWeighting,
    planckSPD,
    parseSpectrumCSV,
    resolveSourceSpec,
    resolveDetectorSpec,
} from '../src/utils/physics/spectralWeightings.js';
import { photopicV, illuminantSPD } from '../src/utils/physics/colorimetry.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

// Helper: build a fake spectrum with closed-form T(λ).
function makeSpectrum(lamStart, lamEnd, lamStep, Tfn) {
    const lambda = [];
    for (let l = lamStart; l <= lamEnd + 1e-9; l += lamStep) {
        lambda.push(Math.round(l * 1000) / 1000);
    }
    const T = lambda.map(Tfn);
    return { lambda, T, R: T.map(v => 1 - v), A: lambda.map(() => 0) };
}

// ── 1. Constant T ≡ 1 ⇒ any integral = 1 ──────────────────────────────────────
console.log('— constant spectrum —');
{
    const spec = makeSpectrum(280, 2500, 5, () => 1.0);
    const r = computeIntegralValueBatch(spec, DEFAULT_INTEGRALS);
    for (const def of DEFAULT_INTEGRALS) {
        if (def.char !== 'T') continue;
        ok(near(r[def.key].value, 1.0, 1e-9),
           `${def.key}(T≡1) = 1.0 (got ${r[def.key].value})`);
    }
    // Same with constant R: Rvis(R≡0) should equal 0 (T=1 → R=0)
    ok(near(r.Rvis.value, 0, 1e-9), `Rvis(R≡0) = 0 (got ${r.Rvis.value})`);
}

// ── 2. Trapezoidal integral on a closed form ─────────────────────────────────
console.log('— trapezoidal accuracy —');
{
    // ∫₀¹ x²·dx = 1/3.  Build "spectrum" T(λ) = (λ/1000)² over 0..1000 nm,
    // weighting = 1 (flat) over the same range, compute the mean.
    const spec = makeSpectrum(0, 1000, 1, l => (l / 1000) ** 2);
    const w = {
        id: 'unit', kind: 'flat', lamMin: 0, lamMax: 1000,
        sampler: () => 1, label: 'unit', reference: 'unit',
    };
    const r = computeIntegralValue(spec, 'T', w);
    ok(Math.abs(r.value - 1/3) < 1e-4,
       `∫₀¹ x²·dx / 1 = 1/3 ≈ ${(1/3).toFixed(6)} (got ${r.value.toFixed(6)})`);
}

// ── 3. AM1.5G self-normalization & non-zero ──────────────────────────────────
console.log('— solar spectrum —');
{
    const spec = makeSpectrum(280, 2500, 5, () => 1.0);
    const r = computeIntegralValue(spec, 'T', BUILTIN_WEIGHTINGS.solar);
    ok(near(r.value, 1.0, 1e-9), `Tsol(T≡1) = 1.0 (got ${r.value})`);
    ok(r.norm > 100, `Σ AM1.5G(λ)·dλ > 100 W/m² (got ${r.norm.toFixed(1)})`);

    // AM1.5G interpolation correctness at table points
    const lam550 = solarIrradianceAt(550);
    const lam555 = solarIrradianceAt(555);
    const midpt  = solarIrradianceAt(552.5);
    ok(Math.abs(midpt - 0.5 * (lam550 + lam555)) < 1e-12,
       `solarIrradianceAt midpoint is linearly interpolated (Δ ${Math.abs(midpt - 0.5*(lam550+lam555)).toExponential(2)})`);

    // Out of range returns 0
    ok(solarIrradianceAt(100) === 0, `solar @ 100 nm = 0`);
    ok(solarIrradianceAt(5000) === 0, `solar @ 5000 nm = 0`);
}

// ── 4. Photopic Tvis under uniform T equals Y/100 of a perfect white ─────────
console.log('— photopic Tvis —');
{
    const spec = makeSpectrum(380, 780, 5, () => 1.0);
    const r = computeIntegralValue(spec, 'T', BUILTIN_WEIGHTINGS.photopic);
    ok(Math.abs(r.value - 1.0) < 1e-6, `Tvis(T≡1) ≈ 1.0 (got ${r.value})`);

    // For T ≡ 0.5 we expect exactly 0.5 (linearity)
    const spec05 = makeSpectrum(380, 780, 5, () => 0.5);
    const r05 = computeIntegralValue(spec05, 'T', BUILTIN_WEIGHTINGS.photopic);
    ok(Math.abs(r05.value - 0.5) < 1e-6, `Tvis(T≡0.5) ≈ 0.5 (got ${r05.value})`);
}

// ── 5. Band-limited integration ──────────────────────────────────────────────
console.log('— flat UV/NIR bands —');
{
    // Spectrum that is 1.0 in UV (300-380) and 0 elsewhere → TUV = 1.0, TNIR = 0
    const spec = makeSpectrum(280, 2500, 5,
                              l => (l >= 300 && l <= 380) ? 1.0 : 0.0);
    const tuv  = computeIntegralValue(spec, 'T', BUILTIN_WEIGHTINGS.uv);
    const tnir = computeIntegralValue(spec, 'T', BUILTIN_WEIGHTINGS.nir);
    ok(near(tuv.value, 1.0, 1e-9), `TUV (T=1 in UV) = 1.0 (got ${tuv.value})`);
    ok(near(tnir.value, 0,  1e-9), `TNIR (T=0 in NIR) = 0 (got ${tnir.value})`);
    // Flat band has the documented limits
    ok(BUILTIN_WEIGHTINGS.uv.lamMin === 300 && BUILTIN_WEIGHTINGS.uv.lamMax === 380, 'UV band 300–380 nm');
    ok(BUILTIN_WEIGHTINGS.nir.lamMin === 780 && BUILTIN_WEIGHTINGS.nir.lamMax === 2500, 'NIR band 780–2500 nm');
}

// ── 6. CSV parser tolerances ─────────────────────────────────────────────────
console.log('— CSV parser —');
{
    const csv = `
# comment line
lambda,weight
400, 0.0
450, 0.5
500, 1.0   ; with semicolon
550\t0.5
600   0.0

700; 0.0
`;
    const rows = parseWeightingCSV(csv);
    ok(rows.length === 6, `parsed 6 rows (got ${rows.length})`);
    ok(rows[0][0] === 400 && rows[0][1] === 0.0, 'row 0 = [400, 0]');
    ok(rows[2][0] === 500 && rows[2][1] === 1.0, 'row 2 = [500, 1.0]');
    ok(rows[3][0] === 550 && rows[3][1] === 0.5, 'tab separator works');
    ok(rows[4][0] === 600 && rows[4][1] === 0.0, 'multi-space separator works');
}

// ── 7. User weighting closed form ─────────────────────────────────────────────
console.log('— user weighting —');
{
    // Triangular weight on 400-600 nm peaking at 500 nm.
    // ∫w·dλ = ½ · 200 · 1.0 = 100; ∫T·w·dλ for T ≡ 0.7 = 0.7·100 = 70
    const userTable = [
        [400, 0.0],
        [500, 1.0],
        [600, 0.0],
    ];
    const w = makeUserWeighting(userTable, 'triangle');
    const spec = makeSpectrum(300, 700, 1, () => 0.7);
    const r = computeIntegralValue(spec, 'T', w);
    ok(Math.abs(r.value - 0.7) < 1e-6,
       `user-weighted T̄ of constant 0.7 = 0.7 (got ${r.value.toFixed(6)})`);
    ok(Math.abs(r.norm - 100) < 1e-2,
       `∫triangle·dλ ≈ 100 (got ${r.norm.toFixed(4)})`);
}

// ── 8. computeIntegralValueBatch consistency ──────────────────────────────────
console.log('— batch consistency —');
{
    const spec = makeSpectrum(280, 2500, 5, l => {
        const x = (l - 600) / 200;
        return 0.9 * Math.exp(-(x * x));
    });
    const batch = computeIntegralValueBatch(spec, DEFAULT_INTEGRALS);
    for (const def of DEFAULT_INTEGRALS) {
        const one = computeIntegralValue(spec, def.char, def.weighting);
        ok(near(batch[def.key].value, one.value, 1e-15),
           `batch ${def.key} matches single (got Δ ${Math.abs(batch[def.key].value - one.value).toExponential(2)})`);
    }
}

// ── 9. Min/max reporting on a non-monotonic spectrum ─────────────────────────
console.log('— min/max columns —');
{
    // T(λ) = 0.5 + 0.4·sin(2π·(λ-400)/200) over 400-600 nm:
    //   min at λ where sin = -1 → λ = 400 + 200·(3π/2)/(2π) = 400 + 150 = 550
    //   max at λ where sin = +1 → λ = 400 + 200·(π/2)/(2π)  = 400 +  50 = 450
    const spec = makeSpectrum(400, 600, 1, l => 0.5 + 0.4 * Math.sin(2 * Math.PI * (l - 400) / 200));
    const w = {
        id: 'unit', kind: 'flat', lamMin: 400, lamMax: 600,
        sampler: () => 1, label: 'unit', reference: 'unit',
    };
    const r = computeIntegralValue(spec, 'T', w);
    ok(Math.abs(r.min - 0.1) < 1e-6, `min ≈ 0.1 (got ${r.min})`);
    ok(Math.abs(r.max - 0.9) < 1e-6, `max ≈ 0.9 (got ${r.max})`);
    ok(Math.abs(r.lamAtMin - 550) < 1e-3, `argmin λ ≈ 550 nm (got ${r.lamAtMin})`);
    ok(Math.abs(r.lamAtMax - 450) < 1e-3, `argmax λ ≈ 450 nm (got ${r.lamAtMax})`);
}

// ── 10. Min/max in photopic special case ─────────────────────────────────────
console.log('— min/max under photopic special case —');
{
    // Same wave over 380..780; min should be near 0.1, max near 0.9 inside the band
    const spec = makeSpectrum(380, 780, 5, l => 0.5 + 0.4 * Math.sin(2 * Math.PI * l / 200));
    const r = computeIntegralValue(spec, 'T', BUILTIN_WEIGHTINGS.photopic);
    ok(Math.abs(r.min - 0.1) < 0.05, `photopic min ≈ 0.1 (got ${r.min})`);
    ok(Math.abs(r.max - 0.9) < 0.05, `photopic max ≈ 0.9 (got ${r.max})`);
    ok(r.lamAtMin >= 380 && r.lamAtMin <= 780, `argmin λ in band (got ${r.lamAtMin})`);
    ok(r.lamAtMax >= 380 && r.lamAtMax <= 780, `argmax λ in band (got ${r.lamAtMax})`);
}

// ── 11. composeWeighting: D65 × V(λ) approximates Tvis ───────────────────────
console.log('— composed D65 × V(λ) ≈ Tvis —');
{
    // The built-in photopic uses tristimulus exactly; the composed (D65×V(λ))
    // weighting trapezoidal-integrates the same product on the design grid.
    // For a constant T(λ) ≡ 0.7 both should equal 0.7. For a sloped T(λ) they
    // should agree to better than 1e-3 on a 5-nm grid.
    const wc = composeWeighting({
        source:   { id: 'D65' },
        detector: { id: 'photopic' },
        band:     [380, 780],
    });

    const specFlat = makeSpectrum(380, 780, 5, () => 0.7);
    const rFlat = computeIntegralValue(specFlat, 'T', wc);
    ok(Math.abs(rFlat.value - 0.7) < 1e-9, `composed Tvis(T≡0.7) = 0.7 (got ${rFlat.value})`);

    const specSlope = makeSpectrum(380, 780, 5, l => 0.5 + 0.001 * (l - 580));
    const rA = computeIntegralValue(specSlope, 'T', wc);
    const rB = computeIntegralValue(specSlope, 'T', BUILTIN_WEIGHTINGS.photopic);
    ok(Math.abs(rA.value - rB.value) < 2e-3,
       `composed Tvis ≈ tristimulus Tvis (|Δ| ${Math.abs(rA.value - rB.value).toExponential(2)})`);
}

// ── 12. Planck SPD: peak at Wien's law λ_peak·T ≈ 2.898e6 nm·K ───────────────
console.log('— blackbody SPD (Planck) —');
{
    const T = 5778; // K (the sun)
    const lamPeakWien = 2.898e6 / T; // ≈ 502 nm
    // Sample Planck on a coarse grid and verify the maximum is near the Wien peak
    let bestLam = 0, bestVal = -Infinity;
    for (let l = 200; l <= 2500; l += 5) {
        const v = planckSPD(l, T);
        if (v > bestVal) { bestVal = v; bestLam = l; }
    }
    ok(Math.abs(bestLam - lamPeakWien) < 10,
       `Planck peak near Wien (λ_peak ≈ ${lamPeakWien.toFixed(0)} nm, got ${bestLam} nm)`);
    ok(planckSPD(500, T) > 0, 'Planck > 0 in visible');
    ok(planckSPD(500, 0) === 0, 'T=0 → 0');
}

// ── 13. resolveSourceSpec / resolveDetectorSpec defaults & bounds ─────────────
console.log('— spec resolution —');
{
    const eS = resolveSourceSpec({ id: 'E' });
    ok(eS.sampler(500) === 100, 'E source = 100 (relative)');

    const flatD = resolveDetectorSpec({ id: 'flat' });
    ok(flatD.sampler(500) === 1 && flatD.sampler(2000) === 1, 'flat detector = unity everywhere');

    const photo = resolveDetectorSpec({ id: 'photopic' });
    ok(Math.abs(photo.sampler(555) - 1.0) < 1e-3, `V(555 nm) ≈ 1.0 (got ${photo.sampler(555)})`);
    ok(photo.sampler(300) === 0, `V(300 nm) = 0 (out of band)`);

    const custom = resolveSourceSpec({ id: 'custom', table: [[400, 0], [500, 1], [600, 0]] });
    ok(Math.abs(custom.sampler(500) - 1.0) < 1e-9, `custom @ peak = 1 (got ${custom.sampler(500)})`);
    ok(Math.abs(custom.sampler(450) - 0.5) < 1e-9, `custom interpolated @ 450 = 0.5 (got ${custom.sampler(450)})`);
    ok(custom.sampler(700) === 0, `custom out of range = 0`);
}

// ── 14. Band intersection in composeWeighting ─────────────────────────────────
console.log('— composeWeighting band intersection —');
{
    // Source = D65 [380,780], detector = flat [0,∞), user band [500,700]
    // → effective [500, 700]
    const w = composeWeighting({
        source:   { id: 'D65' },
        detector: { id: 'flat' },
        band:     [500, 700],
    });
    ok(w.lamMin === 500, `lamMin = 500 (got ${w.lamMin})`);
    ok(w.lamMax === 700, `lamMax = 700 (got ${w.lamMax})`);

    // Detector tighter than source: V(λ) is 380-780, AM1.5G is 280-2500 → 380-780
    const w2 = composeWeighting({
        source:   { id: 'AM1.5G' },
        detector: { id: 'photopic' },
    });
    ok(w2.lamMin === 380, `lamMin = 380 (got ${w2.lamMin})`);
    ok(w2.lamMax === 780, `lamMax = 780 (got ${w2.lamMax})`);
}

// ── 15. parseSpectrumCSV ≡ parseWeightingCSV (shared parser) ─────────────────
console.log('— parseSpectrumCSV mirrors parseWeightingCSV —');
{
    const csv = `400, 0.1\n500, 0.2\n600, 0.3\n`;
    const a = parseSpectrumCSV(csv);
    const b = parseWeightingCSV(csv);
    ok(a.length === b.length && a.length === 3, 'both parsers return same row count');
    for (let i = 0; i < a.length; i++) {
        ok(a[i][0] === b[i][0] && a[i][1] === b[i][1], `row ${i} matches`);
    }
}

console.log(fails === 0 ? 'PASS: integral_values' : `${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
