/**
 * Broadband monitor evaluator: WASM growing evaluator against the JS path.
 *
 * The BBM run samples a full spectrum of the growing stack per scan through
 * createMonitorTmmEvaluator. With the tmmcore growing evaluator present that
 * call keeps the completed stack's products in kernel memory; without it the
 * same arithmetic runs in JavaScript. Both must agree, sample for sample, over
 * chars, polarizations, slab and semi-infinite substrates, oblique incidence
 * and a change of growing material on a live evaluator.
 *
 * Run: node tests/bbm_evaluator_wasm.mjs
 */
import { createMonitorTmmEvaluator } from '../src/utils/physics/thinFilmMath.js';
import { setTmmWasmEnabled } from 'tmmcore';
import { initWasmForTest, getTmmWasm } from './_wasmInit.mjs';

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const mk = (name, n, c = 0, k = 0) => ({ name, getNK: lam => [n + c / (lam * lam) * 1e5, k] });
const MATS = {
    Air: mk('Air', 1.0),
    BK7: mk('BK7', 1.51, 0.42),
    H: mk('H', 2.28, 1.2, 0.0004),
    L: mk('L', 1.45, 0.35),
};

const active = await initWasmForTest();
if (!active || typeof getTmmWasm().hasGrowingEval !== 'function' || !getTmmWasm().hasGrowingEval()) {
    console.log('SKIP  tmmcore build predates the growing evaluator (needs tmmcore >= 0.3.0)');
    process.exit(0);
}

// Float64Array on purpose: simulateRun hands the scan grid to the evaluator
// as one, and a typed array's map() coerces [n, k] pairs to NaN, which is a
// break a plain-Array grid would never catch.
const lambdas = Float64Array.from({ length: 41 }, (_, i) => 420 + i * 9);
const base30 = Array.from({ length: 30 }, (_, i) => (i % 2 ? MATS.L : MATS.H));
const thick30 = base30.map((m, i) => (i === 4 ? 0 : i % 2 ? 94.2 : 58.5));  // one zero-thickness layer

const CASES = [
    { name: 'slab, normal', theta: 0, subThickMM: 1 },
    { name: 'slab, 30 deg', theta: 30, subThickMM: 1 },
    { name: 'semi-infinite, 15 deg', theta: 15, subThickMM: null },
];
const D = [0, 3.7, 58.5, 121.4];

let worst = 0;
for (const { name, theta, subThickMM } of CASES) {
    setTmmWasmEnabled(false);
    const js = createMonitorTmmEvaluator(theta, MATS.Air, MATS.BK7, base30, thick30, lambdas, subThickMM);
    setTmmWasmEnabled(true);
    const wa = createMonitorTmmEvaluator(theta, MATS.Air, MATS.BK7, base30, thick30, lambdas, subThickMM);
    for (const top of [MATS.H, MATS.L]) {           // second material exercises setTop on a live handle
        for (const d of D) {
            for (const char of ['R', 'T', 'A']) {
                for (const pol of ['s', 'p', 'avg']) {
                    const a = js.sample(char, pol, top, d);
                    const b = wa.sample(char, pol, top, d);
                    for (let li = 0; li < lambdas.length; li++) {
                        worst = Math.max(worst, Math.abs(a[li] - b[li]));
                    }
                }
            }
        }
    }
    wa.free();
    console.log(`     ${name}: checked`);
}
console.log(`     worst |Δ| across ${CASES.length} systems = ${worst.toExponential(2)}`);
ok(worst < 1e-12, 'WASM growing evaluator matches the JS evaluator');

// A BBM-shaped workload: one layer's scan loop, a spectrum per scan plus the
// fit's model probes, against a deep completed stack.
const SCANS = 400, PROBES = 8;
function scanWorkload() {
    const ev = createMonitorTmmEvaluator(0, MATS.Air, MATS.BK7, base30, thick30, lambdas, 1);
    let acc = 0;
    for (let k = 1; k <= SCANS; k++) {
        const s = ev.sample('T', 'avg', MATS.H, k * 0.25);
        acc += s[0];
        for (let f = 0; f < PROBES; f++) acc += ev.sample('T', 'avg', MATS.H, k * 0.25 + f * 0.01)[7];
    }
    ev.free?.();
    return acc;
}
setTmmWasmEnabled(false);
let t0 = performance.now();
scanWorkload();
const tJs = performance.now() - t0;
setTmmWasmEnabled(true);
t0 = performance.now();
scanWorkload();
const tWa = performance.now() - t0;
console.log(`     scan workload (${SCANS} scans × ${1 + PROBES} spectra, 41 λ, 30-layer base): JS ${tJs.toFixed(0)} ms, WASM ${tWa.toFixed(0)} ms`);
ok(tWa < tJs, 'WASM path is faster on the scan workload');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
