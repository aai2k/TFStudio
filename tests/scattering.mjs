/**
 * Interface Roughness / Scattering tests — Macleod Eq. 16.30 verification:
 *
 *   TIS = R · (4π σ cosθ / λ)²
 *
 * Tests:
 *   1) effectiveRoughness sqrt-sum-of-squares behavior, skip-zero/NaN
 *   2) tisAtLambda single-λ matches the closed form analytically
 *   3) cos²θ scaling (oblique vs normal)
 *   4) λ⁻² scaling
 *   5) σ² scaling
 *   6) R multiplier
 *   7) tisSpectrum equals per-element tisAtLambda
 *   8) applyScatteringLoss conserves R+T+loss = original R+T (no flux invented)
 *   9) Zero roughness ⇒ no loss
 *  10) resolveSigmas: uniform / per-interface / fill behavior
 *  11) countInterfaces edge cases
 *  12) Realistic dataset value sanity: σ=1nm, λ=500nm, R=1 → TIS ≈ 631 ppm
 *
 * Run: node tests/scattering.mjs
 */

import {
    effectiveRoughness, tisAtLambda, tisSpectrum, applyScatteringLoss,
    emptyRoughness, cloneRoughness, resolveSigmas, countInterfaces,
} from '../src/utils/physics/scattering.js';

let fails = 0;
const ok    = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near  = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;

// ── 1) effectiveRoughness ──────────────────────────────────────────────────
{
    ok(effectiveRoughness([])         === 0,   'effectiveRoughness: empty → 0');
    ok(effectiveRoughness([0, 0, 0])  === 0,   'effectiveRoughness: all-zero → 0');
    ok(near(effectiveRoughness([3, 4]), 5),    'effectiveRoughness: [3,4] → 5 (Pythagoras)');
    ok(near(effectiveRoughness([1, 1, 1, 1]), 2), 'effectiveRoughness: 4×1 → 2');
    // Skip NaN / negative
    ok(near(effectiveRoughness([3, NaN, 4, -1]), 5),
        'effectiveRoughness: skips NaN and negative');
}

// ── 2) tisAtLambda matches closed form ─────────────────────────────────────
{
    const lam = 500, sigma = 2, theta = 0, R = 1.0;
    const expected = Math.pow(4 * Math.PI * sigma / lam, 2);  // theta=0
    ok(near(tisAtLambda(lam, sigma, theta, R), expected, 1e-15),
        `tisAtLambda(@λ=500, σ=2, θ=0): closed-form match`);
    // σ = 0 → 0
    ok(tisAtLambda(500, 0, 0, 1.0) === 0, 'tisAtLambda: σ=0 → 0');
    // λ = 0 → 0 (guarded; would otherwise divide by zero)
    ok(tisAtLambda(0, 2, 0, 1.0) === 0, 'tisAtLambda: λ=0 → 0');
}

// ── 3) Oblique-incidence cos²θ scaling ─────────────────────────────────────
{
    const lam = 500, sigma = 2;
    const tisN = tisAtLambda(lam, sigma, 0,  1.0);
    const tis60 = tisAtLambda(lam, sigma, 60, 1.0);
    // cos²(60°) = 0.25, so tis60 = 0.25 · tisN
    ok(near(tis60 / tisN, 0.25, 1e-12), `oblique: cos²(60°)=0.25 (got ratio ${tis60/tisN})`);
}

// ── 4) λ⁻² scaling ─────────────────────────────────────────────────────────
{
    const sigma = 2, theta = 0;
    const tis500 = tisAtLambda(500, sigma, theta, 1.0);
    const tis1000 = tisAtLambda(1000, sigma, theta, 1.0);
    // Doubling λ should quarter TIS
    ok(near(tis500 / tis1000, 4.0, 1e-12), `λ⁻²: TIS(500)/TIS(1000) = 4 (got ${tis500/tis1000})`);
}

// ── 5) σ² scaling ───────────────────────────────────────────────────────────
{
    const lam = 500, theta = 0;
    const tis1 = tisAtLambda(lam, 1, theta, 1.0);
    const tis3 = tisAtLambda(lam, 3, theta, 1.0);
    ok(near(tis3 / tis1, 9.0, 1e-12), `σ²: TIS(σ=3)/TIS(σ=1) = 9 (got ${tis3/tis1})`);
}

// ── 6) R multiplier ────────────────────────────────────────────────────────
{
    const t100 = tisAtLambda(500, 2, 0, 1.0);
    const t50  = tisAtLambda(500, 2, 0, 0.5);
    ok(near(t50 / t100, 0.5, 1e-15), `R multiplier: R=0.5 halves TIS (got ratio ${t50/t100})`);
}

