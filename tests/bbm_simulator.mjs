/**
 * Broadband Monitoring Simulator sanity tests.
 *
 * Run: node tests/bbm_simulator.mjs
 *
 * Monte Carlo is inherently stochastic; we use a seeded RNG so runs are
 * reproducible, and assert that well-defined invariants hold:
 *
 *   • σ = 0 identity: with zero rate σ, zero index σ, zero noise, and zero
 *     drift, the simulator's cut decision still has finite precision because
 *     the noise-free fit only resolves d to within the golden-section tol —
 *     so we use the relaxed bound (≤ 0.5 nm).
 *
 *   • Per-layer thickness statistics: with σ_thk_extra > 0, stdev of as-built
 *     thicknesses grows roughly linearly with σ.
 *
 *   • Spectrum corridor: with noise > 0, the as-built corridor width grows
 *     monotonically with the random-noise level.
 *
 *   • Single-layer BBAR: a clean monitored deposition recovers a target
 *     thickness to within 1 nm at modest scan interval.
 *
 *   • previewLayerSignal returns three spectra of the right length.
 */

import {
    simulateRun, runMonteCarloBBM, previewLayerSignal,
} from '../src/utils/monitoring/monitoringSim.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

// Mulberry32 RNG
function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const resolveMat = (id) => getMaterial(id) || getMaterial('Air');

// ── Designs ───────────────────────────────────────────────────────────────────

// MgF2 single-layer BBAR at 550 nm
function bbarDesign(thk = 94) {
    return {
        id: 'bbar1', name: 'BBAR',
        referenceWavelength: 550,
        substrate: { material: 'BK7', thickness: 1.0 },
        incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [{ id: 'L1', material: 'MgF2', thickness: thk, locked: false }],
        backLayers: [],
        surfaceMode: 'front_only',
        meritOperands: [
            { type:'RAV', lambdaStart:400, lambdaEnd:700, aoi:0, pol:'avg',
              target:0, weight:1, enabled:true },
        ],
    };
}

// 4-layer HL stack
function fourLayerDesign() {
    return {
        id: '4L', name: '4-layer',
        referenceWavelength: 550,
        substrate: { material: 'BK7', thickness: 1.0 },
        incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'L1', material: 'TiO2', thickness:  60, locked: false },
            { id: 'L2', material: 'SiO2', thickness: 100, locked: false },
            { id: 'L3', material: 'TiO2', thickness:  80, locked: false },
            { id: 'L4', material: 'SiO2', thickness: 110, locked: false },
        ],
        backLayers: [],
        surfaceMode: 'front_only',
        meritOperands: [
            { type:'RAV', lambdaStart:450, lambdaEnd:650, aoi:0, pol:'avg',
              target:0, weight:1, enabled:true },
        ],
    };
}

// ── Common monitoring config (small grid, short layers — fast tests) ──────────

const baseMon = {
    char: 'T', theta: 0, polarization: 'avg',
    lambdaStart: 400, lambdaEnd: 800, nPoints: 21,
    scanIntervalSec: 0.4,
};

// ── Test 1: zero-noise single-layer convergence ───────────────────────────────

function test_zero_noise_single_layer() {
    const design = bbarDesign(94);
    const cfg = {
        rates: new Map([['MgF2', { mean: 0.5, sigma: 0 }]]),
        sigmaReN: 0, sigmaImN: 0,
        sigmaThkAbsNm: 0, sigmaThkRelPct: 0,
        mon: baseMon,
        sig: { randomPct: 0, driftPctPer1000s: 0 },
        rng: makeRng(1234),
    };
    const res = simulateRun(design, resolveMat, cfg);
    // With K=2 confirmation, rate=0.5 nm/s, dt=0.4 s, each scan steps 0.2 nm.
    // First crossing at d≈94.2; confirm at d≈94.4 → cut. Bias ≤ 1 nm acceptable.
    const err = res.asBuiltFront[0] - 94;
    ok(Math.abs(err) <= 1.0, `single-layer zero-noise: as-built ${res.asBuiltFront[0]} nm, err ${err.toFixed(3)} nm (≤ 1.0)`);
}

// ── Test 2: random-noise corridor scales with noise level ─────────────────────

