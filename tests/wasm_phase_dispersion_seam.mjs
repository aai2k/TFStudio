/**
 * The phase-dispersion WASM seam.
 *
 * tmmcore's own suite proves its JavaScript and its C kernel agree. What that
 * cannot cover is TFStudio's side of the boundary: that a design resolved
 * through the material catalog is handed to either backend the same way, so
 * turning WASM on does not change a reported number.
 *
 * Every evaluation in the program funnels through evaluateStackPhaseDispersion,
 * so driving it with WASM off and then on, on the same designs, exercises the
 * whole seam: front and back sides, reflection and transmission, s and p,
 * oblique incidence, the reference-incident jet the back coating needs, and the
 * thickness Jacobian the optimizer runs on.
 *
 *   node tests/wasm_phase_dispersion_seam.mjs
 */

import assert from 'node:assert/strict';
import { setTmmWasmEnabled, tmmWasmActive, getTmmWasm } from 'tmmcore';
import { initWasmForTest } from './_wasmInit.mjs';
import {
    evaluateDesignPhaseDispersion,
    evaluateStackPhaseDispersion,
    evaluateTotalTransmissionDispersion,
} from '../src/utils/physics/phaseDispersion.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';

const ready = await initWasmForTest();
if (!ready) {
    console.log('SKIP: wasm_phase_dispersion_seam (no kernel instantiated)');
    process.exit(0);
}
if (!getTmmWasm().hasPhase()) {
    console.log('SKIP: wasm_phase_dispersion_seam (kernel predates the phase exports)');
    process.exit(0);
}

// GD, GDD and TOD span many decades, and every derivative order amplifies libm
// noise by about a decade. Compare relatively, with an absolute floor so the
// comparison does not divide one rounding error by another near zero.
const REL = 1e-7;
const ABS = 1e-12;
let comparisons = 0;
let worst = 0;

function near(off, on, label) {
    comparisons++;
    if (off === null || on === null || off === undefined || on === undefined) {
        assert.equal(off ?? null, on ?? null, `${label}: one backend produced a value, the other did not`);
        return;
    }
    const difference = Math.abs(off - on);
    const relative = difference / Math.max(Math.abs(off), Math.abs(on), Number.MIN_VALUE);
    if (difference > ABS && relative > worst) worst = relative;
    assert.ok(difference <= ABS || relative <= REL,
        `${label}: js=${off} wasm=${on} Δ=${difference} rel=${relative}`);
}

const QUANTITIES = ['phaseRad', 'phaseDeg', 'gdFs', 'gddFs2', 'todFs3', 'magnitudeSquared'];

function compare(off, on, label) {
    assert.equal(off.valid, on.valid, `${label}: validity differs`);
    if (!off.valid) {
        assert.equal(off.reason, on.reason, `${label}: invalid for different reasons`);
        return;
    }
    for (const key of QUANTITIES) near(off[key], on[key], `${label}.${key}`);
    // Metadata is TFStudio's own and must not depend on the backend at all.
    assert.deepEqual(off.models, on.models, `${label}: material models differ`);
    assert.equal(off.phaseContinuousOrder, on.phaseContinuousOrder,
        `${label}: continuity order differs`);
    assert.equal(off.knotSignature, on.knotSignature, `${label}: knot signature differs`);

    assert.equal(!!off.thicknessJacobian, !!on.thicknessJacobian,
        `${label}: one backend returned a thickness Jacobian and the other did not`);
    if (!off.thicknessJacobian) return;
    for (const quantity of ['phaseDeg', 'gdFs', 'gddFs2', 'todFs3']) {
        const a = off.thicknessJacobian[quantity];
        const b = on.thicknessJacobian[quantity];
        assert.equal(a.length, b.length, `${label}: ${quantity} derivative length differs`);
        for (let i = 0; i < a.length; i++) near(a[i], b[i], `${label}.d${quantity}[${i}]`);
    }
}

/** Run a thunk with WASM forced off, then on, and compare the two results. */
function bothWays(run, label) {
    setTmmWasmEnabled(false);
    assert.equal(tmmWasmActive(), false, 'the flag did not turn the kernel off');
    const off = run();
    setTmmWasmEnabled(true);
    assert.equal(tmmWasmActive(), true, 'the flag did not turn the kernel back on');
    const on = run();
    compare(off, on, label);
}

