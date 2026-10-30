/**
 * Broadband monitor evaluator against the full-stack spectrum.
 *
 * The BBM run samples a full spectrum of the growing stack per scan through
 * createMonitorTmmEvaluator, which keeps the completed stack's products in
 * kernel memory and multiplies the growing layer on. The spectrum of the whole
 * stack built afresh must agree with it, sample for sample, over chars,
 * polarizations, slab and semi-infinite substrates, oblique incidence and a
 * change of growing material on a live evaluator. The two group their matrix
 * products differently, so they agree to round-off rather than bit for bit.
 *
 * Run: node tests/bbm_evaluator_wasm.mjs
 */
import './_kernel.mjs';
import {
    createMonitorTmmEvaluator, evaluateSpectrumAt, evaluateSpectrumTotalAt,
} from '../src/utils/physics/thinFilmMath.js';

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const mk = (name, n, c = 0, k = 0) => ({ name, getNK: lam => [n + c / (lam * lam) * 1e5, k] });
const MATS = {
    Air: mk('Air', 1.0),
    BK7: mk('BK7', 1.51, 0.42),
    H: mk('H', 2.28, 1.2, 0.0004),
    L: mk('L', 1.45, 0.35),
};

// Float64Array on purpose: simulateRun hands the scan grid to the evaluator
// as one, and a typed array's map() coerces [n, k] pairs to NaN, which is a
// break a plain-Array grid would never catch.
const lambdas = Float64Array.from({ length: 41 }, (_, i) => 420 + i * 9);
const base30 = Array.from({ length: 30 }, (_, i) => (i % 2 ? MATS.L : MATS.H));
const thick30 = base30.map((m, i) => (i === 4 ? 0 : i % 2 ? 94.2 : 58.5));  // one zero-thickness layer

// The whole stack's spectrum, the growing layer facing the incident medium.
// A slab's back face is bare and looks back into the chamber's medium.
function fullStack(theta, pol, top, d, subThickMM) {
    const layers = [{ material: top, thickness: d },
        ...base30.map((material, i) => ({ material, thickness: thick30[i] }))];
    const grid = Array.from(lambdas);
    const params = { theta, polarization: pol };
    return subThickMM == null
        ? evaluateSpectrumAt(grid, params, MATS.Air, MATS.BK7, layers)
        : evaluateSpectrumTotalAt(grid, params, MATS.Air, MATS.BK7, MATS.Air, layers, [], subThickMM);
}

const CASES = [
    { name: 'slab, normal', theta: 0, subThickMM: 1 },
    { name: 'slab, 30 deg', theta: 30, subThickMM: 1 },
    { name: 'semi-infinite, 15 deg', theta: 15, subThickMM: null },
];
const D = [0, 3.7, 58.5, 121.4];

let worst = 0;
for (const { name, theta, subThickMM } of CASES) {
    const ev = createMonitorTmmEvaluator(theta, MATS.Air, MATS.BK7, base30, thick30, lambdas, subThickMM);
    for (const top of [MATS.H, MATS.L]) {           // second material exercises setTop on a live handle
        for (const d of D) {
            for (const pol of ['s', 'p', 'avg']) {
                const reference = fullStack(theta, pol, top, d, subThickMM);
                for (const char of ['R', 'T', 'A']) {
                    const sampled = ev.sample(char, pol, top, d);
                    for (let li = 0; li < lambdas.length; li++) {
                        worst = Math.max(worst, Math.abs(sampled[li] - reference[char][li]));
                    }
                }
            }
        }
    }
    ev.free();
    console.log(`     ${name}: checked`);
}
console.log(`     worst |Δ| across ${CASES.length} systems = ${worst.toExponential(2)}`);
ok(worst < 1e-12, 'the growing evaluator matches the full-stack spectrum');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exitCode = fail === 0 ? 0 : 1;
