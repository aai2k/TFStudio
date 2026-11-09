/**
 * The optimizer's kernel entry points hand tmmcore the caller's layers as they
 * are.
 *
 * Needle, refinement and synthesis evaluate one stack at thousands of
 * wavelengths in each step, so their layers are built once per wavelength as
 * kernelLayer()s, { n, k, d }, and every call passes that array on. Copying
 * them inside each call slows those runs down for no change in the result.
 * This test checks, for every entry point in evalCore/kernels.js:
 *   1. the kernel receives the very array the caller built;
 *   2. the result is bit-identical to the same stack built by pointStack from
 *      [re, im] pairs;
 *   3. layers given as { n: [re, im], d } are refused, so a builder that
 *      returns to that shape fails here and in every optimizer test, rather
 *      than running slower unnoticed.
 *
 * Run: node tests/optimizer_kernel_layers_uncopied.mjs
 */

import './_kernel.mjs';
import { getTmmWasm, __setTmmWasmInstanceForTest } from '../src/tmmcore.js';
import { kernelLayer, pointStack } from '../src/utils/physics/kernelStack.js';
import {
    rtaEval, rtaRaysEval, tmmJacEval, tmmJacRaysEval, tmmHessEval, tmmNeedleScanEval, tmmNeedleScanRaysEval,
} from '../src/utils/physics/optimizer/evalCore/kernels.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const kernel = getTmmWasm();
const CALLS = ['rta', 'rtaSpectrum', 'jacobian', 'jacobianSpectrum', 'hessian', 'needleScan', 'needleScanSpectrum'];

// The loaded kernel, with each call noting the layers its stack carried.
let received = null;
const spy = Object.create(kernel);
for (const name of CALLS) {
    spy[name] = (stack, ...rest) => {
        received = stack.layers;
        return kernel[name](stack, ...rest);
    };
}

const n0 = [1, 0], ns = [1.52, 0];
const pairs = [[2.35, 0.002], [1.46, 0], [2.1, 0.0005]];
const thick = [82, 138, 61];
const layers = pairs.map((nk, i) => kernelLayer(nk, thick[i]));
const pairLayers = pairs.map((nk, i) => ({ n: nk, d: thick[i] }));
const angles = [0, 30, 45];
const needles = { candNs: [[1.46, 0], [2.35, 0]], fracs: [0.25, 0.5] };

// Each entry point with its arguments, and tmmcore's call on the stack the
// entry point should build.
const cases = [
    ['rtaEval', l => rtaEval(550, 30, 'p', n0, ns, l),
        s => kernel.rta(s, 550, { angle: 30, pol: 'p' })],
    ['rtaRaysEval', l => rtaRaysEval(550, angles, { n0, ns, layers: l }),
        s => kernel.rtaSpectrum(s, angles.map(() => 550), { angle: angles, pol: 's' })],
    ['tmmJacEval', l => tmmJacEval(550, 30, 'p', n0, ns, l),
        s => kernel.jacobian(s, 550, { angle: 30, pol: 'p' })],
    ['tmmJacRaysEval', l => tmmJacRaysEval(550, angles, 's', { n0, ns, layers: l }),
        s => kernel.jacobianSpectrum(s, angles.map(() => 550), { angle: angles, pol: 's' })],
    ['tmmHessEval', l => tmmHessEval(550, 30, 'p', n0, ns, l),
        s => kernel.hessian(s, 550, { angle: 30, pol: 'p' })],
    ['tmmNeedleScanEval', l => tmmNeedleScanEval(550, 30, 'p', n0, ns, l, needles.candNs, needles.fracs),
        s => kernel.needleScan(s, 550, { angle: 30, pol: 'p', candidates: [{ n: 1.46, k: 0 }, { n: 2.35, k: 0 }], fractions: needles.fracs })],
    ['tmmNeedleScanRaysEval', l => tmmNeedleScanRaysEval(550, angles, 's', { n0, ns, layers: l }, needles),
        s => kernel.needleScanSpectrum(s, angles.map(() => 550), { angle: angles, pol: 's', candidates: [{ n: 1.46, k: 0 }, { n: 2.35, k: 0 }], fractions: needles.fracs })],
];

// Float64Arrays as plain lists, so JSON compares them value by value.
const flat = value => JSON.stringify(value, (_, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));

__setTmmWasmInstanceForTest(spy);
try {
    for (const [name, call, reference] of cases) {
        received = null;
        const result = call(layers);
        ok(received === layers, `${name}: the kernel received a copy of the layers, not the caller's array`);
        ok(flat(result) === flat(reference(pointStack(n0, ns, pairLayers))),
            `${name}: result differs from the same stack built from [re, im] pairs`);
        let refused = false;
        try { call(pairLayers); } catch (e) { refused = e instanceof TypeError; }
        ok(refused, `${name}: layers as { n: [re, im], d } were accepted`);
    }
} finally {
    __setTmmWasmInstanceForTest(kernel);
}

if (fails === 0) {
    console.log(`PASS: ${cases.length} kernel entry points pass the caller's layers on uncopied.`);
} else {
    console.error(`\n${fails} assertion(s) FAILED.`);
    process.exitCode = 1;
}
