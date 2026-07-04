/**
 * Optimizer WASM-seam test (no compiled kernel).
 *
 * The optimizer routes every single-(λ,θ,pol) R/T/A through tmmC → tmmEval,
 * which calls the WASM kernel when the flag is on. With a JS-backed mock kernel
 * (delegating to JS tmm) injected, DLSOptimizer.mfAt and the analytic gradient
 * must be BIT-identical to the JS path — proving the optimizer seam preserves
 * results. Covers front_only / back_only+total / symmetric so every tmmProp
 * branch is exercised.
 *
 * Run: node tests/wasm_optimizer_seam.mjs
 */

import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { tmm, tmmThicknessJacobian } from '../src/utils/physics/thinFilmMath.js';
import { TmmWasmInstance, __setTmmWasmInstanceForTest, setTmmWasmEnabled } from '../src/utils/workers/tmmWasm.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const resolveMat = id => getMaterial(id);

function makeMockInstance() {
    const memory = new WebAssembly.Memory({ initial: 64 });
    let bump = 16;
    const malloc = (b) => { bump = (bump + 7) & ~7; const p = bump; bump += b; if (bump > memory.buffer.byteLength) memory.grow(Math.ceil((bump - memory.buffer.byteLength) / 65536) + 1); return p; };
    const free = () => {};
    const f64 = (p, n) => new Float64Array(memory.buffer, p, n);
    const tmm_one = (lam, theta, pol, n0re, n0im, nsre, nsim, layPtr, N, outPtr) => {
        const lay = f64(layPtr, Math.max(1, 3 * N));
        const layers = [];
        for (let i = 0; i < N; i++) layers.push({ n: [lay[3 * i], lay[3 * i + 1]], d: lay[3 * i + 2] });
        const r = tmm(lam, theta, pol === 1 ? 'p' : 's', [n0re, n0im], [nsre, nsim], layers);
        const out = f64(outPtr, 3); out[0] = r.R; out[1] = r.T; out[2] = r.A;
    };
    // gradMF now routes through _analyticJacobian → tmm_jacobian; back it with JS.
    const tmm_jacobian = (lam, theta, pol, n0re, n0im, nsre, nsim, layPtr, N, dRptr, dTptr, dAptr, basePtr) => {
        const lay = f64(layPtr, Math.max(1, 3 * N));
        const layers = [];
        for (let i = 0; i < N; i++) layers.push({ n: [lay[3 * i], lay[3 * i + 1]], d: lay[3 * i + 2] });
        const j = tmmThicknessJacobian(lam, theta, pol === 1 ? 'p' : 's', [n0re, n0im], [nsre, nsim], layers);
        const dR = f64(dRptr, Math.max(1, N)), dT = f64(dTptr, Math.max(1, N)), dA = f64(dAptr, Math.max(1, N));
        for (let k = 0; k < N; k++) { dR[k] = j.dRdd[k]; dT[k] = j.dTdd[k]; dA[k] = j.dAdd[k]; }
        const base = f64(basePtr, 3); base[0] = j.R; base[1] = j.T; base[2] = j.A;
    };
    return { exports: { memory, malloc, free, tmm_one, tmm_spectrum: () => {}, tmm_jacobian, tmm_needle_scan: () => {} } };
}

const ops = [
    makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'TAV', lambdaStart: 450, lambdaEnd: 650, aoi: 30, pol: 's', target: 1, weight: 1 }),
];

function makeDesign(surfaceMode, mfEvalMode = 'side') {
    const front = [
        { id: 'F1', material: 'TiO2', thickness: 82, locked: false },
        { id: 'F2', material: 'SiO2', thickness: 138, locked: false },
        { id: 'F3', material: 'TiO2', thickness: 61, locked: false },
    ];
    return {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: front,
        backLayers: surfaceMode === 'symmetric'
            ? front.slice().reverse().map(l => ({ ...l, id: 'B' + l.id.slice(1) }))
            : [{ id: 'B1', material: 'SiO2', thickness: 100, locked: false }],
        surfaceMode, mfEvalMode,
    };
}

const cases = [
    ['front_only', 'side'],
    ['back_only', 'total'],
    ['symmetric', 'side'],
    ['front_only', 'total'],
];

for (const [sm, me] of cases) {
    const des = makeDesign(sm, me);

    // JS reference
    setTmmWasmEnabled(false); __setTmmWasmInstanceForTest(null);
    const dlsJs = new DLSOptimizer(ops, des, resolveMat);
    const x = dlsJs.thicknesses.slice();
    const mfJs = dlsJs.mfAt(x);
    const gJs = dlsJs.gradMF(x);

    // WASM path (mock injected)
    __setTmmWasmInstanceForTest(new TmmWasmInstance(makeMockInstance()));
    setTmmWasmEnabled(true);
    const dlsW = new DLSOptimizer(ops, des, resolveMat);
    const mfW = dlsW.mfAt(x);
    const gW = dlsW.gradMF(x);

    ok(Math.abs(mfJs - mfW) < 1e-15, `${sm}+${me}: mfAt JS=${mfJs} WASM=${mfW} Δ=${Math.abs(mfJs - mfW)}`);
    let gmax = 0;
    for (let i = 0; i < gJs.length; i++) gmax = Math.max(gmax, Math.abs(gJs[i] - gW[i]));
    ok(gmax < 1e-15, `${sm}+${me}: gradMF max|Δ|=${gmax}`);
    console.log(`  ${sm}+${me}: mfΔ=${Math.abs(mfJs - mfW).toExponential(2)}  gradΔ=${gmax.toExponential(2)}`);
}

setTmmWasmEnabled(false); __setTmmWasmInstanceForTest(null);

if (fails === 0) {
    console.log('\nPASS — optimizer (mfAt + analytic gradMF) is bit-identical through the WASM seam.');
    process.exit(0);
} else {
    console.error(`\n${fails} assertion(s) FAILED.`);
    process.exit(1);
}
