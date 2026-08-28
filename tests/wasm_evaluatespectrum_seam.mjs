/**
 * evaluateSpectrum / evaluateSpectrumBack WASM-seam test (no compiled kernel).
 *
 * Confirms the WASM fast path in thinFilmMath.js produces the SAME spectrum as
 * the JS loop. A JS-backed mock kernel (delegating physics to JS tmm) is
 * injected via the loader's test hook and the feature flag turned on; with a
 * faithful kernel the two paths must agree to the last bit. This validates the
 * material→layerNK gathering, layer ordering (front as-is, back reversed), and
 * polarization selection — independent of the C build.
 *
 * Run: node tests/wasm_evaluatespectrum_seam.mjs
 */

import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../src/utils/physics/thinFilmMath.js';
import { tmm } from '../src/utils/physics/thinFilmMath.js';
import { TmmWasmInstance, __setTmmWasmInstanceForTest, setTmmWasmEnabled } from 'tmmcore';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

// JS-backed mock obeying the C ABI (same as wasm_loader_marshalling.mjs).
let kernelCalls = 0;
function makeMockInstance() {
    const memory = new WebAssembly.Memory({ initial: 64 });
    let bump = 16;
    const malloc = (b) => { bump = (bump + 7) & ~7; const p = bump; bump += b; return p; };
    const free = () => {};
    const f64 = (p, n) => new Float64Array(memory.buffer, p, n);
    // Faithful tmm_one, obeying the same ABI as the C kernel: the layer triples
    // (n, k, d) sit at `ptr` and the R/T/A triple is written at `outPtr`. The
    // substrate-side passes of a whole-sample spectrum go through this one,
    // since each wavelength needs its own angle.
    const tmm_one = (lambda_nm, theta_deg, polCode, n0re, n0im, nsre, nsim, ptr, N, outPtr) => {
        kernelCalls++;
        const buf = f64(ptr, 3 * N);
        const layers = [];
        for (let k = 0; k < N; k++) {
            layers.push({ n: [buf[3 * k], buf[3 * k + 1]], d: buf[3 * k + 2] });
        }
        const out = tmm(lambda_nm, theta_deg, polCode ? 'p' : 's',
            [n0re, n0im], [nsre, nsim], layers);
        const dst = f64(outPtr, 3);
        dst[0] = out.R; dst[1] = out.T; dst[2] = out.A;
    };
    const tmm_jacobian = () => {};
    const tmm_spectrum = (lamPtr, nLam, n0Ptr, nsPtr, mPtr, thPtr, N, theta,
                          rsPtr, tsPtr, asPtr, rpPtr, tpPtr, apPtr) => {
        kernelCalls++;
        const lam = f64(lamPtr, nLam), n0a = f64(n0Ptr, 2 * nLam), nsa = f64(nsPtr, 2 * nLam);
        const mv = f64(mPtr, Math.max(1, 2 * N * nLam)), thv = f64(thPtr, Math.max(1, N));
        const Rs = f64(rsPtr, nLam), Ts = f64(tsPtr, nLam), As = f64(asPtr, nLam);
        const Rp = f64(rpPtr, nLam), Tp = f64(tpPtr, nLam), Ap = f64(apPtr, nLam);
        for (let li = 0; li < nLam; li++) {
            const n0 = [n0a[2 * li], n0a[2 * li + 1]], ns = [nsa[2 * li], nsa[2 * li + 1]];
            const layers = [];
            for (let k = 0; k < N; k++) { const b = (k * nLam + li) * 2; layers.push({ n: [mv[b], mv[b + 1]], d: thv[k] }); }
            const s = tmm(lam[li], theta, 's', n0, ns, layers), p = tmm(lam[li], theta, 'p', n0, ns, layers);
            Rs[li] = s.R; Ts[li] = s.T; As[li] = s.A; Rp[li] = p.R; Tp[li] = p.T; Ap[li] = p.A;
        }
    };
    return { exports: { memory, malloc, free, tmm_one, tmm_spectrum, tmm_jacobian, tmm_needle_scan: () => {} } };
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
        ok(d < 1e-15, `${label} ${key} max|Δ|=${d}`);
    }
    ok(jsRes.lambda.length === wRes.lambda.length, `${label} length`);
}

// JS reference (flag off).
setTmmWasmEnabled(false);
__setTmmWasmInstanceForTest(null);
const jsFront = evaluateSpectrum(params, air, bk7, frontLayers);
const jsBack = evaluateSpectrumBack(params, air, bk7, backLayers);
const jsFrontS = evaluateSpectrum({ ...params, polarization: 's' }, air, bk7, frontLayers);
const jsFrontP = evaluateSpectrum({ ...params, polarization: 'p' }, air, bk7, frontLayers);
// The total-system path is batched at normal incidence only, so it gets its own
// parameters; `params` stays oblique to hold the gate below honest.
const normal = { ...params, theta: 0 };
const jsTotal = evaluateSpectrumTotal(normal, air, bk7, air, frontLayers, backLayers, 1.1);
const jsTotalP = evaluateSpectrumTotal({ ...normal, polarization: 'p' },
    air, bk7, air, frontLayers, backLayers, 1.1);
const jsTotalOblique = evaluateSpectrumTotal(params, air, bk7, air, frontLayers, backLayers, 1.1);

// WASM path (flag on, mock injected).
__setTmmWasmInstanceForTest(new TmmWasmInstance(makeMockInstance()));
setTmmWasmEnabled(true);
const wFront = evaluateSpectrum(params, air, bk7, frontLayers);
const wBack = evaluateSpectrumBack(params, air, bk7, backLayers);
const wFrontS = evaluateSpectrum({ ...params, polarization: 's' }, air, bk7, frontLayers);
const wFrontP = evaluateSpectrum({ ...params, polarization: 'p' }, air, bk7, frontLayers);
// The forward pass runs at the angle of incidence, one angle for the whole grid,
// so it is a single batched call. The two substrate-side passes start at the
// refracted angle, which follows the substrate's dispersion and so differs at
// every wavelength: those go one wavelength at a time, both polarizations.
const nLam = jsTotal.lambda.length;
kernelCalls = 0;
const wTotal = evaluateSpectrumTotal(normal, air, bk7, air, frontLayers, backLayers, 1.1);
ok(kernelCalls === 1 + 4 * nLam,
    `total is one batched pass plus two per-wavelength passes (got ${kernelCalls})`);
const wTotalP = evaluateSpectrumTotal({ ...normal, polarization: 'p' },
    air, bk7, air, frontLayers, backLayers, 1.1);
// The same path serves any angle of incidence: there is no slow fallback left.
kernelCalls = 0;
const wTotalOblique = evaluateSpectrumTotal(params, air, bk7, air, frontLayers, backLayers, 1.1);
ok(kernelCalls === 1 + 4 * nLam,
    `oblique incidence takes the same path (got ${kernelCalls})`);

compareAll('front avg', jsFront, wFront);
compareAll('back avg', jsBack, wBack);
compareAll('front s', jsFrontS, wFrontS);
compareAll('front p', jsFrontP, wFrontP);
compareAll('total avg', jsTotal, wTotal);
compareAll('total p', jsTotalP, wTotalP);
compareAll('total oblique', jsTotalOblique, wTotalOblique);

// Cleanup global state so other tests in the same process are unaffected.
setTmmWasmEnabled(false);
__setTmmWasmInstanceForTest(null);

if (fails === 0) {
    console.log('PASS: evaluateSpectrum WASM seam matches the JS loop (front + back + total + s/p).');
    process.exit(0);
} else {
    console.error(`${fails} assertion(s) FAILED.`);
    process.exit(1);
}