// ── 7) tisSpectrum matches per-element tisAtLambda ─────────────────────────
{
    const lambdas = [400, 500, 600, 700, 800];
    const Rvec   = [0.95, 0.90, 0.85, 0.80, 0.75];
    const spec = tisSpectrum(lambdas, 1.5, 30, Rvec);
    for (let i = 0; i < lambdas.length; i++) {
        const expected = tisAtLambda(lambdas[i], 1.5, 30, Rvec[i]);
        ok(near(spec[i], expected, 1e-15), `tisSpectrum[${i}] match`);
    }
}

// ── 8) applyScatteringLoss — flux conservation (no flux invented) ──────────
{
    const lambdas = [400, 500, 600];
    const R = [0.5, 0.5, 0.5];
    const T = [0.4, 0.4, 0.4];   // A = 0.1
    const result = applyScatteringLoss(lambdas, R, T, 2.0, 0);
    for (let i = 0; i < lambdas.length; i++) {
        // Scatter loss = (R+T) - (R_spec+T_spec) = (R+T) · TIS_per_R
        const lossExpected = (R[i] + T[i]) * result.TIS_per_R[i];
        const lossActual = (R[i] + T[i]) - (result.R_spec[i] + result.T_spec[i]);
        ok(near(lossActual, lossExpected, 1e-15),
            `applyScatteringLoss[${i}]: (R+T)·TIS = lost specular`);
        ok(result.R_spec[i] <= R[i], `R_spec ≤ R at i=${i}`);
        ok(result.T_spec[i] <= T[i], `T_spec ≤ T at i=${i}`);
    }
}

// ── 9) Zero roughness ⇒ no loss ────────────────────────────────────────────
{
    const lambdas = [400, 500, 600];
    const R = [0.5, 0.5, 0.5], T = [0.4, 0.4, 0.4];
    const result = applyScatteringLoss(lambdas, R, T, 0, 0);
    for (let i = 0; i < lambdas.length; i++) {
        ok(near(result.R_spec[i], R[i]), `σ=0: R unchanged at i=${i}`);
        ok(near(result.T_spec[i], T[i]), `σ=0: T unchanged at i=${i}`);
        ok(result.TIS_per_R[i] === 0,    `σ=0: TIS_per_R = 0 at i=${i}`);
    }
}

// ── 10) resolveSigmas — uniform fills, per-interface honors array ─────────
{
    const uni = resolveSigmas({ mode: 'uniform', sigma: 1.5 }, 4);
    ok(uni.length === 4 && uni.every(s => s === 1.5), 'resolveSigmas uniform: 4-element 1.5 array');

    const per = resolveSigmas({ mode: 'perInterface', sigmas: [1, 2, 3] }, 3);
    ok(per.length === 3 && per[0] === 1 && per[1] === 2 && per[2] === 3,
        'resolveSigmas perInterface: honors per-element values');

    // Short array → zero-pad
    const short = resolveSigmas({ mode: 'perInterface', sigmas: [1, 2] }, 4);
    ok(short.length === 4 && short[2] === 0 && short[3] === 0,
        'resolveSigmas perInterface: short array zero-padded');

    // Null spec → all zeros
    const z = resolveSigmas(null, 3);
    ok(z.length === 3 && z.every(s => s === 0), 'resolveSigmas null → all zeros');
}

// ── 11) countInterfaces edge cases ─────────────────────────────────────────
{
    ok(countInterfaces(0) === 1, 'countInterfaces(0) = 1 (substrate-only stack)');
    ok(countInterfaces(1) === 2, 'countInterfaces(1) = 2');
    ok(countInterfaces(5) === 6, 'countInterfaces(5) = 6 (N+1)');
}

// ── 12) Sanity: σ=1nm, λ=500nm, R=1, θ=0 → TIS ≈ 631 ppm ──────────────────
{
    // (4π · 1 / 500)² = (0.025133)² = 6.317×10⁻⁴ ≈ 631 ppm
    const v = tisAtLambda(500, 1, 0, 1.0);
    const ppm = v * 1e6;
    ok(Math.abs(ppm - 631.6) < 1, `Datasheet sanity: σ=1nm, λ=500nm → TIS ≈ 631 ppm (got ${ppm.toFixed(1)})`);
}

// ── 13) Clone/empty roundtrip ──────────────────────────────────────────────
{
    const e = emptyRoughness();
    ok(e.mode === 'uniform' && e.sigma === 1.0, 'emptyRoughness defaults');
    const c = cloneRoughness({ mode: 'perInterface', sigma: 5, sigmas: [1, 2, 3] });
    c.sigmas[0] = 999;
    const c2 = cloneRoughness(c);
    ok(c2.sigmas[0] === 999, 'cloneRoughness: array deep-copied');
    c2.sigmas[0] = 0;
    ok(c.sigmas[0] === 999, 'cloneRoughness: independent from source');
}

// ── Summary ────────────────────────────────────────────────────────────────
if (fails === 0) {
    console.log('All scattering tests passed.');
    process.exit(0);
} else {
    console.error(`${fails} test(s) failed.`);
    process.exit(1);
}
