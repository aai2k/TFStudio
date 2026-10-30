/**
 * Optimizer WASM seam.
 *
 * The optimizer routes every single-(λ,θ,pol) R/T/A through tmmC → tmmEval and
 * every analytic gradient through the thickness Jacobian, both on the WASM
 * kernel. DLSOptimizer.mfAt and gradMF must agree with tmmcore's JavaScript
 * reference to float64 round-off, which proves the seam passes the same stack, angle
 * and polarization. Covers front_only / back_only+total / symmetric so every
 * tmmProp branch is exercised.
 *
 * Run: node tests/wasm_optimizer_seam.mjs
 */

import './_kernel.mjs';
import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { onJsReference } from './_wasmInit.mjs';
import { rtaEval, tmmJacEval, tmmHessEval } from '../src/utils/physics/optimizer/evalCore/kernels.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const resolveMat = id => getMaterial(id);

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
    const { x, mfJs, gJs } = onJsReference(() => {
        const dlsJs = new DLSOptimizer(ops, des, resolveMat);
        const start = dlsJs.thicknesses.slice();
        return { x: start, mfJs: dlsJs.mfAt(start), gJs: dlsJs.gradMF(start) };
    });

    // WASM path
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

// The kernel entry points read 'p' as p and anything else as s, so a merit row
// saved without a polarization evaluates in s at an oblique angle, as it always
// has, and does not become the s/p average tmmcore takes for a missing pol.
{
    const n0 = [1, 0], ns = [1.52, 0];
    const layers = [{ n: [2.35, 0], d: 82 }, { n: [1.46, 0], d: 138 }];
    for (const [name, call] of [['rtaEval', rtaEval], ['tmmJacEval', tmmJacEval], ['tmmHessEval', tmmHessEval]]) {
        const s = JSON.stringify(call(550, 45, 's', n0, ns, layers));
        ok(JSON.stringify(call(550, 45, 'p', n0, ns, layers)) !== s, `${name}: s and p differ at 45°`);
        for (const pol of [undefined, null, 'S']) {
            ok(JSON.stringify(call(550, 45, pol, n0, ns, layers)) === s, `${name}: pol ${pol} evaluates in s`);
        }
    }
}

// The exit code is set rather than process.exit() called: on Windows, Node 24
// aborts with a libuv assertion when process.exit() follows this run directly.
if (fails === 0) {
    console.log('\nPASS: optimizer (mfAt + analytic gradMF) agrees through the WASM seam.');
} else {
    console.error(`\n${fails} assertion(s) FAILED.`);
    process.exitCode = 1;
}
