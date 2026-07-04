/**
 * Throughput microbenchmark: WASM vs JS for the optimizer hot paths.
 *
 * Establishes whether per-call tmm_one (scratch-arena loader) beats JS, and how
 * much the batched tmm_spectrum wins, on representative stacks. Informs whether a
 * batched-operand entry point is worth building. NOT a correctness test (that's
 * wasm_tmm_equivalence). SKIPS if the kernel isn't built.
 *
 * Run: node tests/wasm_bench.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmm, tmmAvg, tmmThicknessJacobian, tmmNeedleScan } from '../src/utils/physics/thinFilmMath.js';
import { instantiateTmmWasm } from '../src/utils/workers/tmmWasm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(__dirname, '..', 'src', 'wasm', 'tmm_kernel.wasm');
if (!existsSync(wasmPath)) { console.log('SKIP wasm_bench: kernel not built.'); process.exit(0); }

const wasm = await instantiateTmmWasm(readFileSync(wasmPath));
const air = [1, 0], sub = [1.52, 0];
const now = () => Number(process.hrtime.bigint()) / 1e6;

function mkStack(N) {
    return Array.from({ length: N }, (_, i) => ({ n: i % 2 ? [1.46, 0] : [2.35, 0.0008], d: i % 2 ? 120 : 70 }));
}

console.log('per-call tmm_one  (s-pol, λ=550, aoi=30):');
for (const N of [4, 12, 30, 60]) {
    const layers = mkStack(N);
    const ITER = 200000;
    // warm
    for (let i = 0; i < 1000; i++) { tmm(550, 30, 's', air, sub, layers); wasm.tmmOne(550, 30, 0, air, sub, layers); }
    let t0 = now(); let acc = 0;
    for (let i = 0; i < ITER; i++) acc += tmm(550, 30, 's', air, sub, layers).R;
    const tJs = now() - t0;
    t0 = now(); let acc2 = 0;
    for (let i = 0; i < ITER; i++) acc2 += wasm.tmmOne(550, 30, 0, air, sub, layers).R;
    const tW = now() - t0;
    console.log(`  N=${String(N).padStart(2)}  JS ${tJs.toFixed(0).padStart(5)}ms  WASM ${tW.toFixed(0).padStart(5)}ms  speedup ×${(tJs / tW).toFixed(2)}  (acc ${(acc - acc2).toExponential(1)})`);
}

console.log('\nanalytic thickness Jacobian (DLS hot path, s-pol, λ=550, aoi=0):');
for (const N of [4, 12, 30, 60]) {
    const layers = mkStack(N);
    const ITER = 80000;
    for (let i = 0; i < 500; i++) { tmmThicknessJacobian(550, 0, 's', air, sub, layers); wasm.tmmJacobian(550, 0, 0, air, sub, layers); }
    let t0 = now(); let acc = 0;
    for (let i = 0; i < ITER; i++) acc += tmmThicknessJacobian(550, 0, 's', air, sub, layers).dRdd[0];
    const tJs = now() - t0;
    t0 = now(); let acc2 = 0;
    for (let i = 0; i < ITER; i++) acc2 += wasm.tmmJacobian(550, 0, 0, air, sub, layers).dRdd[0];
    const tW = now() - t0;
    console.log(`  N=${String(N).padStart(2)}  JS ${tJs.toFixed(0).padStart(5)}ms  WASM ${tW.toFixed(0).padStart(5)}ms  speedup ×${(tJs / tW).toFixed(2)}  (acc ${(acc - acc2).toExponential(1)})`);
}

console.log('\nneedle P-function scan (4 candidates, 8 intra fracs, s-pol):');
{
    const candNs = [[2.35, 0.0008], [1.46, 0], [1.38, 0], [2.1, 0]];
    const fracs = [0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 0.88];
    for (const N of [4, 12, 30]) {
        const layers = mkStack(N);
        const ITER = 20000;
        for (let i = 0; i < 200; i++) { tmmNeedleScan(550, 0, 's', air, sub, layers, candNs, fracs); wasm.tmmNeedleScan(550, 0, 0, air, sub, layers, candNs, fracs); }
        let t0 = now(); let acc = 0;
        for (let i = 0; i < ITER; i++) acc += tmmNeedleScan(550, 0, 's', air, sub, layers, candNs, fracs).gaps[0][0].dR;
        const tJs = now() - t0;
        t0 = now(); let acc2 = 0;
        for (let i = 0; i < ITER; i++) acc2 += wasm.tmmNeedleScan(550, 0, 0, air, sub, layers, candNs, fracs).gaps[0][0].dR;
        const tW = now() - t0;
        console.log(`  N=${String(N).padStart(2)}  JS ${tJs.toFixed(0).padStart(5)}ms  WASM ${tW.toFixed(0).padStart(5)}ms  speedup ×${(tJs / tW).toFixed(2)}  (acc ${(acc - acc2).toExponential(1)})`);
    }
}

console.log('\nbatched spectrum (both pols, 81 λ):');
const lambdas = Array.from({ length: 81 }, (_, i) => 400 + i * 5);
for (const N of [4, 12, 30, 60]) {
    const layers = mkStack(N);
    const n0List = lambdas.map(() => air), nsList = lambdas.map(() => sub);
    const layerNK = layers.map(l => lambdas.map(() => l.n));
    const thick = layers.map(l => l.d);
    const REP = 4000;
    for (let i = 0; i < 50; i++) { for (const lam of lambdas) tmmAvg(lam, 30, air, sub, layers); wasm.tmmSpectrum(lambdas, n0List, nsList, layerNK, thick, 30); }
    let t0 = now();
    for (let r = 0; r < REP; r++) for (const lam of lambdas) tmmAvg(lam, 30, air, sub, layers);
    const tJs = now() - t0;
    t0 = now();
    for (let r = 0; r < REP; r++) wasm.tmmSpectrum(lambdas, n0List, nsList, layerNK, thick, 30);
    const tW = now() - t0;
    console.log(`  N=${String(N).padStart(2)}  JS ${tJs.toFixed(0).padStart(5)}ms  WASM ${tW.toFixed(0).padStart(5)}ms  speedup ×${(tJs / tW).toFixed(2)}`);
}
