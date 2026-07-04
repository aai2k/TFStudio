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
 * matrix associativity:  M_full = (M_0···M_{i-1}) · M_top = M_base · M_top.
 *
 * Test 1 — the incremental evaluator reproduces a faithful re-implementation of
 *          the old sampleChar (full-stack tmmAvg loop) to the last ULP, across
 *          materials (incl. absorbing), pols (s/p/avg), characteristics (T/R/A),
 *          AOIs, and a range of growing-layer thicknesses incl. 0.
 * Test 2 — simulateRun is deterministic at a fixed seed (regression guard that
 *          the wiring did not introduce any nondeterminism).
 */

import { tmmAvg, createMonitorTmmEvaluator } from '../src/utils/physics/thinFilmMath.js';
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
                            [...completedMats, topMat], [...completedThicks, dTop]);
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
    ok(maxAbs === 0, `incremental evaluator bit-identical to full-stack sampleChar over ${total} samples (max |Δ| = ${maxAbs})`);
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

test_evaluator_bit_identical();
test_first_layer();
test_simulateRun_deterministic();

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll BBM incremental-equivalence tests passed.');
