/**
 * BBM incremental fast-algorithm equivalence test.
 *
 * Run: node tests/bbm_incremental_equivalence.mjs
 *
 * The Monte-Carlo / single-run monitoring simulator (monitoringSim.simulateRun)
 * used to recompute the FULL layer stack on every monitoring scan and every
 * golden-section thickness-fit step (sampleChar → tmmAvg over all built layers).
 * It now caches the completed-stack characteristic-matrix product once per layer
 * and varies only the growing top layer per evaluation — the O(1)-per-scan
 * "fast" control idea (createMonitorTmmEvaluator in thinFilmMath.js).
 *
 * This is supposed to be BIT-IDENTICAL to the old full-stack sampleChar, by
 * matrix associativity:  M_full = M_top · (M_0···M_{i-1}) = M_top · M_base.
 * The growing layer leads the product because it faces the incident medium:
 * already-deposited layers lie beneath it, toward the substrate.
 *
 * Test 1 — the incremental evaluator reproduces a faithful re-implementation of
 *          the old sampleChar (full-stack tmmAvg loop) to within floating-point
 *          association error, across materials (incl. absorbing), pols (s/p/avg),
 *          characteristics (T/R/A), AOIs, and growing-layer thicknesses incl. 0.
 * Test 2 — the evaluator's witness-chip slab mode (coated front + bare back,
 *          incoherent sum) matches tmmTotalAvg, whose reverse pass runs the
 *          reversed stack explicitly rather than off the anti-transposed matrix.
 * Test 3 — simulateRun is deterministic at a fixed seed, no chip glass means
 *          the design substrate, and the monitor's estimates react to the glass.
 */

import { tmmAvg, tmmTotalAvg, createMonitorTmmEvaluator } from '../src/utils/physics/thinFilmMath.js';
import { simulateRun } from '../src/utils/monitoring/monitoringSim.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ok:', msg); } };

const resolveMat = (id) => getMaterial(id) || getMaterial('Air');

// Faithful re-implementation of monitoringSim's private sampleChar() — the OLD
// full-stack path. (Kept here verbatim so the test is independent of the source.)
function refSample(lambdas, theta, pol, char, incMat, subMat, frontMats, frontThicks) {
    const out = new Float64Array(lambdas.length);
    const layers = [];
    for (let i = 0; i < frontMats.length; i++) {
        if (frontThicks[i] > 0) layers.push({ mat: frontMats[i], d: frontThicks[i] });
    }
    for (let li = 0; li < lambdas.length; li++) {
        const lam = lambdas[li];
        const n0 = incMat.getNK(lam);
        const ns = subMat.getNK(lam);
        const lNDs = layers.map(l => ({ n: l.mat.getNK(lam), d: l.d }));
        const res = tmmAvg(lam, theta, n0, ns, lNDs);
        let v;
        if (char === 'T')      v = pol === 's' ? res.Ts : pol === 'p' ? res.Tp : res.T;
        else if (char === 'R') v = pol === 's' ? res.Rs : pol === 'p' ? res.Rp : res.R;
        else                   v = pol === 's' ? res.As : pol === 'p' ? res.Ap : res.A;
        out[li] = v;
    }
    return out;
}

function test_evaluator_bit_identical() {
    const incMat = resolveMat('Air');
    const subMat = resolveMat('BK7');
    const completedMats = [resolveMat('TiO2'), resolveMat('SiO2'), resolveMat('Cr')]; // Cr = absorbing (k>0)
    const completedThicks = [62.3, 104.1, 8.7];
    const topMats = [resolveMat('SiO2'), resolveMat('TiO2'), resolveMat('Ag')];

    const lambdas = [];
    for (let i = 0; i < 17; i++) lambdas.push(400 + i * 25);   // 400..800 nm

    let maxAbs = 0;
    let total = 0;
    for (const theta of [0, 30, 45]) {
        for (const pol of ['s', 'p', 'avg']) {
            for (const char of ['T', 'R', 'A']) {
                const ev = createMonitorTmmEvaluator(theta, incMat, subMat, completedMats, completedThicks, lambdas);
                for (const topMat of topMats) {
                    for (const dTop of [0, 0.5, 17.25, 88.0, 250.0]) {
                        const got = ev.sample(char, pol, topMat, dTop);
                        const ref = refSample(lambdas, theta, pol, char, incMat, subMat,
                            [topMat, ...completedMats], [dTop, ...completedThicks]);
                        for (let li = 0; li < lambdas.length; li++) {
                            const d = Math.abs(got[li] - ref[li]);
                            if (d > maxAbs) maxAbs = d;
                            total++;
                        }
                    }
                }
            }
        }
    }
    // The cached factor is the SUFFIX product (the completed layers beneath the
    // growing one) while the reference loop associates left-to-right from the
    // incident side, so the two group the same complex multiplies differently.
    // Matrix multiplication is exactly associative in ℝ but not in floating
    // point, leaving a few ULP. Any real ordering/geometry error is ~1e-1 here,
    // so this bound still fails loudly on one.
    const ASSOC_TOL = 1e-12;
    ok(maxAbs < ASSOC_TOL,
        `incremental evaluator matches full-stack sampleChar to floating-point association over ${total} samples (max |Δ| = ${maxAbs.toExponential(2)}, tol ${ASSOC_TOL.toExponential(0)})`);
}

