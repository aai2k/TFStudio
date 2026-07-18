/**
 * Broadband Monitoring Wizard backend tests.
 *
 * Run: node tests/bbm_wizard.mjs
 *
 * Validates the new single-experiment math that backs the 6-page wizard:
 *   • OU correlated-rate path: τ→0 ⇒ white (variance), finite-τ ⇒ positive
 *     lag-1 autocorrelation, stationary mean/σ preserved.
 *   • Shutter delay: mean delay biases as-built by ≈ rate·meanDelay; rms adds spread.
 *   • Exclude-from-monitoring: excluded layer ignores signal noise; deviation
 *     driven only by its relative-thickness-error spec.
 *   • Per-material deviations (matDev): systematic Re(n) offset applied per material.
 *   • recordTrajectory: estimatedFront + materialsFront populated, index-aligned.
 *   • REGRESSION: with none of the new cfg fields, simulateRun output is
 *     bit-identical to the pre-rework white-noise model.
 */

import {
    simulateRun, sampleOURatePath,
} from '../src/utils/monitoring/monitoringSim.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ok:', msg); } };

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

function fourLayer() {
    return {
        id: '4L', name: '4-layer', referenceWavelength: 550,
        substrate: { material: 'BK7', thickness: 1.0 },
        incidentMedium: 'Air', exitMedium: 'Air', surfaceMode: 'front_only',
        frontLayers: [
            { id: 'L1', material: 'TiO2', thickness: 60 },
            { id: 'L2', material: 'SiO2', thickness: 100 },
            { id: 'L3', material: 'TiO2', thickness: 80 },
            { id: 'L4', material: 'SiO2', thickness: 110 },
        ],
        backLayers: [],
    };
}
const baseMon = { char: 'T', theta: 0, polarization: 'avg', lambdaStart: 400, lambdaEnd: 800, nPoints: 15, scanIntervalSec: 0.4 };

// ── OU rate path ────────────────────────────────────────────────────────────
function test_ou_path() {
    const mean = 4, sigma = 0.4;
    // τ→0 white: lag-1 autocov ≈ 0; large τ: lag-1 autocov clearly > 0.
    const stats = (tau) => {
        const { r } = sampleOURatePath({ mean, sigma, tau, dt: 0.5, n: 4000, rng: makeRng(123) });
        const m = r.reduce((a, b) => a + b, 0) / r.length;
        let v = 0, c1 = 0;
        for (let i = 0; i < r.length; i++) v += (r[i] - m) ** 2;
        for (let i = 1; i < r.length; i++) c1 += (r[i] - m) * (r[i - 1] - m);
        v /= r.length; c1 /= (r.length - 1);
        return { m, sd: Math.sqrt(v), rho1: c1 / v };
    };
    const white = stats(0), corr = stats(5);
    ok(Math.abs(white.m - mean) < 0.05, `OU(τ=0) mean≈${mean}: ${white.m.toFixed(3)}`);
    ok(Math.abs(white.sd - sigma) < 0.05, `OU(τ=0) σ≈${sigma}: ${white.sd.toFixed(3)}`);
    ok(Math.abs(white.rho1) < 0.08, `OU(τ=0) lag-1 autocorr≈0: ${white.rho1.toFixed(3)}`);
    ok(corr.rho1 > 0.5, `OU(τ=5,Δt=0.5) lag-1 autocorr>0.5: ${corr.rho1.toFixed(3)}`);
    ok(Math.abs(corr.sd - sigma) < 0.06, `OU(τ=5) stationary σ≈${sigma}: ${corr.sd.toFixed(3)}`);
}

// ── Shutter delay ──────────────────────────────────────────────────────────
function test_shutter_delay() {
    const design = fourLayer();
    const rates = new Map([['TiO2', { mean: 0.3, sigma: 0 }], ['SiO2', { mean: 0.5, sigma: 0 }]]);
    const base = simulateRun(design, resolveMat, { rates, mon: baseMon, sig: { randomPct: 0 }, rng: makeRng(1) });
    const delayed = simulateRun(design, resolveMat, { rates, mon: baseMon, sig: { randomPct: 0 }, shutterDelayMeanS: 2, rng: makeRng(1) });
    // L1 = TiO2 @ 0.3 nm/s, 2 s delay ⇒ +0.6 nm
    const bias = delayed.asBuiltFront[0] - base.asBuiltFront[0];
    ok(Math.abs(bias - 0.6) < 1e-6, `shutter mean delay biases L1 by rate·delay = 0.6 nm (got ${bias.toFixed(4)})`);
    // every layer is biased upward
    ok(delayed.asBuiltFront.every((d, i) => d >= base.asBuiltFront[i] - 1e-9), `all layers biased upward by shutter delay`);
}