// A dispersive stack with tabulated and analytic materials mixed, plus a back
// coating, so the reference-incident path and the continuity metadata both run.
const design = {
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { material: 'TiO2', thickness: 91.25 },
        { material: 'SiO2', thickness: 127.5 },
        { material: 'Ta2O5', thickness: 63.5 },
        { material: 'SiO2', thickness: 210.0 },
    ],
    backLayers: [
        { material: 'MgF2', thickness: 80.75 },
        { material: 'Nb2O5', thickness: 55.25 },
    ],
    surfaceMode: 'front_only',
};

const LAMBDAS = [450, 632.8, 800, 1000];
const ANGLES = [0, 17.5, 45];

for (const wavelengthNm of LAMBDAS) {
    for (const thetaDeg of ANGLES) {
        for (const polarization of ['s', 'p']) {
            for (const side of ['front', 'back']) {
                for (const target of ['R', 'T']) {
                    const at = `λ=${wavelengthNm} θ=${thetaDeg} ${polarization} ${side} ${target}`;
                    bothWays(() => evaluateDesignPhaseDispersion(design, {
                        wavelengthNm, side, target, polarization, thetaDeg,
                    }), at);
                }
            }
            bothWays(() => evaluateTotalTransmissionDispersion(design, {
                wavelengthNm, polarization, thetaDeg,
            }), `λ=${wavelengthNm} θ=${thetaDeg} ${polarization} total transmission`);
        }
    }
}

// The optimizer path: the thickness Jacobian, and the embedded back coating that
// carries a dispersive incident-side sine.
const resolve = designMaterialLookup(design);
const frontLayers = design.frontLayers.map(layer => ({
    material: resolve(layer.material), thicknessNm: layer.thickness,
}));
const backLayers = [...design.backLayers].reverse().map(layer => ({
    material: resolve(layer.material), thicknessNm: layer.thickness,
}));

for (const wavelengthNm of LAMBDAS) {
    for (const thetaDeg of ANGLES) {
        for (const polarization of ['s', 'p']) {
            for (const target of ['R', 'T']) {
                bothWays(() => evaluateStackPhaseDispersion({
                    wavelengthNm, target, polarization, thetaDeg,
                    incidentMaterial: resolve(design.incidentMedium),
                    substrateMaterial: resolve(design.substrate.material),
                    layers: frontLayers,
                    withThicknessJacobian: true,
                }), `jacobian front λ=${wavelengthNm} θ=${thetaDeg} ${polarization} ${target}`);

                bothWays(() => evaluateStackPhaseDispersion({
                    wavelengthNm, target, polarization, thetaDeg,
                    incidentMaterial: resolve(design.substrate.material),
                    substrateMaterial: resolve(design.exitMedium),
                    referenceIncidentMaterial: resolve(design.incidentMedium),
                    layers: backLayers,
                    withThicknessJacobian: true,
                }), `jacobian back λ=${wavelengthNm} θ=${thetaDeg} ${polarization} ${target}`);
            }
        }
    }
}

// A stack with no layers at all, and one whose layers are all zero thickness:
// the two backends filter differently in principle, so check they do not here.
for (const layers of [[], frontLayers.map(layer => ({ ...layer, thicknessNm: 0 }))]) {
    bothWays(() => evaluateStackPhaseDispersion({
        wavelengthNm: 550, target: 'R', polarization: 's', thetaDeg: 0,
        incidentMaterial: resolve(design.incidentMedium),
        substrateMaterial: resolve(design.substrate.material),
        layers,
    }), `bare substrate (${layers.length} layers)`);
}

// An opaque absorbing layer, where the imaginary phase clamp engages in both.
bothWays(() => evaluateStackPhaseDispersion({
    wavelengthNm: 550, target: 'R', polarization: 's', thetaDeg: 30,
    incidentMaterial: resolve('Air'),
    substrateMaterial: resolve('BK7'),
    layers: [
        { material: resolve('SiO2'), thicknessNm: 120 },
        { material: resolve('Ag'), thicknessNm: 400 },
        { material: resolve('TiO2'), thicknessNm: 80 },
    ],
    withThicknessJacobian: true,
}), 'opaque silver stack');

setTmmWasmEnabled(false);

console.log(`PASS: wasm_phase_dispersion_seam (${comparisons} comparisons, ` +
    `worst relative difference ${worst === 0 ? 'below the floor' : worst.toExponential(2)})`);