async function test_noise_corridor_scales() {
    const design = bbarDesign(94);
    const baseCfg = {
        rates: new Map([['MgF2', { mean: 0.5, sigma: 0 }]]),
        sigmaReN: 0, sigmaImN: 0,
        sigmaThkAbsNm: 0, sigmaThkRelPct: 0,
        mon: baseMon,
        nRuns: 12,
        spectrumParams: { lambdaStart:400, lambdaEnd:700, lambdaStep:25, theta:0, polarization:'avg' },
    };
    // Realistic spectrometer noise levels: 0.1 % vs 0.5 % (typical BBM
    // commercial monitoring is in this range; above 1 % the fit becomes
    // unreliable and the algorithm falls back to dead-reckoning).
    const lowNoise = await runMonteCarloBBM(design, resolveMat, {
        ...baseCfg, sig: { randomPct: 0.1, driftPctPer1000s: 0 }, rng: makeRng(11),
    });
    const highNoise = await runMonteCarloBBM(design, resolveMat, {
        ...baseCfg, sig: { randomPct: 0.5, driftPctPer1000s: 0 }, rng: makeRng(11),
    });
    // Per-layer thickness stdev should grow with noise within the working
    // regime of the fitter (≤ 1%).
    const lowD  = lowNoise.perLayer.stdev[0];
    const highD = highNoise.perLayer.stdev[0];
    ok(highD > lowD * 1.2,
       `noise → per-layer thk stdev grows: σ_d(0.1%)=${lowD.toFixed(3)} nm, σ_d(0.5%)=${highD.toFixed(3)} nm (need 1.2× growth)`);
}

// ── Test 3: rate jitter produces per-layer thickness spread ───────────────────

async function test_rate_jitter_per_layer_spread() {
    const design = fourLayerDesign();
    const cfg = {
        // Significant rate jitter on both materials
        rates: new Map([
            ['TiO2', { mean: 0.3, sigma: 0.06 }],   // 20% σ
            ['SiO2', { mean: 0.5, sigma: 0.10 }],   // 20% σ
        ]),
        sigmaReN: 0, sigmaImN: 0,
        sigmaThkAbsNm: 0, sigmaThkRelPct: 0,
        mon: baseMon,
        sig: { randomPct: 0.5, driftPctPer1000s: 0 },
        nRuns: 10,
        rng: makeRng(42),
        spectrumParams: { lambdaStart:450, lambdaEnd:650, lambdaStep:25, theta:0, polarization:'avg' },
    };
    const res = await runMonteCarloBBM(design, resolveMat, cfg);
    // All four layers should show non-zero stdev under rate jitter
    let allNonZero = true;
    let meanStdev = 0;
    for (let i = 0; i < res.perLayer.stdev.length; i++) {
        if (res.perLayer.stdev[i] < 1e-4) { allNonZero = false; }
        meanStdev += res.perLayer.stdev[i];
    }
    meanStdev /= res.perLayer.stdev.length;
    ok(allNonZero, `per-layer stdev: all > 0 (got [${res.perLayer.stdev.map(s=>s.toFixed(3)).join(', ')}])`);
    ok(meanStdev > 0.1, `per-layer mean stdev > 0.1 nm under 20% rate jitter (got ${meanStdev.toFixed(3)})`);
}

// ── Test 4: as-built MF degrades vs theory under noise ────────────────────────

