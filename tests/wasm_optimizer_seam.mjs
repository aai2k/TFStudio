/**
 * Optimizer WASM seam.
 *
 * The optimizer routes every single-(λ,θ,pol) R/T/A through tmmC → tmmEval and
 * every analytic gradient through the thickness Jacobian, both on the WASM
 * kernel when it is active. DLSOptimizer.mfAt and gradMF must agree with the JS
 * path to float64 round-off, which proves the seam passes the same stack, angle
 * and polarization. Covers front_only / back_only+total / symmetric so every
 * tmmProp branch is exercised.
 *
 * Run: node tests/wasm_optimizer_seam.mjs
 */

import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { setTmmWasmEnabled } from 'tmmcore';
import { initWasmForTest } from './_wasmInit.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const resolveMat = id => getMaterial(id);

if (!(await initWasmForTest())) {
    console.error('FAIL: the WASM kernel did not load');
    process.exit(1);
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

const relDiff = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(a), Math.abs(b));

for (const [sm, me] of cases) {
    const des = makeDesign(sm, me);

    // JS reference
    setTmmWasmEnabled(false);
    const dlsJs = new DLSOptimizer(ops, des, resolveMat);
    const x = dlsJs.thicknesses.slice();
    const mfJs = dlsJs.mfAt(x);
    const gJs = dlsJs.gradMF(x);

    // WASM path
    setTmmWasmEnabled(true);
    const dlsW = new DLSOptimizer(ops, des, resolveMat);
    const mfW = dlsW.mfAt(x);
    const gW = dlsW.gradMF(x);

    const mfDelta = relDiff(mfJs, mfW);
    ok(mfDelta < 1e-12, `${sm}+${me}: mfAt JS=${mfJs} WASM=${mfW} rel Δ=${mfDelta}`);
    const gScale = Math.max(...gJs.map(Math.abs));
    let gmax = 0;
    for (let i = 0; i < gJs.length; i++) gmax = Math.max(gmax, Math.abs(gJs[i] - gW[i]) / gScale);
    ok(gmax < 1e-10, `${sm}+${me}: gradMF max rel Δ=${gmax}`);
    console.log(`  ${sm}+${me}: mf rel Δ=${mfDelta.toExponential(2)}  grad rel Δ=${gmax.toExponential(2)}`);
}

setTmmWasmEnabled(false);

// The exit code is set rather than process.exit() called: on Windows, Node 24
// aborts with a libuv assertion when process.exit() follows this run directly.
if (fails === 0) {
    console.log('\nPASS: optimizer (mfAt + analytic gradMF) agrees through the WASM seam.');
} else {
    console.error(`\n${fails} assertion(s) FAILED.`);
    process.exitCode = 1;
}
