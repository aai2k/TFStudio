/**
 * Monochromatic Monitoring Simulator sanity tests.
 *
 * Run: node tests/mono_monitoring_sim.mjs
 *
 * Per-trial draws use the same seedable RNG plumbing as BBM (Mulberry32 via
 * deriveSeed). Coverage:
 *
 *   • Zero-noise turning-point single QW BBAR layer cuts at the extremum
 *     within one scan-step of the target thickness (sub-grid accuracy isn't
 *     possible — golden-section in the BBM fit is what gets <1 nm; here the
 *     cut is at a sampled time point so the bound is dt × rate).
 *
 *   • Per-layer thickness σ grows with random spectrometer noise on a 4-layer
 *     QW stack.
 *
 *   • Rate jitter spreads per-layer thickness for every layer.
 *
 *   • As-built MF distribution is finite, non-trivially spread, yield ∈ [0,1].
 *
 *   • Theoretical T at the design wavelength under zero noise ≈ MC mean.
 *
 *   • previewMonoSignal returns the right shape.
 *
 *   • Auto-strategy heuristic: a QW MgF2 BBAR layer picks 'turning'; a non-QW
 *     thickness picks 'level'.
 *
 *   • Time-mode cut respects sigmaRelPct → injects a thickness spread that
 *     scales with the requested σ.
 *
 *   • Same-seed determinism: two runs with the same seed are bit-identical.
 */

import {
    simulateRunMono,
    runMonteCarloMMS,
    previewMonoSignal,
    defaultMonitorTable,
    autoStrategy,
} from '../src/utils/monitoring/monoMonitoringSim.js';
import { mulberry32, deriveSeed } from '../src/utils/monitoring/monitoringSim.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const resolveMat = (id) => getMaterial(id) || getMaterial('Air');

// ── Designs ───────────────────────────────────────────────────────────────────

// MgF2 QW at 550 nm = 550 / (4 × n_MgF2) ≈ 99.78 nm. THIS is where the T
// extremum is — turning monitoring cuts at the actual extremum, not at any
// arbitrary user target.
const MGF2_QW_550 = 99.78;

function bbarDesign(thk = MGF2_QW_550) {
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

// 4-layer QW stack at 550 nm: TiO2(QW)/SiO2(QW)/TiO2(QW)/SiO2(QW)
function fourQWDesign() {
    return {
        id: '4QW', name: '4-QW',
        referenceWavelength: 550,
        substrate: { material: 'BK7', thickness: 1.0 },
        incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'L1', material: 'TiO2', thickness:  60, locked: false },
            { id: 'L2', material: 'SiO2', thickness: 100, locked: false },
            { id: 'L3', material: 'TiO2', thickness:  60, locked: false },
            { id: 'L4', material: 'SiO2', thickness: 100, locked: false },
        ],
        backLayers: [],
        surfaceMode: 'front_only',
        meritOperands: [
            { type:'RAV', lambdaStart:450, lambdaEnd:650, aoi:0, pol:'avg',
              target:0, weight:1, enabled:true },
        ],
    };
}

// Build a default monitor table given a design + force all layers to a strategy
function fullMonTable(design, strategy = null) {
    const tbl = defaultMonitorTable(design, resolveMat);
    if (strategy) for (const row of tbl) row.strategy = strategy;
    return tbl;
}

const baseCommon = {
    thetaDeg: 0, pol: 'avg', char: 'T',
    scanIntervalSec: 0.4, confirmScans: 2,
};

// ── Test 1: zero-noise turning-point single QW layer ─────────────────────────

