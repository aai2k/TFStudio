/**
 * Layer Sensitivity + Monte Carlo Error Analysis sanity tests.
 *
 * Run: node tests/error_analysis_layer_sensitivity.mjs
 *
 * These are *behavioral* tests, not bit-identity checks — Monte Carlo is
 * inherently stochastic. We use a seeded RNG so the runs are reproducible,
 * then assert that the well-defined properties hold:
 *
 *   • Layer Sensitivity:
 *       - Single-layer MgF2 BBAR at λ₀/4 design has |ΔMF| > 0 (it should be
 *         the rank-1 layer since it's the only variable).
 *       - In a 3-layer stack with one locked layer, includeLocked=false
 *         skips the locked one.
 *       - The sensitivity ranking is invariant under absolute vs relative
 *         probe at small Δd (signed gradient stays the same direction).
 *
 *   • Error Analysis:
 *       - With σ = 0 everywhere, mean(λ) ≡ theory(λ) and stdev = 0.
 *       - With σ_thk > 0, stdev > 0 in the band but mean stays near theory.
 *       - The corridor width grows monotonically with σ_thk (roughly
 *         linearly for small perturbations — first-order propagation).
 */

import { computeLayerSensitivity, runErrorAnalysisMC } from '../src/utils/physics/errorAnalysis.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

// ── Seeded RNG: Mulberry32 ────────────────────────────────────────────────────
function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Resolver ───────────────────────────────────────────────────────────────────
const resolveMat = (id) => getMaterial(id) || getMaterial('Air');

// ── Designs ───────────────────────────────────────────────────────────────────

// Single-layer MgF2 quarter-wave BBAR at 550 nm — classic basin around d≈94 nm.
function singleLayerBBAR(thk_nm = 94) {
    return {
        id: 'bbar1',
        name: 'BBAR-1',
        referenceWavelength: 550,
        substrate: { material: 'BK7', thickness: 1.0 },
        incidentMedium: 'Air',
        exitMedium:     'Air',
        frontLayers: [{ id: 'L1', material: 'MgF2', thickness: thk_nm, locked: false }],
        backLayers:  [],
        surfaceMode: 'front_only',
        meritOperands: [
            { type:'RAV', lambdaStart:400, lambdaEnd:700, aoi:0, pol:'avg', target:0, weight:1, enabled:true },
        ],
    };
}

// 3-layer stack with one locked layer
function threeLayer() {
    return {
        id: '3L',
        name: '3-layer',
        referenceWavelength: 550,
        substrate: { material: 'BK7', thickness: 1.0 },
        incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'A', material: 'TiO2', thickness: 60,  locked: false },
            { id: 'B', material: 'SiO2', thickness: 100, locked: true  },
            { id: 'C', material: 'TiO2', thickness: 50,  locked: false },
        ],
        backLayers: [],
        surfaceMode: 'front_only',
        meritOperands: [
            { type:'RAV', lambdaStart:400, lambdaEnd:700, aoi:0, pol:'avg', target:0, weight:1, enabled:true },
        ],
    };
}

// ── Layer sensitivity tests ───────────────────────────────────────────────────

console.log('— Layer Sensitivity —');

const d1 = singleLayerBBAR(94);
const r1 = computeLayerSensitivity(d1, d1.meritOperands, resolveMat,
    { mode: 'relative', relPct: 1 });
ok(r1.rows.length === 1, `single-layer: 1 sensitivity row (got ${r1.rows.length})`);
ok(r1.mf0 >= 0,         `single-layer: mf0 ≥ 0 (got ${r1.mf0})`);
ok(r1.rows[0].deltaMFAbs > 0, `single-layer: |ΔMF| > 0 (got ${r1.rows[0].deltaMFAbs})`);
ok(near(r1.rows[0].sensitivity, 100, 1e-9),
   `single-layer: rank-1 = 100% (got ${r1.rows[0].sensitivity})`);

// Locked-layer exclusion
const d3 = threeLayer();
const r3a = computeLayerSensitivity(d3, d3.meritOperands, resolveMat,
    { mode: 'relative', relPct: 1, includeLocked: false });
