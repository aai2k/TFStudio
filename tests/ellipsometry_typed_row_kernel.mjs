/**
 * A hand-typed ellipsometry row (PSI, DEL, TANPSI or COSDEL at one wavelength,
 * not expanded from a measured block) is evaluated on the phase kernel when one
 * is active, as a measured block's points are, and gives the numbers the
 * JavaScript point evaluator gives.
 *
 * The kernel's batched phase call is counted: four rows at one wavelength and
 * angle share one pass, one call per polarization, and rows at a second
 * wavelength take a pass of their own. With the kernel off the rows still
 * evaluate, on the JavaScript path.
 *
 *   node tests/ellipsometry_typed_row_kernel.mjs
 */

import assert from 'node:assert/strict';
import { getTmmWasm, setTmmWasmEnabled, tmmWasmActive } from 'tmmcore';
import { initWasmForTest } from './_wasmInit.mjs';
import { makeOperand, evaluateOperands, buildEvalContext } from '../src/utils/physics/optimizer.js';
import { computeEllipsometry } from '../src/utils/physics/thinFilmMath.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

if (!(await initWasmForTest()) || !getTmmWasm().hasPhase()) {
    console.log('SKIP: ellipsometry_typed_row_kernel (no kernel with the phase exports)');
    process.exit(0);
}

const resolveMat = id => getMaterial(id);
const design = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'L1', material: 'Ta2O5', thickness: 120, locked: false },
        { id: 'L2', material: 'SiO2', thickness: 180, locked: false },
        { id: 'L3', material: 'Cr', thickness: 12, locked: false },
        { id: 'L4', material: 'SiO2', thickness: 95, locked: false },
    ],
    backLayers: [],
    surfaceMode: 'front_only',
};

const kernel = getTmmWasm();
const batched = kernel.phaseSpectrum;
let calls = 0;
kernel.phaseSpectrum = function counted(...args) {
    calls++;
    return batched.apply(this, args);
};

const AOI = 65;
const TYPES = ['PSI', 'DEL', 'TANPSI', 'COSDEL'];
const rowsAt = lambda => TYPES.map(type => makeOperand({ type, lambdaStart: lambda, aoi: AOI }));

function reference(lambda) {
    const at = material => getMaterial(material).getNK(lambda);
    const layers = design.frontLayers.map(layer => ({ n: at(layer.material), d: layer.thickness }));
    const e = computeEllipsometry(lambda, AOI, at('Air'), at('BK7'), layers);
    // A new DEL row reads the Azzam-Bashara Δ, 360° minus the point evaluator's.
    return [e.psi, 360 - e.delta, e.tanPsi, e.cosDelta];
}

function check(values, lambda, label) {
    const expected = reference(lambda);
    TYPES.forEach((type, index) => {
        assert.ok(Math.abs(values[index] - expected[index]) < 1e-9,
            `${label}: ${type} at ${lambda} nm is ${values[index]}, the point evaluator gives ${expected[index]}`);
    });
}

// One wavelength: one pass, one call per polarization.
assert.equal(tmmWasmActive(), true);
const ctx = buildEvalContext(design, resolveMat);
calls = 0;
check(evaluateOperands(rowsAt(633), ctx), 633, 'kernel on');
assert.equal(calls, 2, `four rows at one wavelength made ${calls} kernel calls, expected 2`);

// A second wavelength takes its own pass.
calls = 0;
const both = evaluateOperands([...rowsAt(633), ...rowsAt(450)], ctx);
check(both.slice(0, 4), 633, 'two wavelengths');
check(both.slice(4), 450, 'two wavelengths');
assert.equal(calls, 4, `rows at two wavelengths made ${calls} kernel calls, expected 4`);

// Kernel off: the JavaScript path, the same numbers.
setTmmWasmEnabled(false);
calls = 0;
check(evaluateOperands(rowsAt(633), buildEvalContext(design, resolveMat)), 633, 'kernel off');
assert.equal(calls, 0, 'the kernel was called while it was off');
setTmmWasmEnabled(true);
kernel.phaseSpectrum = batched;

console.log('PASS: ellipsometry_typed_row_kernel');