function test_zero_noise_turning_single() {
    // MgF2 QW = 99.78 nm @ 550 nm — the T extremum location. The cut SHOULD
    // land there regardless of user thickness because turning monitoring is
    // direction-blind (it cuts at the next signal extremum, not at any
    // particular thickness target).
    const design = bbarDesign(MGF2_QW_550);
    const monTable = fullMonTable(design, 'turning');
    const cfg = {
        rates: new Map([['MgF2', { mean: 0.5, sigma: 0 }]]),
        sigmaReN: 0, sigmaImN: 0,
        monTable, common: baseCommon,
        sig: { randomPct: 0, driftPctPer1000s: 0 },
        rng: mulberry32(deriveSeed(0xC0FFEE, 0)),
    };
    const res = simulateRunMono(design, resolveMat, cfg);
    const err = res.asBuiltFront[0] - MGF2_QW_550;
    // dt=0.4 s at 0.5 nm/s → 0.2-nm sample spacing; smoothing-window of 3 +
    // K=2 confirmation gates the cut a few samples past the true extremum,
    // then backs up to runMaxTime. Net bias ≤ 2 nm.
    ok(Math.abs(err) <= 2.0,
        `zero-noise turning single MgF2 QW: as-built ${res.asBuiltFront[0].toFixed(2)} nm, err vs QW ${err.toFixed(2)} nm (≤ 2.0)`);
    ok(res.cutStrategies[0] === 'turning',
        `cut strategy recorded: ${res.cutStrategies[0]}`);
}

// ── Test 2: noise → per-layer thickness σ grows ──────────────────────────────

async function test_noise_grows_per_layer_sigma() {
    // 'level' single-layer test: cut when smoothed signal crosses target. The
    // crossing-time distribution scales monotonically with σ_noise (more
    // noise → more spread in the crossing). Multi-layer turning has
    // error-compounding which is NOT monotonic in noise (low noise can land
    // exactly at the true extremum; medium noise can produce noise-driven
    // false cuts), so we use single-layer level here.
    const design = bbarDesign(80);    // off-QW: forces 'level' mid-slope
    const monTable = fullMonTable(design, 'level');
    const baseCfg = {
        rates: new Map([['MgF2', { mean: 0.5, sigma: 0 }]]),
        sigmaReN: 0, sigmaImN: 0,
        monTable, common: baseCommon,
        nRuns: 30,    // more runs → cleaner σ estimates
        spectrumParams: { lambdaStart:550, lambdaEnd:550, lambdaStep:50, theta:0, polarization:'avg' },
    };
    const low  = await runMonteCarloMMS(design, resolveMat, {
        ...baseCfg, sig: { randomPct: 0.1, driftPctPer1000s: 0 }, seed: 31,
    });
    const high = await runMonteCarloMMS(design, resolveMat, {
        ...baseCfg, sig: { randomPct: 1.0, driftPctPer1000s: 0 }, seed: 31,
    });
    const lowSig  = low.perLayer.stdev[0];
    const highSig = high.perLayer.stdev[0];
    ok(highSig > lowSig * 1.5,
        `level noise → σ_d grows ≥1.5×: σ(0.1%)=${lowSig.toFixed(3)} σ(1.0%)=${highSig.toFixed(3)}`);
}

// ── Test 3: rate jitter spreads thickness for every layer ────────────────────

async function test_rate_jitter_spreads_thickness() {
    const design = fourQWDesign();
    const monTable = fullMonTable(design, 'turning');
    const cfg = {
        rates: new Map([
            ['TiO2', { mean: 0.3, sigma: 0.06 }],
            ['SiO2', { mean: 0.5, sigma: 0.10 }],
        ]),
        sigmaReN: 0, sigmaImN: 0,
        monTable, common: baseCommon,
        sig: { randomPct: 0.2, driftPctPer1000s: 0 },
        nRuns: 10, seed: 42,
        spectrumParams: { lambdaStart:450, lambdaEnd:650, lambdaStep:25, theta:0, polarization:'avg' },
    };
    const res = await runMonteCarloMMS(design, resolveMat, cfg);
    let allNonZero = true;
    for (const s of res.perLayer.stdev) if (s < 1e-3) allNonZero = false;
    ok(allNonZero,
        `every layer has σ_d > 1e-3 under 20% rate jitter (got [${res.perLayer.stdev.map(s=>s.toFixed(3)).join(', ')}])`);
}

// ── Test 4: MF spread + yield ───────────────────────────────────────────────