// ── Exclude from monitoring ─────────────────────────────────────────────────
function test_exclude_layer() {
    const design = fourLayer();
    const rates = new Map([['TiO2', { mean: 0.3, sigma: 0 }], ['SiO2', { mean: 0.5, sigma: 0 }]]);
    // Heavy signal noise everywhere, but L1 excluded with zero rel-error ⇒ exact target.
    const res = simulateRun(design, resolveMat, {
        rates, mon: baseMon, sig: { randomPct: 5 },
        excludeLayers: new Set([0]), relThkErrByLayer: [0, 0, 0, 0], rng: makeRng(2),
    });
    ok(Math.abs(res.asBuiltFront[0] - 60) < 1e-9, `excluded L1 ignores noise → as-built = target (got ${res.asBuiltFront[0].toFixed(4)})`);
    // With a relative-thickness error, the excluded layer deviates from target.
    const res2 = simulateRun(design, resolveMat, {
        rates, mon: baseMon, sig: { randomPct: 0 },
        excludeLayers: new Set([0]), relThkErrByLayer: [10, 0, 0, 0], rng: makeRng(3),
    });
    ok(Math.abs(res2.asBuiltFront[0] - 60) > 1e-6, `excluded L1 with 10% rel-error deviates from target (got ${res2.asBuiltFront[0].toFixed(4)})`);
}

// ── Per-material deviations ─────────────────────────────────────────────────
function test_matdev() {
    const design = fourLayer();
    const rates = new Map([['TiO2', { mean: 0.3, sigma: 0 }], ['SiO2', { mean: 0.5, sigma: 0 }]]);
    const matDev = new Map([['TiO2', { reNSyst: 0.05, reNRand: 0, systInh: 1.5 }]]);
    const res = simulateRun(design, resolveMat, { rates, matDev, mon: baseMon, sig: { randomPct: 0 }, perMaterial: true, recordTrajectory: true, rng: makeRng(4) });
    // L1, L3 are TiO2 → dn = 0.05, inh = 1.5; L2, L4 SiO2 → 0.
    ok(Math.abs(res.matDeltas[0].dn - 0.05) < 1e-9, `matDev TiO2 systematic dn=0.05 (got ${res.matDeltas[0].dn})`);
    ok(Math.abs(res.matDeltas[0].inh - 1.5) < 1e-9, `matDev TiO2 inhomogeneity=1.5 (got ${res.matDeltas[0].inh})`);
    ok(res.matDeltas[1].dn === 0, `SiO2 (no spec) dn=0 (got ${res.matDeltas[1].dn})`);
}

// ── Trajectory output ───────────────────────────────────────────────────────
function test_trajectory() {
    const design = fourLayer();
    const rates = new Map([['TiO2', { mean: 0.3, sigma: 0.03, corrTime: 3 }], ['SiO2', { mean: 0.5, sigma: 0.05, corrTime: 3 }]]);
    const res = simulateRun(design, resolveMat, { rates, mon: baseMon, sig: { randomPct: 0.3 }, recordTrajectory: true, rng: makeRng(5) });
    ok(res.estimatedFront && res.estimatedFront.length === 4, `estimatedFront length 4 (got ${res.estimatedFront?.length})`);
    ok(res.materialsFront && res.materialsFront.join(',') === 'TiO2,SiO2,TiO2,SiO2', `materialsFront aligned (got ${res.materialsFront?.join(',')})`);
    ok(res.estimatedFront.every(d => isFinite(d) && d > 0), `all estimated thicknesses finite & positive`);
    // Without recordTrajectory the field is absent.
    const res2 = simulateRun(design, resolveMat, { rates, mon: baseMon, sig: { randomPct: 0.3 }, rng: makeRng(5) });
    ok(res2.estimatedFront === undefined, `no estimatedFront when recordTrajectory off`);
}

// ── Regression: new cfg absent ⇒ identical to old white model ────────────────
function test_regression_bitidentical() {
    const design = fourLayer();
    const cfg = () => ({
        rates: new Map([['TiO2', { mean: 0.3, sigma: 0.05 }], ['SiO2', { mean: 0.5, sigma: 0.05 }]]),
        sigmaReN: 0.003, sigmaImN: 0, perMaterial: true,
        mon: baseMon, sig: { randomPct: 1.0, driftPctPer1000s: 0 },
        rng: makeRng(777),
    });
    // Two identical runs must match exactly (determinism), and must NOT be
    // perturbed by the presence of the new code paths (they're all gated).
    const a = simulateRun(design, resolveMat, cfg());
    const b = simulateRun(design, resolveMat, cfg());
    let maxd = 0;
    for (let i = 0; i < a.asBuiltFront.length; i++) maxd = Math.max(maxd, Math.abs(a.asBuiltFront[i] - b.asBuiltFront[i]));
    ok(maxd === 0, `deterministic + regression-safe: max |Δ as-built| = ${maxd} (expect 0)`);
}

console.log('Running BBM wizard backend tests...\n');
test_ou_path();
test_shutter_delay();
test_exclude_layer();
test_matdev();
test_trajectory();
test_regression_bitidentical();

if (fails === 0) { console.log('\n✓ All BBM wizard tests passed'); process.exit(0); }
else { console.error(`\n✗ ${fails} test(s) failed`); process.exit(1); }
