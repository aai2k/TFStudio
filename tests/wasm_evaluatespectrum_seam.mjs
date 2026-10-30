/**
 * evaluateSpectrum / evaluateSpectrumBack / evaluateSpectrumTotal WASM seam.
 *
 * Confirms the WASM path in thinFilmMath.js gives the same spectrum as the JS
 * loop, to float64 round-off: the kernel computes the same physics, so a
 * difference here is the seam (material→layerNK gathering, layer ordering with
 * front as-is and back reversed, the substrate-side angles, polarization
 * selection). Also counts the kernel calls: each pass over a grid is one call.
 *
 * Run: node tests/wasm_evaluatespectrum_seam.mjs
 */

import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../src/utils/physics/thinFilmMath.js';
import { setTmmWasmEnabled } from 'tmmcore';
import { initWasmForTest, getTmmWasm } from './_wasmInit.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

if (!(await initWasmForTest())) {
    console.error('FAIL: the WASM kernel did not load');
    process.exit(1);
}

// Kernel calls, counted on the grid and the one-wavelength R/T exports.
const kernel = getTmmWasm();
const calls = { grid: 0, point: 0 };
for (const [name, key] of [['_tmm_rta_spectrum', 'grid'], ['_tmm_rta', 'point']]) {
    const call = kernel[name];
    kernel[name] = (...args) => { calls[key]++; return call(...args); };
}

// Minimal material objects with getNK(λ) → [n, k].
const mat = (n, k = 0, disp = 0) => ({ getNK: (lam) => [n + disp / (lam * lam), k] });
const air = mat(1.0), bk7 = mat(1.52, 0, 2000), tio2 = mat(2.35, 0.0006, 9000), sio2 = mat(1.46, 0, 3000);

const params = { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 25, theta: 20, polarization: 'avg' };
const frontLayers = [
    { material: tio2, thickness: 72 },
    { material: sio2, thickness: 124 },
    { material: tio2, thickness: 58 },
    { material: sio2, thickness: 95 },
];
const backLayers = [ // stored substrate→exit
    { material: sio2, thickness: 110 },
    { material: tio2, thickness: 60 },
];

function maxDiff(a, b) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; }

function compareAll(label, jsRes, wRes) {
    for (const key of ['R', 'T', 'A', 'Rs', 'Ts', 'As', 'Rp', 'Tp', 'Ap']) {
        const d = maxDiff(jsRes[key], wRes[key]);
        ok(d < 1e-12, `${label} ${key} max|Δ|=${d}`);
    }
    ok(jsRes.lambda.length === wRes.lambda.length, `${label} length`);
}

const normal = { ...params, theta: 0 };
const run = () => ({
    front: evaluateSpectrum(params, air, bk7, frontLayers),
    back: evaluateSpectrumBack(params, air, bk7, backLayers),
    frontS: evaluateSpectrum({ ...params, polarization: 's' }, air, bk7, frontLayers),
    frontP: evaluateSpectrum({ ...params, polarization: 'p' }, air, bk7, frontLayers),
    total: evaluateSpectrumTotal(normal, air, bk7, air, frontLayers, backLayers, 1.1),
    totalP: evaluateSpectrumTotal({ ...normal, polarization: 'p' }, air, bk7, air, frontLayers, backLayers, 1.1),
    totalOblique: evaluateSpectrumTotal(params, air, bk7, air, frontLayers, backLayers, 1.1),
});

// JS reference (flag off), then the WASM path.
setTmmWasmEnabled(false);
const js = run();
ok(calls.grid === 0 && calls.point === 0, 'the JS reference runs no kernel call');
setTmmWasmEnabled(true);
const w = run();

for (const key of Object.keys(js)) compareAll(key, js[key], w[key]);

// The forward pass runs at the angle of incidence; the two substrate-side
// passes start at the refracted angle, which follows the substrate's dispersion
// and so differs at every wavelength. Each pass is one call over the grid, at
// normal and at oblique incidence alike.
for (const [label, p] of [['normal', normal], ['oblique', params]]) {
    calls.grid = 0; calls.point = 0;
    evaluateSpectrumTotal(p, air, bk7, air, frontLayers, backLayers, 1.1);
    ok(calls.grid === 3 && calls.point === 0,
        `total at ${label} incidence is three grid calls (got ${calls.grid} grid, ${calls.point} point)`);
}

setTmmWasmEnabled(false);

// The exit code is set rather than process.exit() called: on Windows, Node 24
// aborts with a libuv assertion when process.exit() follows this run directly.
if (fails === 0) {
    console.log('PASS: evaluateSpectrum WASM seam matches the JS loop (front + back + total + s/p).');
} else {
    console.error(`${fails} assertion(s) FAILED.`);
    process.exitCode = 1;
}