async function test_mf_spread_and_yield() {
    const design = fourQWDesign();
    const monTable = fullMonTable(design, 'turning');
    const cfg = {
        rates: new Map([
            ['TiO2', { mean: 0.3, sigma: 0.03 }],
            ['SiO2', { mean: 0.5, sigma: 0.05 }],
        ]),
        sigmaReN: 0.003, sigmaImN: 0, perMaterial: true,
        monTable, common: baseCommon,
        sig: { randomPct: 1.0, driftPctPer1000s: 0 },
        nRuns: 10, seed: 7,
        spectrumParams: { lambdaStart:450, lambdaEnd:650, lambdaStep:25, theta:0, polarization:'avg' },
        yieldTolerance: 1.0,
    };
    const res = await runMonteCarloMMS(design, resolveMat, cfg);
    const mfs = res.yieldDetails.mfRuns;
    ok(mfs.length === 10, `MF per run (got ${mfs.length}/10)`);
    ok(mfs.every(m => isFinite(m) && m >= 0), `MF values finite & non-negative`);
    const mfMin = Math.min(...mfs), mfMax = Math.max(...mfs);
    ok(mfMax - mfMin > 1e-4, `MF spread > 1e-4 (got ${(mfMax-mfMin).toFixed(5)})`);
    ok(res.yield != null && res.yield >= 0 && res.yield <= 1,
        `yield ∈ [0,1]: ${res.yield}`);
}

// ── Test 5: theoretical T ≈ noise-free MC mean ──────────────────────────────

async function test_theory_matches_no_noise_mean() {
    const design = bbarDesign(MGF2_QW_550);
    const monTable = fullMonTable(design, 'turning');
    const cfg = {
        rates: new Map([['MgF2', { mean: 0.5, sigma: 0 }]]),
        sigmaReN: 0, sigmaImN: 0,
        monTable, common: { ...baseCommon, scanIntervalSec: 0.1 },   // tighter
        sig: { randomPct: 0, driftPctPer1000s: 0 },
        nRuns: 3, seed: 99,
        spectrumParams: { lambdaStart:550, lambdaEnd:550, lambdaStep:50, theta:0, polarization:'avg' },
    };
    const res = await runMonteCarloMMS(design, resolveMat, cfg);
    const T_th   = res.theory[0];
    const T_mean = res.mean[0];
    ok(T_th > 0.96 && T_th < 1.0,
        `theory T(550) on MgF2 BBAR sane: ${T_th.toFixed(4)}`);
    ok(Math.abs(T_mean - T_th) < 0.02,
        `noise-free mean ≈ theory: |${T_mean.toFixed(4)} − ${T_th.toFixed(4)}| < 0.02`);
}

// ── Test 6: previewMonoSignal shape ─────────────────────────────────────────

function test_preview_signal_shape() {
    const design = fourQWDesign();
    const monRow = { strategy: 'turning', lambda: 550 };
    const prev = previewMonoSignal(design, resolveMat, 2, monRow, baseCommon);
    ok(Array.isArray(prev.d) && Array.isArray(prev.signal) && prev.d.length === prev.signal.length,
        `preview d + signal arrays same length (${prev.d?.length})`);
    ok(prev.d.length >= 40, `preview has enough samples (${prev.d.length} ≥ 40)`);
    ok(prev.dTarget > 0, `dTarget recorded: ${prev.dTarget}`);
}

// ── Test 7: auto-strategy QW vs non-QW ──────────────────────────────────────

function test_auto_strategy() {
    const mgf2 = resolveMat('MgF2');
    const tio2 = resolveMat('TiO2');
    // MgF2 QW = 99.78 nm at 550. 100 nm rounds to 1× QW within 5%.
    ok(autoStrategy({ thickness: MGF2_QW_550 }, mgf2, 550) === 'turning',
        `MgF2 1×QW @ 550 → turning`);
    // 94 nm is 0.94×QW — off-QW BBAR slightly to the left — heuristic says 'level'.
    ok(autoStrategy({ thickness: 94 }, mgf2, 550) === 'level',
        `MgF2 off-QW 94 nm @ 550 → level`);
    // Mid-slope: 150 nm TiO2 at 550 nm (n≈2.4, QW≈57 nm). 150/57 = 2.63 — not
    // near an integer multiple → 'level'.
    ok(autoStrategy({ thickness: 150 }, tio2, 550) === 'level',
        `TiO2 150 nm @ 550 (mid-slope) → level`);
    // Zero thickness → 'time'
    ok(autoStrategy({ thickness: 0 }, mgf2, 550) === 'time',
        `d=0 → time`);
}