ok(r3a.rows.length === 2,
   `3-layer / includeLocked=false: 2 rows (got ${r3a.rows.length})`);
ok(r3a.rows.every(r => !r.locked),
   `3-layer / includeLocked=false: no locked rows`);

const r3b = computeLayerSensitivity(d3, d3.meritOperands, resolveMat,
    { mode: 'relative', relPct: 1, includeLocked: true });
ok(r3b.rows.length === 3,
   `3-layer / includeLocked=true: 3 rows (got ${r3b.rows.length})`);
const lockedRow = r3b.rows.find(r => r.locked);
ok(lockedRow != null, `3-layer / includeLocked=true: locked row present`);

// Sensitivity sign invariance (absolute vs relative probe at small d)
const r3c = computeLayerSensitivity(d3, d3.meritOperands, resolveMat,
    { mode: 'absolute', absDeltaNm: 0.5 });
const r3d = computeLayerSensitivity(d3, d3.meritOperands, resolveMat,
    { mode: 'relative', relPct: 0.5 });
for (let i = 0; i < r3c.rows.length; i++) {
    if (Math.abs(r3c.rows[i].deltaMF) > 1e-12 && Math.abs(r3d.rows[i].deltaMF) > 1e-12) {
        ok(Math.sign(r3c.rows[i].deltaMF) === Math.sign(r3d.rows[i].deltaMF),
           `3-layer: sign(ΔMF) consistent across abs/rel probes at layer ${i}`);
    }
}

// Max sensitivity is exactly 100 %
const maxS = Math.max(...r3b.rows.map(r => r.sensitivity));
ok(near(maxS, 100, 1e-9), `3-layer: max sensitivity = 100% (got ${maxS})`);

// Negative absolute Δd is a step *magnitude*: |Δd| must give the SAME
// sensitivity as +Δd (regression for the "negative Δd → all sensitivities 0"
// bug, where a negative central-difference span collapsed every dMF to 0).
const r3pos = computeLayerSensitivity(d3, d3.meritOperands, resolveMat,
    { mode: 'absolute', absDeltaNm:  0.7 });
const r3neg = computeLayerSensitivity(d3, d3.meritOperands, resolveMat,
    { mode: 'absolute', absDeltaNm: -0.7 });
ok(r3neg.rows.some(r => r.deltaMFAbs > 1e-12),
   `negative Δd: still computes non-zero sensitivity (not all-zero)`);
for (let i = 0; i < r3pos.rows.length; i++) {
    ok(near(r3neg.rows[i].deltaMF, r3pos.rows[i].deltaMF, 1e-12),
       `negative Δd: dMF[${i}] matches +Δd (|Δd| magnitude, got ${r3neg.rows[i].deltaMF} vs ${r3pos.rows[i].deltaMF})`);
    ok(near(r3neg.rows[i].deltaNm, 0.7, 1e-12),
       `negative Δd: reported Δd[${i}] is the magnitude 0.7 (got ${r3neg.rows[i].deltaNm})`);
}

// ── Error analysis tests ──────────────────────────────────────────────────────

console.log('— Error Analysis —');

const params = { lambdaStart: 450, lambdaEnd: 650, lambdaStep: 25, theta: 0, polarization: 'avg' };

// 1) σ = 0 ⇒ mean = theory, stdev = 0
const eaZero = await runErrorAnalysisMC(d1, params, resolveMat, {
    char: 'R', evalMode: 'front', nTrials: 5,
    rmsAbsNm: 0, rmsRelPct: 0, rmsReN: 0, rmsImN: 0,
    rng: makeRng(42),
});
for (let i = 0; i < eaZero.lambda.length; i++) {
    ok(near(eaZero.mean[i], eaZero.theory[i], 1e-12),
       `σ=0: mean[${i}] = theory[${i}] (got Δ ${Math.abs(eaZero.mean[i] - eaZero.theory[i])})`);
    ok(near(eaZero.stdev[i], 0, 1e-12),
       `σ=0: stdev[${i}] = 0 (got ${eaZero.stdev[i]})`);
}