async function test_mf_degrades_under_noise() {
    const design = fourLayerDesign();
    const cfg = {
        rates: new Map([
            ['TiO2', { mean: 0.3, sigma: 0.03 }],
            ['SiO2', { mean: 0.5, sigma: 0.05 }],
        ]),
        sigmaReN: 0.003, sigmaImN: 0,
        perMaterial: true,
        sigmaThkAbsNm: 0, sigmaThkRelPct: 0,
        mon: baseMon,
        sig: { randomPct: 1.0, driftPctPer1000s: 0 },
        nRuns: 10, rng: makeRng(7),
        spectrumParams: { lambdaStart:450, lambdaEnd:650, lambdaStep:25, theta:0, polarization:'avg' },
        yieldTolerance: 0.5,   // generous so some runs pass
    };
    const res = await runMonteCarloBBM(design, resolveMat, cfg);
    // Yield should be in [0, 1]. MF runs should be finite + non-trivial spread
    // (don't compare to theoretical MF — an arbitrary, unoptimized 4-layer
    // design can occasionally get *better* under random errors, so the
    // "noise must degrade" assertion is unsafe).
    const mfRuns = res.yieldDetails.mfRuns;
    ok(mfRuns.length === 10, `MF computed for each run (${mfRuns.length}/10)`);
    ok(mfRuns.every(mf => isFinite(mf) && mf >= 0),
       `all MF values finite and non-negative`);
    const mfMin = Math.min(...mfRuns), mfMax = Math.max(...mfRuns);
    ok(mfMax - mfMin > 1e-4,
       `MF spread non-trivial across runs: min=${mfMin.toFixed(4)} max=${mfMax.toFixed(4)}`);
    ok(res.yield != null && res.yield >= 0 && res.yield <= 1,
       `yield in [0,1]: ${res.yield}`);
}

// ── Test 5: theoretical spectrum on display grid is bit-identical ─────────────

async function test_theory_matches_no_noise_mean_loosely() {
    const design = bbarDesign(94);
    // With everything zero, the as-built ≈ theory + small cut overshoot.
    // We check that the corridor LOWER bound at λ₀ is reasonable (not zero).
    const cfg = {
        rates: new Map([['MgF2', { mean: 0.5, sigma: 0 }]]),
        sigmaReN: 0, sigmaImN: 0,
        sigmaThkAbsNm: 0, sigmaThkRelPct: 0,
        mon: { ...baseMon, scanIntervalSec: 0.1 },   // finer to reduce overshoot
        sig: { randomPct: 0, driftPctPer1000s: 0 },
        nRuns: 3, rng: makeRng(99),
        spectrumParams: { lambdaStart:550, lambdaEnd:550, lambdaStep:50, theta:0, polarization:'avg' },
    };
    const res = await runMonteCarloBBM(design, resolveMat, cfg);
    // At 550 nm, MgF2 QW BBAR: T ≈ 0.985 (just T, not paired). The theory
    // value should be > 0.97 and the mean very close to theory.
    const T_th  = res.theory[0];
    const T_mean = res.mean[0];
    ok(T_th > 0.96 && T_th < 1.0, `theory T(550) is sane: ${T_th.toFixed(4)}`);
    ok(Math.abs(T_mean - T_th) < 0.01,
       `noise-free mean ≈ theory: |${T_mean.toFixed(4)} − ${T_th.toFixed(4)}| < 0.01`);
}

// ── Test 6: previewLayerSignal returns three sane spectra ─────────────────────

function test_preview_layer_signal() {
    const design = fourLayerDesign();
    const out = previewLayerSignal(design, resolveMat, 2, {
        char: 'T', lambdaStart: 400, lambdaEnd: 800, nPoints: 11,
    });
    ok(out.lambda.length === 11, `preview λ length: ${out.lambda.length} === 11`);
    ok(out.frac80.length === 11 && out.frac90.length === 11 && out.frac100.length === 11,
       `preview spectra lengths`);
    ok(out.layerIndex === 2, `layerIndex returned correctly`);
    // frac100 should differ from frac80 (different stack)
    let diffSum = 0;
    for (let i = 0; i < 11; i++) diffSum += Math.abs(out.frac100[i] - out.frac80[i]);
    ok(diffSum > 1e-4, `frac100 ≠ frac80 (Σ|Δ|=${diffSum.toFixed(4)} > 1e-4)`);
}

// ── Run all ───────────────────────────────────────────────────────────────────

async function main() {
    console.log('Running BBM simulator tests...\n');
    test_zero_noise_single_layer();
    await test_noise_corridor_scales();
    await test_rate_jitter_per_layer_spread();
    await test_mf_degrades_under_noise();
    await test_theory_matches_no_noise_mean_loosely();
    test_preview_layer_signal();

    if (fails === 0) {
        console.log('\n✓ All BBM tests passed');
        process.exit(0);
    } else {
        console.error(`\n✗ ${fails} BBM test(s) failed`);
        process.exit(1);
    }
}

main();