// Also exercise the empty-completed-stack case (first layer being deposited).
function test_first_layer() {
    const incMat = resolveMat('Air');
    const subMat = resolveMat('BK7');
    const lambdas = [450, 550, 650, 750];
    let maxAbs = 0;
    const ev = createMonitorTmmEvaluator(0, incMat, subMat, [], [], lambdas);
    const top = resolveMat('TiO2');
    for (const dTop of [0, 1, 40, 120]) {
        const got = ev.sample('T', 'avg', top, dTop);
        const ref = refSample(lambdas, 0, 'avg', 'T', incMat, subMat, [top], [dTop]);
        for (let li = 0; li < lambdas.length; li++) maxAbs = Math.max(maxAbs, Math.abs(got[li] - ref[li]));
    }
    ok(maxAbs === 0, `first-layer (empty base) bit-identical (max |Δ| = ${maxAbs})`);
}

function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

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

function test_simulateRun_deterministic() {
    const design = fourLayer();
    const rates = new Map([['TiO2', { mean: 0.3, sigma: 0.02 }], ['SiO2', { mean: 0.5, sigma: 0.03 }]]);
    const mon = { char: 'T', theta: 0, polarization: 'avg', lambdaStart: 400, lambdaEnd: 800, nPoints: 15, scanIntervalSec: 0.4 };
    const cfgA = { rates, mon, sig: { randomPct: 0.5 }, rng: makeRng(777) };
    const cfgB = { rates, mon, sig: { randomPct: 0.5 }, rng: makeRng(777) };
    const a = simulateRun(design, resolveMat, cfgA);
    const b = simulateRun(design, resolveMat, cfgB);
    let maxAbs = 0;
    for (let i = 0; i < a.asBuiltFront.length; i++) maxAbs = Math.max(maxAbs, Math.abs(a.asBuiltFront[i] - b.asBuiltFront[i]));
    ok(a.asBuiltFront.every(Number.isFinite), 'simulateRun produces finite as-built thicknesses');
    ok(maxAbs === 0, `simulateRun is deterministic at fixed seed (max |Δ as-built| = ${maxAbs})`);
}

// The witness-chip slab mode: the evaluator's reverse pass comes from the
// anti-transposed cached matrix, and this must reproduce tmmTotalAvg, which
// runs the reversed stack explicitly. The two re-derive the substrate-side
// angle differently (a real-angle re-entry with a degree/asin round trip
// against reuse of the complex-continuity matrices), and near-cancelling
// reflection numerators amplify the last-ulp difference to ~1e-10 on a
// dispersive high-index stack at oblique incidence. Any error in the
// anti-transpose or the back-face/bulk combination shows up at ~1e-2.
function test_evaluator_slab_mode() {
    const incMat = resolveMat('Air');
    const subMat = resolveMat('BK7');
    const completedMats = [resolveMat('SiO2'), resolveMat('TiO2')];
    const completedThicks = [104.1, 62.3];
    const top = resolveMat('TiO2');
    const lambdas = [420, 550, 680, 780];
    let maxAbs = 0;
    for (const theta of [0, 30]) {
        const ev = createMonitorTmmEvaluator(theta, incMat, subMat, completedMats, completedThicks, lambdas, 1);
        for (const char of ['T', 'R', 'A']) {
            for (const dTop of [0, 42.5, 130]) {
                const got = ev.sample(char, 'avg', top, dTop);
                for (let li = 0; li < lambdas.length; li++) {
                    const lam = lambdas[li];
                    const front = [{ n: top.getNK(lam), d: dTop },
                                   ...completedMats.map((m, k) => ({ n: m.getNK(lam), d: completedThicks[k] }))];
                    const ref = tmmTotalAvg(lam, theta,
                        { incident: incMat.getNK(lam), substrate: subMat.getNK(lam), exit: incMat.getNK(lam) },
                        { front, back: [] }, 1);
                    maxAbs = Math.max(maxAbs, Math.abs(got[li] - ref[char]));
                }
            }
        }
    }
    ok(maxAbs < 1e-8,
        `slab-mode evaluator matches tmmTotalAvg's explicit reversed-stack pass (max |Δ| = ${maxAbs.toExponential(2)})`);
}

// The run reads the witness chip, and the chip's glass is selectable: the
// monitor's thickness estimate must react to the glass under it, and no
// chipMaterial must mean exactly the design substrate.
function test_simulateRun_chip_glass() {
    const design = fourLayer();
    const rates = new Map([['TiO2', { mean: 0.3, sigma: 0.02 }], ['SiO2', { mean: 0.5, sigma: 0.03 }]]);
    const runOn = (chipMaterial) => simulateRun(design, resolveMat, {
        rates,
        mon: { char: 'T', theta: 0, polarization: 'avg', chipMaterial,
               lambdaStart: 400, lambdaEnd: 800, nPoints: 15, scanIntervalSec: 0.4 },
        sig: { randomPct: 0.5 }, rng: makeRng(777), recordTrajectory: true,
    });
    const onSub = runOn(null);
    const onBK7 = runOn('BK7');
    const onSi = runOn('Si');
    let same = true;
    let differs = false;
    for (let i = 0; i < onSub.estimatedFront.length; i++) {
        if (onSub.estimatedFront[i] !== onBK7.estimatedFront[i]) same = false;
        if (onSub.estimatedFront[i] !== onSi.estimatedFront[i]) differs = true;
    }
    ok(same, 'no chip glass means the design substrate');
    ok(differs, "the monitor's thickness estimates react to the chip glass");
}

test_evaluator_bit_identical();
test_first_layer();
test_evaluator_slab_mode();
test_simulateRun_deterministic();
test_simulateRun_chip_glass();

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll BBM incremental-equivalence tests passed.');