// 2) σ_thk > 0 ⇒ stdev > 0 somewhere, mean near theory
const eaThk = await runErrorAnalysisMC(d1, params, resolveMat, {
    char: 'R', evalMode: 'front', nTrials: 300,
    rmsAbsNm: 0, rmsRelPct: 2, rmsReN: 0, rmsImN: 0,
    rng: makeRng(7),
});
const maxStd  = Math.max(...eaThk.stdev);
ok(maxStd > 1e-6, `σ_thk=2%: stdev grows (max σ(R) = ${maxStd.toExponential(2)})`);

// Mean ≠ theory in general — at a BBAR minimum d²R/dd² > 0 makes E[R] > R_theo
// (Jensen's inequality / second-moment bias). What we *can* assert is that
// the bias is bounded by a small multiple of the corridor width:
//     |mean − theory|  ≲  σ
// (it's actually ~½·R''·σ_d², which for σ_d ~ a few nm is comparable to σ_R).
for (let i = 0; i < eaThk.lambda.length; i++) {
    const bias = Math.abs(eaThk.mean[i] - eaThk.theory[i]);
    ok(bias <= 2 * eaThk.stdev[i] + 1e-6,
       `σ_thk=2%, N=300: |mean − theory|[${i}] ≤ 2·σ (got bias ${bias.toExponential(2)}, σ ${eaThk.stdev[i].toExponential(2)})`);
}

// 3) Corridor width grows with σ_thk (rough linearity check)
const eaSmall = await runErrorAnalysisMC(d1, params, resolveMat, {
    char: 'R', evalMode: 'front', nTrials: 400,
    rmsAbsNm: 0, rmsRelPct: 1, rmsReN: 0, rmsImN: 0,
    rng: makeRng(7),
});
const eaLarge = await runErrorAnalysisMC(d1, params, resolveMat, {
    char: 'R', evalMode: 'front', nTrials: 400,
    rmsAbsNm: 0, rmsRelPct: 3, rmsReN: 0, rmsImN: 0,
    rng: makeRng(7),
});
const meanStdSmall = eaSmall.stdev.reduce((s, v) => s + v, 0) / eaSmall.stdev.length;
const meanStdLarge = eaLarge.stdev.reduce((s, v) => s + v, 0) / eaLarge.stdev.length;
ok(meanStdLarge > meanStdSmall,
   `corridor grows with σ_thk: <σ(R)> 1% → 3% (got ${meanStdSmall.toExponential(2)} → ${meanStdLarge.toExponential(2)})`);

// First-order propagation: σ_R scales ~linearly with σ_thk for small probes.
// Tolerate ±25% slack — second-order curvature and BBAR-design specifics make
// it not exactly 3× but it should be solidly between 2× and 4× for σ_thk=1% → 3%.
const ratio = meanStdLarge / Math.max(meanStdSmall, 1e-30);
ok(ratio > 2.0 && ratio < 4.0,
   `corridor scales ~linearly with σ_thk: ratio ∈ [2, 4] (got ${ratio.toFixed(2)})`);

// 4) Index errors alone also produce a non-trivial corridor on an MgF2 layer
const eaN = await runErrorAnalysisMC(d1, params, resolveMat, {
    char: 'R', evalMode: 'front', nTrials: 300,
    rmsAbsNm: 0, rmsRelPct: 0, rmsReN: 0.01, rmsImN: 0,
    rng: makeRng(11),
});
ok(Math.max(...eaN.stdev) > 1e-7,
   `σ_Re(n)=0.01: stdev > 0 (got ${Math.max(...eaN.stdev).toExponential(2)})`);

// 5) Output corridor bounds are within [0, 1] after clipping
for (let i = 0; i < eaThk.lambda.length; i++) {
    ok(eaThk.lower[i] >= 0 && eaThk.upper[i] <= 1,
       `corridor clipped to [0,1] at λ[${i}]`);
}

// ── Done ──────────────────────────────────────────────────────────────────────
console.log(fails === 0 ? 'PASS: error_analysis_layer_sensitivity' : `${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
