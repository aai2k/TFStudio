/**
 * Throughput microbenchmark: WASM vs JS for the optimizer hot paths.
 *
 * Establishes whether a per-call rta on the WASM instance (scratch-arena
 * loader) beats tmmcore's JavaScript, and how much the batched rtaSpectrum
 * wins, on representative stacks. Informs whether a batched-operand entry point
 * is worth building. NOT a correctness test (that's wasm_tmm_equivalence). Uses
 * the prebuilt kernel shipped by tmmcore.
 *
 * Run: node tests/wasm_bench.mjs
 */

import { readFileSync } from 'node:fs';
import { instantiateTmmWasm, rta, jacobian, needleScan } from 'tmmcore';
import { gridStack, pointStack } from '../src/utils/physics/kernelStack.js';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';

const wasm = await instantiateTmmWasm(readFileSync(TMMCORE_WASM_PATH));
const air = [1, 0], sub = [1.52, 0];
const now = () => Number(process.hrtime.bigint()) / 1e6;

function mkStack(N) {
    return Array.from({ length: N }, (_, i) => ({ n: i % 2 ? [1.46, 0] : [2.35, 0.0008], d: i % 2 ? 120 : 70 }));
}

console.log('per-call rta  (s-pol, λ=550, aoi=30):');
for (const N of [4, 12, 30, 60]) {
    const stack = pointStack(air, sub, mkStack(N));
    const options = { angle: 30, pol: 's' };
    const ITER = 200000;
    // warm
    for (let i = 0; i < 1000; i++) { rta(stack, 550, options); wasm.rta(stack, 550, options); }
    let t0 = now(); let acc = 0;
    for (let i = 0; i < ITER; i++) acc += rta(stack, 550, options).R;
    const tJs = now() - t0;
    t0 = now(); let acc2 = 0;
    for (let i = 0; i < ITER; i++) acc2 += wasm.rta(stack, 550, options).R;
    const tW = now() - t0;
    console.log(`  N=${String(N).padStart(2)}  JS ${tJs.toFixed(0).padStart(5)}ms  WASM ${tW.toFixed(0).padStart(5)}ms  speedup ×${(tJs / tW).toFixed(2)}  (acc ${(acc - acc2).toExponential(1)})`);
}

console.log('\nanalytic thickness Jacobian (DLS hot path, s-pol, λ=550, aoi=0):');
for (const N of [4, 12, 30, 60]) {
    const stack = pointStack(air, sub, mkStack(N));
    const options = { pol: 's' };
    const ITER = 80000;
    for (let i = 0; i < 500; i++) { jacobian(stack, 550, options); wasm.jacobian(stack, 550, options); }
    let t0 = now(); let acc = 0;
    for (let i = 0; i < ITER; i++) acc += jacobian(stack, 550, options).dRdd[0];
    const tJs = now() - t0;
    t0 = now(); let acc2 = 0;
    for (let i = 0; i < ITER; i++) acc2 += wasm.jacobian(stack, 550, options).dRdd[0];
    const tW = now() - t0;
    console.log(`  N=${String(N).padStart(2)}  JS ${tJs.toFixed(0).padStart(5)}ms  WASM ${tW.toFixed(0).padStart(5)}ms  speedup ×${(tJs / tW).toFixed(2)}  (acc ${(acc - acc2).toExponential(1)})`);
}

console.log('\nneedle P-function scan (4 candidates, 8 intra fracs, s-pol):');
{
    const options = {
        pol: 's',
        candidates: [{ n: 2.35, k: 0.0008 }, 1.46, 1.38, 2.1],
        fractions: [0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 0.88],
    };
    for (const N of [4, 12, 30]) {
        const stack = pointStack(air, sub, mkStack(N));
        const ITER = 20000;
        for (let i = 0; i < 200; i++) { needleScan(stack, 550, options); wasm.needleScan(stack, 550, options); }
        let t0 = now(); let acc = 0;
        for (let i = 0; i < ITER; i++) acc += needleScan(stack, 550, options).gaps[0][0].dR;
        const tJs = now() - t0;
        t0 = now(); let acc2 = 0;
        for (let i = 0; i < ITER; i++) acc2 += wasm.needleScan(stack, 550, options).gaps[0][0].dR;
        const tW = now() - t0;
        console.log(`  N=${String(N).padStart(2)}  JS ${tJs.toFixed(0).padStart(5)}ms  WASM ${tW.toFixed(0).padStart(5)}ms  speedup ×${(tJs / tW).toFixed(2)}  (acc ${(acc - acc2).toExponential(1)})`);
    }
}

console.log('\nbatched spectrum (s/p average, 81 λ):');
const lambdas = Array.from({ length: 81 }, (_, i) => 400 + i * 5);
for (const N of [4, 12, 30, 60]) {
    const layers = mkStack(N);
    const stack = pointStack(air, sub, layers);
    const grid = gridStack(lambdas.map(() => air), lambdas.map(() => sub),
        layers.map(l => lambdas.map(() => l.n)), layers.map(l => l.d));
    const options = { angle: 30 };
    const REP = 4000;
    for (let i = 0; i < 50; i++) { for (const lam of lambdas) rta(stack, lam, options); wasm.rtaSpectrum(grid, lambdas, options); }
    let t0 = now();
    for (let r = 0; r < REP; r++) for (const lam of lambdas) rta(stack, lam, options);
    const tJs = now() - t0;
    t0 = now();
    for (let r = 0; r < REP; r++) wasm.rtaSpectrum(grid, lambdas, options);
    const tW = now() - t0;
    console.log(`  N=${String(N).padStart(2)}  JS ${tJs.toFixed(0).padStart(5)}ms  WASM ${tW.toFixed(0).padStart(5)}ms  speedup ×${(tJs / tW).toFixed(2)}`);
}
