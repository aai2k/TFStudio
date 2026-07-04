/**
 * WASM Hessian kernel ⇄ JS oracle equivalence.
 *
 * tmm_hessian (src/wasm/tmm_kernel.c) is a line-by-line port of
 * tmmThicknessHessian (thinFilmMath.js) — the analytic ∂²{R,T,A}/∂dᵢ∂dⱼ used by
 * the bounded-SQP / Newton inner refiner. This asserts the WASM kernel agrees
 * with the JS oracle to float64 round-off across non-absorbing AND absorbing
 * stacks, s/p polarization, and oblique incidence — base R/T/A, the first
 * derivatives, and the full N×N second-derivative matrices.
 *
 * Requires src/wasm/tmm_kernel.wasm (npm run build:wasm); SKIPS if absent.
 * Run: node tests/wasm_hessian_equivalence.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmmThicknessHessian } from '../src/utils/physics/thinFilmMath.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initTmmWasmMainThread, getTmmWasm, tmmWasmActive } from '../src/utils/workers/tmmWasm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(__dirname, '..', 'src', 'wasm', 'tmm_kernel.wasm');
if (!existsSync(wasmPath)) { console.log('SKIP wasm_hessian_equivalence: kernel not built.'); process.exit(0); }

await initTmmWasmMainThread(readFileSync(wasmPath), true);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const w = getTmmWasm();
ok(tmmWasmActive(), 'WASM active');
ok(w.hasHessian(), 'module carries tmm_hessian export');
if (!w.hasHessian()) { console.error('\n✗ kernel lacks tmm_hessian — rebuild: npm run build:wasm'); process.exit(1); }

const resolveMat = (id) => getMaterial(id);
// Tolerance: relative with an absolute floor (derivatives span many magnitudes).
const close = (a, b, rel = 2e-9, abs = 1e-12) => Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));

// Build a layers array [{n:[re,im], d}] at one λ from (materialId, d) pairs.
const mkLayers = (spec, lam) => spec.map(([id, d]) => ({ n: resolveMat(id).getNK(lam), d }));

const CASES = [
    { name: 'AR 4L dielectric', spec: [['TiO2', 95], ['SiO2', 150], ['TiO2', 70], ['SiO2', 130]] },
    { name: 'HR 7L dielectric',  spec: [['TiO2', 60], ['SiO2', 95], ['TiO2', 60], ['SiO2', 95], ['TiO2', 60], ['SiO2', 95], ['TiO2', 60]] },
    { name: 'absorbing (Cr/SiO2)', spec: [['SiO2', 120], ['Cr', 20], ['SiO2', 90]] },
    { name: 'single layer', spec: [['MgF2', 110]] },
];
const LAMS = [450, 550, 633];
const AOIS = [0, 30];
const POLS = ['s', 'p'];
const N0 = [1, 0], NS = resolveMat('BK7');

let maxRel = 0, nChecked = 0;
for (const C of CASES) {
    for (const lam of LAMS) for (const aoi of AOIS) for (const pol of POLS) {
        const layers = mkLayers(C.spec, lam);
        const ns = NS.getNK(lam);
        const js = tmmThicknessHessian(lam, aoi, pol, N0, ns, layers);
        const wa = w.tmmHessian(lam, aoi, pol === 'p' ? 1 : 0, N0, ns, layers);
        const tag = `${C.name} λ${lam} aoi${aoi} ${pol}`;
        const N = layers.length;
        // base
        for (const ch of ['R', 'T', 'A']) {
            ok(close(js[ch], wa[ch]), `${tag}: ${ch} (js ${js[ch]} vs wasm ${wa[ch]})`);
        }
        // first derivatives
        for (const key of ['dRdd', 'dTdd', 'dAdd']) {
            for (let k = 0; k < N; k++) {
                const a = js[key][k], b = wa[key][k];
                if (!close(a, b)) ok(false, `${tag}: ${key}[${k}] js ${a} vs wasm ${b}`);
                maxRel = Math.max(maxRel, Math.abs(a - b) / Math.max(1e-12, Math.abs(a)));
                nChecked++;
            }
        }
        // second derivatives (full N×N)
        for (const key of ['d2Rdd', 'd2Tdd', 'd2Add']) {
            for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
                const a = js[key][i][j], b = wa[key][i][j];
                if (!close(a, b)) ok(false, `${tag}: ${key}[${i}][${j}] js ${a} vs wasm ${b}`);
                maxRel = Math.max(maxRel, Math.abs(a - b) / Math.max(1e-12, Math.abs(a)));
                nChecked++;
            }
        }
    }
}

console.log(`Checked ${nChecked} derivative entries across ${CASES.length} stacks × ${LAMS.length} λ × ${AOIS.length} aoi × ${POLS.length} pol.`);
console.log(`max relative |Δ| = ${maxRel.toExponential(3)}`);
if (fails === 0) console.log('\n✓ WASM HESSIAN ⇄ JS EQUIVALENCE PASSED');
else { console.error(`\n✗ ${fails} mismatch(es)`); process.exit(1); }