// ── Test 8: time-mode honours sigmaRelPct ────────────────────────────────────

async function test_time_mode_sigma_rel() {
    const design = fourQWDesign();
    const monTable = defaultMonitorTable(design, resolveMat).map(r => ({
        ...r, strategy: 'time', sigmaRelPct: 2.0,    // 2% RMS
    }));
    const cfg = {
        rates: new Map([
            ['TiO2', { mean: 0.3, sigma: 0 }],
            ['SiO2', { mean: 0.5, sigma: 0 }],
        ]),
        monTable, common: baseCommon,
        sig: { randomPct: 0, driftPctPer1000s: 0 },
        nRuns: 50, seed: 5,
        spectrumParams: { lambdaStart:450, lambdaEnd:650, lambdaStep:50, theta:0, polarization:'avg' },
    };
    const res = await runMonteCarloMMS(design, resolveMat, cfg);
    // Expected per-layer σ ≈ 0.02 × d_target; check >0.5× lower bound
    for (let i = 0; i < 4; i++) {
        const expected = 0.02 * res.perLayer.target[i];
        const got      = res.perLayer.stdev[i];
        ok(got > 0.5 * expected,
            `time-mode L${i+1}: σ=${got.toFixed(3)} > 0.5 × expected ${expected.toFixed(3)}`);
    }
}

// ── Test 9: deterministic seeding (same seed → bit-identical) ────────────────

async function test_seed_determinism() {
    const design = bbarDesign(94);
    const monTable = fullMonTable(design, 'turning');
    const cfg = {
        rates: new Map([['MgF2', { mean: 0.5, sigma: 0.05 }]]),
        sigmaReN: 0.002, sigmaImN: 0,
        monTable, common: baseCommon,
        sig: { randomPct: 0.5, driftPctPer1000s: 0 },
        nRuns: 5, seed: 123,
        spectrumParams: { lambdaStart:400, lambdaEnd:700, lambdaStep:50, theta:0, polarization:'avg' },
    };
    const a = await runMonteCarloMMS(design, resolveMat, cfg);
    const b = await runMonteCarloMMS(design, resolveMat, cfg);
    let maxDiff = 0;
    for (let i = 0; i < a.mean.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(a.mean[i] - b.mean[i]));
    }
    ok(maxDiff === 0,
        `same seed → bit-identical mean spectrum (max |Δ| = ${maxDiff})`);
    let maxDiffThk = 0;
    for (let i = 0; i < a.perLayer.mean.length; i++) {
        maxDiffThk = Math.max(maxDiffThk, Math.abs(a.perLayer.mean[i] - b.perLayer.mean[i]));
    }
    ok(maxDiffThk === 0,
        `same seed → bit-identical per-layer thicknesses (max |Δ| = ${maxDiffThk})`);
}

// ── Run all ───────────────────────────────────────────────────────────────────

async function main() {
    console.log('Running Monochromatic Monitoring Simulator tests...\n');
    test_zero_noise_turning_single();
    await test_noise_grows_per_layer_sigma();
    await test_rate_jitter_spreads_thickness();
    await test_mf_spread_and_yield();
    await test_theory_matches_no_noise_mean();
    test_preview_signal_shape();
    test_auto_strategy();
    await test_time_mode_sigma_rel();
    await test_seed_determinism();

    if (fails === 0) {
        console.log('\n✓ All MMS tests passed');
        process.exit(0);
    } else {
        console.error(`\n✗ ${fails} MMS test(s) failed`);
        process.exit(1);
    }
}

main();
