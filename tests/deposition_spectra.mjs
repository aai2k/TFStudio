/**
 * Deposition spectra: the batched growing-stack path against the per-step
 * evaluation it replaces.
 *
 * evaluateDepositionSpectra must reproduce evaluateSpectrumTotal called on
 * every prefix of the run: exactly without WASM (same loop), and to float64
 * agreement with the WASM kernel, whose reverse pass comes from the
 * anti-transposed matrix rather than an explicit reversed evaluation.
 *
 * Run: node tests/deposition_spectra.mjs
 */
import {
    evaluateDepositionSpectra, evaluateSpectrumTotal,
} from '../src/utils/physics/thinFilmMath.js';
import { setTmmWasmEnabled } from 'tmmcore';
import { initWasmForTest } from './_wasmInit.mjs';

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const mk = (name, n, c = 0, k = 0) => ({ name, getNK: lam => [n + c / (lam * lam) * 1e5, k] });
const Air = mk('Air', 1.0);
const Sub = mk('Sub', 1.51, 0.42);
const H = mk('H', 2.28, 1.2, 0.0004);
const L = mk('L', 1.45, 0.35);

const N = 30;
const deposition = Array.from({ length: N }, (_, i) => ({
    material: i % 2 ? L : H,
    thickness: i % 2 ? 94.8 : 60.3,
}));
deposition[7] = { material: L, thickness: 0 };   // a skipped step must repeat
const back = [{ material: L, thickness: 120 }, { material: H, thickness: 55 }];

const params = { lambdaStart: 420, lambdaEnd: 780, lambdaStep: 5, theta: 15, polarization: 'avg' };

function oracle() {
    return deposition.map((_, step) => evaluateSpectrumTotal(params, Air, Sub, Air,
        deposition.slice(0, step + 1).reverse(), back, 1.0));
}

setTmmWasmEnabled(false);
const t0 = performance.now();
const ref = oracle();
const tLoop = performance.now() - t0;

const js = evaluateDepositionSpectra(params, Air, Sub, Air, deposition, back, 1.0);

const active = await initWasmForTest();
const { getTmmWasm } = await import('tmmcore');
if (!active || typeof getTmmWasm().hasGrowingKernels !== 'function'
        || !getTmmWasm().hasGrowingKernels()) {
    console.log('SKIP  tmmcore build predates the growing-stack kernels (needs tmmcore >= 0.3.0)');
    process.exit(0);
}
ok(active, 'WASM kernel active with growing-stack kernels');
const t1 = performance.now();
const wa = evaluateDepositionSpectra(params, Air, Sub, Air, deposition, back, 1.0);
const tWasm = performance.now() - t1;

ok(js.length === N && wa.length === N, 'one spectrum per deposition step');

function compare(label, got, tol) {
    let worst = 0;
    for (let step = 0; step < N; step++) {
        for (const key of ['R', 'T', 'A', 'Rs', 'Ts', 'Rp', 'Tp']) {
            const a = ref[step][key], b = got[step][key];
            for (let i = 0; i < a.length; i++) {
                worst = Math.max(worst, Math.abs(a[i] - b[i]));
            }
        }
    }
    ok(worst <= tol, `${label} matches the per-step evaluation (worst ${worst.toExponential(2)})`);
}
compare('JS fallback', js, 0);
compare('WASM kernel', wa, 1e-9);

// The zero-thickness step repeats the previous spectrum exactly.
let worstRepeat = 0;
for (let i = 0; i < wa[7].T.length; i++) {
    worstRepeat = Math.max(worstRepeat, Math.abs(wa[7].T[i] - wa[6].T[i]));
}
ok(worstRepeat === 0, 'a zero-thickness step repeats the previous spectrum');

console.log(`timing, ${N} steps x ${ref[0].lambda.length} wavelengths: per-step loop ${tLoop.toFixed(0)} ms, WASM batch ${tWasm.toFixed(0)} ms`);
console.log(fail ? `${fail} FAILURES` : 'ALL PASS');
process.exit(fail ? 1 : 0);
