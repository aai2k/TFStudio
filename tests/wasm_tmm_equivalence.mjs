/**
 * WASM TMM kernel ⇆ JS equivalence test.
 *
 * Validates that src/wasm/tmm_kernel.c (built to tmm_kernel.wasm) reproduces the
 * authoritative JS TMM in thinFilmMath.js — tmm(), tmmAvg() (via the batched
 * tmm_spectrum), and tmmThicknessJacobian() — across absorbing, dispersive,
 * oblique-incidence, s/p cases.
 *
 * NOT bit-identical by design: the only divergence from the JS path is the libm
 * sin/cos/exp/atan2 (Emscripten musl vs. V8 fdlibm), differing at ~1 ULP. The
 * tolerances below (abs 1e-9 on R/T/A ∈ [0,1]; rel 1e-7 + abs 1e-12 on the
 * analytic derivatives) are far tighter than any physical/convergence tolerance
 * yet comfortably above libm noise. The JS worker-vs-serial BIT-identical tests
 * are unaffected (WASM is a separate, feature-flagged path).
 *
 * Run after building the kernel:  npm run build:wasm   (or: node this file)
 * If tmm_kernel.wasm is absent, the test SKIPS cleanly (exit 0) with a notice.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { tmm, tmmAvg, tmmThicknessJacobian, tmmNeedleScan } from '../src/utils/physics/thinFilmMath.js';
import { instantiateTmmWasm } from '../src/utils/workers/tmmWasm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(__dirname, '..', 'src', 'wasm', 'tmm_kernel.wasm');

if (!existsSync(wasmPath)) {
    console.log('SKIP wasm_tmm_equivalence: src/wasm/tmm_kernel.wasm not built.');
    console.log('     Build it with `npm run build:wasm` (requires Emscripten).');
    process.exit(0);
}

let fails = 0;
let maxOne = 0, maxSpec = 0, maxJac = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

// ── Test fixtures: representative (λ,θ,pol,stack) cases ──────────────────────
// Indices are [re, im] = [n, k]; k>0 absorbing, matching the JS convention.
const air = [1, 0];
const glass = [1.52, 0];
const absorbingSub = [4.0, 0.05];   // Si-like absorbing substrate

// A simple synthetic dispersion so spectra are non-trivial across λ.
const dispH = (lam) => [2.35 + 8000 / (lam * lam), 0.0005];   // TiO2-ish + tiny k
const dispL = (lam) => [1.46 + 3000 / (lam * lam), 0.0];      // SiO2-ish
const dispMetal = (lam) => [0.15 + lam * 0.0006, 3.2 + lam * 0.004]; // Ag-ish

const stacks = [
    // [{n:[re,im], d}, ...]
    [],                                                              // bare substrate
    [{ n: [1.38, 0], d: 95 }],                                       // single AR
    [{ n: [2.35, 0.0005], d: 60 }, { n: [1.46, 0], d: 120 }, { n: [2.35, 0.0005], d: 88 }],
    Array.from({ length: 21 }, (_, i) => ({ n: i % 2 ? [1.46, 0] : [2.35, 0.0008], d: i % 2 ? 110 : 70 })),
    [{ n: [0.15, 3.2], d: 30 }, { n: [1.46, 0], d: 80 }],            // metal + dielectric
];

const lambdas = [380, 450, 532, 633, 780, 1064];
const angles = [0, 8, 30, 55];
const pols = ['s', 'p'];

function relabs(a, b) { return Math.abs(a - b); }

const wasm = await instantiateTmmWasm(readFileSync(wasmPath));

// ── 1) tmm_one vs JS tmm() ───────────────────────────────────────────────────
for (const layers of stacks) {
    for (const lam of lambdas) {
        for (const aoi of angles) {
            for (const pol of pols) {
                const js = tmm(lam, aoi, pol, air, absorbingSub, layers);
                const w = wasm.tmmOne(lam, aoi, pol === 'p' ? 1 : 0, air, absorbingSub, layers);
                for (const key of ['R', 'T', 'A']) {
                    const d = relabs(js[key], w[key]);
                    if (d > maxOne) maxOne = d;
                    ok(d < 1e-9, `tmm_one ${key} λ=${lam} aoi=${aoi} ${pol} N=${layers.length} Δ=${d}`);
                }
            }
        }
    }
}
console.log(`tmm_one      max |Δ(R,T,A)| = ${maxOne.toExponential(3)}  (tol 1e-9)`);

// ── 2) tmm_spectrum vs looping JS tmmAvg() ──────────────────────────────────
{
    const N = 9;
    const valid = Array.from({ length: N }, (_, i) => i); // layer indices
    const thick = valid.map((i) => (i % 2 ? 118 : 64));
    const matFns = valid.map((i) => (i % 2 ? dispL : dispH));
    const theta = 22;

    // JS reference: per-λ tmmAvg over the same stack.
    const n0List = lambdas.map(() => air);
    const nsList = lambdas.map(() => glass);
    const layerNK = valid.map((i) => lambdas.map((lam) => matFns[i](lam)));

    const sp = wasm.tmmSpectrum(lambdas, n0List, nsList, layerNK, thick, theta);

    for (let li = 0; li < lambdas.length; li++) {
        const lam = lambdas[li];
        const layerNDs = valid.map((i) => ({ n: matFns[i](lam), d: thick[i] }));
        const js = tmmAvg(lam, theta, air, glass, layerNDs);
        const pairs = [
            ['Rs', sp.Rs[li], js.Rs], ['Ts', sp.Ts[li], js.Ts], ['As', sp.As[li], js.As],
            ['Rp', sp.Rp[li], js.Rp], ['Tp', sp.Tp[li], js.Tp], ['Ap', sp.Ap[li], js.Ap],
        ];
        for (const [name, a, b] of pairs) {
            const d = relabs(a, b);
            if (d > maxSpec) maxSpec = d;
            ok(d < 1e-9, `tmm_spectrum ${name} λ=${lam} Δ=${d}`);
        }
    }
}
console.log(`tmm_spectrum max |Δ|        = ${maxSpec.toExponential(3)}  (tol 1e-9)`);

// ── 3) tmm_jacobian vs JS tmmThicknessJacobian() ────────────────────────────
for (const layers of stacks) {
    if (layers.length === 0) continue;
    for (const lam of [450, 633, 1064]) {
        for (const aoi of [0, 40]) {
            for (const pol of pols) {
                const js = tmmThicknessJacobian(lam, aoi, pol, air, absorbingSub, layers);
                const w = wasm.tmmJacobian(lam, aoi, pol === 'p' ? 1 : 0, air, absorbingSub, layers);
                ok(w.N === js.N, `jacobian N mismatch`);
                // base R,T,A
                for (const key of ['R', 'T', 'A']) {
                    const d = relabs(js[key], w[key]);
                    if (d > maxJac) maxJac = d;
                    ok(d < 1e-9, `tmm_jacobian base ${key} λ=${lam} aoi=${aoi} ${pol} Δ=${d}`);
                }
                for (let k = 0; k < js.N; k++) {
                    for (const arr of ['dRdd', 'dTdd', 'dAdd']) {
                        const a = w[arr][k], b = js[arr][k];
                        const d = relabs(a, b);
                        const tol = 1e-7 * Math.abs(b) + 1e-12;
                        if (d > maxJac) maxJac = d;
                        ok(d < tol, `tmm_jacobian ${arr}[${k}] λ=${lam} aoi=${aoi} ${pol} Δ=${d} (tol ${tol.toExponential(2)})`);
                    }
                }
            }
        }
    }
}
console.log(`tmm_jacobian max |Δ|        = ${maxJac.toExponential(3)}`);

// ── 4) tmm_needle_scan vs JS tmmNeedleScan() ────────────────────────────────
let maxNeedle = 0;
{
    const candidateNs = [[2.35, 0.0008], [1.46, 0], [1.38, 0], [2.1, 0.0003]];
    const fracsArr = [0.25, 0.5, 0.75];
    for (const layers of stacks) {
        if (layers.length === 0) continue;
        for (const lam of [450, 633]) {
            for (const aoi of [0, 35]) {
                for (const pol of pols) {
                    const polN = pol === 'p' ? 1 : 0;
                    const js = tmmNeedleScan(lam, aoi, pol, air, absorbingSub, layers, candidateNs, fracsArr);
                    const w  = wasm.tmmNeedleScan(lam, aoi, polN, air, absorbingSub, layers, candidateNs, fracsArr);
                    ok(w.N === js.N, `needle N mismatch`);
                    for (const key of ['R', 'T', 'A']) {
                        const d = relabs(js[key], w[key]); if (d > maxNeedle) maxNeedle = d;
                        ok(d < 1e-9, `needle base ${key} λ=${lam} aoi=${aoi} ${pol} Δ=${d}`);
                    }
                    for (let pos = 0; pos <= js.N; pos++) {
                        for (let c = 0; c < candidateNs.length; c++) {
                            for (const m of ['dR', 'dT', 'dA']) {
                                const a = w.gaps[pos][c][m], b = js.gaps[pos][c][m];
                                const d = relabs(a, b), tol = 1e-7 * Math.abs(b) + 1e-12;
                                if (d > maxNeedle) maxNeedle = d;
                                ok(d < tol, `needle gap[${pos}][${c}].${m} λ=${lam} ${pol} Δ=${d}`);
                            }
                        }
                    }
                    for (let k = 0; k < js.N; k++) {
                        for (let fi = 0; fi < fracsArr.length; fi++) {
                            ok(Math.abs(w.intra[k][fi].frac - js.intra[k][fi].frac) < 1e-15, `needle intra frac`);
                            for (let c = 0; c < candidateNs.length; c++) {
                                for (const m of ['dR', 'dT', 'dA']) {
                                    const a = w.intra[k][fi].perCand[c][m], b = js.intra[k][fi].perCand[c][m];
                                    const d = relabs(a, b), tol = 1e-7 * Math.abs(b) + 1e-12;
                                    if (d > maxNeedle) maxNeedle = d;
                                    ok(d < tol, `needle intra[${k}][${fi}][${c}].${m} λ=${lam} ${pol} Δ=${d}`);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
console.log(`tmm_needle   max |Δ|        = ${maxNeedle.toExponential(3)}`);

if (fails === 0) {
    console.log('\nPASS — WASM TMM kernel agrees with the JS reference within tolerance.');
    process.exit(0);
} else {
    console.error(`\n${fails} assertion(s) FAILED.`);
    process.exit(1);
}
