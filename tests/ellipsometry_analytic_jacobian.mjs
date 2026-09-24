/**
 * The exact thickness Jacobian of the ellipsometry operands.
 *
 * Ψ, Δ, tan Ψ and cos Δ used to decline the analytic Jacobian, which put a
 * whole merit function onto central differences as soon as one of them was in
 * it: 2N full evaluations per step for N free layers. Δ is a difference of the
 * two reflection phases the phase kernel already differentiates, and Ψ follows
 * from |r_s|², |r_p|² and their derivatives out of the intensity Jacobian, so
 * every row is now assembled from one pass.
 *
 * Held here: each operand type against a central-difference Jacobian on
 * dielectric and absorbing stacks at two angles; the same for the points a
 * measured Ψ/Δ pair expands into; the surface modes; kernel against JavaScript;
 * opaque stacks whose matrix product leaves the range of a double; and that a
 * Ψ target no longer drags an R target onto finite differences.
 *
 * Run: node tests/ellipsometry_analytic_jacobian.mjs
 */
import assert from 'node:assert/strict';

import { initWasmForTest } from './_wasmInit.mjs';
import { getTmmWasm, setTmmWasmEnabled } from 'tmmcore';
import {
    DLSOptimizer, buildEvalContext, evaluateOperands, makeMeasuredCurveOperand, makeOperand,
} from '../src/utils/physics/optimizer.js';
import { _operandSupportsFullNewton } from '../src/utils/physics/optimizer/newtonAssembly/curvature.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import {
    computeEllipsometry, evaluateEllipsometryThicknessJacobian, toDeltaConvention,
} from '../src/utils/physics/thinFilmMath.js';

const kernel = await initWasmForTest();
const resolveMat = id => getMaterial(id);

const STACKS = {
    'AR 4L dielectric': [['TiO2', 95], ['SiO2', 150], ['TiO2', 70], ['SiO2', 130]],
    'QW 9L': Array.from({ length: 9 }, (_, i) => (i % 2 ? ['SiO2', 94.2] : ['TiO2', 59.5])),
    'absorbing Cr/SiO2': [['SiO2', 120], ['Cr', 20], ['SiO2', 90]],
};
const ELLIPSOMETRY_TYPES = ['PSI', 'DEL', 'TANPSI', 'COSDEL'];

function designOf(spec, extra = {}) {
    return {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        frontLayers: spec.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false })),
        backLayers: [],
        surfaceMode: 'front_only', mfEvalMode: 'side',
        ...extra,
    };
}

// Central-difference Jacobian of the engine's own residual vector. Ψ can move
// several degrees per nanometre on a low-reflectance stack, so the step is
// far finer than the quarter nanometre the R/T Jacobian test uses.
function fdJacobian(opt, thk, freeIdx, h = 0.02) {
    const r0 = opt._residuals(thk);
    const J = Array.from({ length: r0.length }, () => new Array(freeIdx.length).fill(0));
    for (let column = 0; column < freeIdx.length; column++) {
        const k = freeIdx[column];
        const up = thk.slice(); up[k] += h;
        const down = thk.slice(); down[k] -= h;
        const rUp = opt._residuals(up);
        const rDown = opt._residuals(down);
        for (let row = 0; row < rUp.length; row++) J[row][column] = (rUp[row] - rDown[row]) / (2 * h);
    }
    return J;
}

// The analytic Jacobian must exist and agree with finite differences to the
// FD truncation: a tenth of a percent of the entries' RMS, with a floor for
// rows that are nearly flat.
function assertAnalyticMatchesFd(tag, ops, design) {
    const opt = new DLSOptimizer(ops, design, resolveMat);
    const thk = opt.thicknesses.slice();
    const freeIdx = thk.map((_, i) => i).filter(i => !opt.lockedMask[i]);
    const analytic = opt._analyticJacobian(thk, freeIdx);
    assert.ok(analytic, `${tag}: the analytic Jacobian must not decline`);
    const fd = fdJacobian(opt, thk, freeIdx);
    assert.equal(analytic.length, fd.length, `${tag}: row count`);
    let sumSq = 0, count = 0, worst = 0;
    for (let row = 0; row < fd.length; row++) {
        assert.equal(analytic[row].length, fd[row].length, `${tag}: column count`);
        for (let column = 0; column < fd[row].length; column++) {
            sumSq += fd[row][column] ** 2;
            count++;
            worst = Math.max(worst, Math.abs(analytic[row][column] - fd[row][column]));
        }
    }
    const rms = Math.sqrt(sumSq / count);
    const tolerance = Math.max(4e-6, 1e-3 * rms);
    assert.ok(worst < tolerance,
        `${tag}: max |analytic − FD| = ${worst.toExponential(2)}, rms ${rms.toExponential(2)}, tolerance ${tolerance.toExponential(2)}`);
    return { opt, analytic, worst, rms };
}

// ── Every ellipsometry operand, every stack, two angles ──────────────────────
for (const [name, spec] of Object.entries(STACKS)) {
    for (const aoi of [45, 70]) {
        for (const type of ELLIPSOMETRY_TYPES) {
            const ops = [550, 620].map((lambda, i) => makeOperand({
                id: `${type}-${i}`, type, lambdaStart: lambda, aoi, target: 0, weight: 1 + i,
            }));
            assertAnalyticMatchesFd(`${name} ${type} at ${aoi}°`, ops, designOf(spec));
        }
    }
}

// ── A Ψ target no longer drags the rest of the table onto finite differences ─
{
    const ops = [
        makeOperand({ id: 'psi', type: 'PSI', lambdaStart: 550, aoi: 70, target: 30, weight: 1 }),
        makeOperand({ id: 'del', type: 'DEL', lambdaStart: 600, aoi: 70, target: 90, weight: 2 }),
        makeOperand({ id: 'r', type: 'R', lambdaStart: 550, aoi: 0, pol: 'avg', target: 0.02, weight: 1 }),
        makeOperand({ id: 'rav', type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    ];
    assertAnalyticMatchesFd('mixed Ψ, Δ, R, RAV', ops, designOf(STACKS['AR 4L dielectric']));
}

// ── The points a measured Ψ/Δ pair expands into ──────────────────────────────
//
// The block's points share one batched pass; the derivative of each must still
// be the derivative of that point alone.
{
    const truth = designOf([['TiO2', 120], ['SiO2', 200]]);
    const lambdas = Array.from({ length: 41 }, (_, i) => 400 + i * 7.5);
    const ctx = buildEvalContext(truth, resolveMat);
    const pointOps = type => lambdas.map((lambda, i) => makeOperand({
        id: `${type}${i}`, type, lambdaStart: lambda, aoi: 70, target: 0,
    }));
    const psi = Array.from(evaluateOperands(pointOps('PSI'), ctx));
    const delta = toDeltaConvention(Array.from(evaluateOperands(pointOps('DEL'), ctx)), 'azzam');
    const blocks = [
        makeMeasuredCurveOperand({ id: 'psi-block', quantity: 'PSI', aoi: 70, side: 'front', sampleLambdas: lambdas, sampleTargets: psi }),
        makeMeasuredCurveOperand({ id: 'del-block', quantity: 'DEL', aoi: 70, side: 'front', deltaConvention: 'azzam', sampleLambdas: lambdas, sampleTargets: delta }),
    ];
    const start = designOf([['TiO2', 104], ['SiO2', 212]]);
    const { opt } = assertAnalyticMatchesFd('measured Ψ/Δ blocks', blocks, start);
    assert.equal(opt.operands.length, 2 * lambdas.length);

    // And the recovery still lands, now on the analytic rows.
    for (let iteration = 0; iteration < 60 && !opt.isConverged(); iteration++) opt.step();
    opt.restoreBest();
    assert.ok(Math.abs(opt.thicknesses[0] - 120) < 0.05 && Math.abs(opt.thicknesses[1] - 200) < 0.05,
        `expected 120 / 200 nm, got ${opt.thicknesses.map(v => v.toFixed(3))}`);
}

// ── Surface modes ────────────────────────────────────────────────────────────
//
// Ψ and Δ read the front stack alone. In symmetric mode the mirrored back copy
// does not enter them; in both_independent mode the back variables get zero;
// in back_only mode the front stack is fixed and the whole row is zero, which
// finite differences confirm.
{
    const spec = STACKS['AR 4L dielectric'];
    const ops = [
        makeOperand({ id: 'psi', type: 'PSI', lambdaStart: 550, aoi: 65, target: 30, weight: 1 }),
        makeOperand({ id: 'del', type: 'DEL', lambdaStart: 550, aoi: 65, target: 100, weight: 1 }),
    ];
    const back = spec.map(([material, thickness], i) => ({ id: `B${i}`, material, thickness: thickness * 0.8, locked: false }));
    assertAnalyticMatchesFd('symmetric', ops, designOf(spec, { surfaceMode: 'symmetric' }));
    const both = assertAnalyticMatchesFd('both_independent', ops,
        designOf(spec, { surfaceMode: 'both_independent', backLayers: back }));
    assert.ok(both.analytic.every(row => row.slice(spec.length).every(value => value === 0)),
        'back-side variables carry no Ψ/Δ derivative');
    const backOnly = assertAnalyticMatchesFd('back_only', ops,
        designOf(spec, { surfaceMode: 'back_only', backLayers: back }));
    assert.ok(backOnly.analytic.every(row => row.every(value => value === 0)),
        'in back_only the front stack is fixed, so the row is zero');
}

// ── The kernel and the JavaScript reference agree, and both match the values ─
//
// Every sample must carry its Jacobian, the two paths must agree on it, and Ψ
// and Δ must be those of the point evaluator.
function assertKernelMatchesJavaScript(tag, spec, lambdas, aoi) {
    const materials = spec.map(([id]) => getMaterial(id));
    const thick = spec.map(([, d]) => d);
    const substrate = getMaterial('BK7');
    const evaluate = () => evaluateEllipsometryThicknessJacobian({
        lambdas,
        theta_deg: aoi,
        n0List: lambdas.map(() => [1, 0]),
        nsList: lambdas.map(lam => substrate.getNK(lam)),
        layerNK: materials.map(material => lambdas.map(lam => material.getNK(lam))),
        thick,
    });

    setTmmWasmEnabled(false);
    const javascript = evaluate();
    setTmmWasmEnabled(kernel);
    const accelerated = evaluate();
    for (let i = 0; i < lambdas.length; i++) {
        const at = `${tag}, λ ${lambdas[i]}`;
        const layers = materials.map((material, k) => ({ n: material.getNK(lambdas[i]), d: thick[k] }));
        const point = computeEllipsometry(lambdas[i], aoi, [1, 0], substrate.getNK(lambdas[i]), layers);
        for (const [label, sample] of [['javascript', javascript[i]], ['kernel', accelerated[i]]]) {
            assert.ok(sample, `${at}: the ${label} sample carries its Jacobian`);
            assert.ok([...sample.dPsi, ...sample.dDelta].every(Number.isFinite), `${at}: ${label} derivatives are finite`);
            assert.ok(Math.abs(sample.psi - point.psi) < 1e-8, `${at}: ${label} Ψ matches the point evaluator`);
            const deltaGap = Math.abs(sample.delta - point.delta) % 360;
            assert.ok(Math.min(deltaGap, 360 - deltaGap) < 1e-7, `${at}: ${label} Δ matches the point evaluator`);
        }
        for (let k = 0; k < thick.length; k++) {
            const scale = Math.max(1e-6, Math.abs(javascript[i].dPsi[k]), Math.abs(javascript[i].dDelta[k]));
            assert.ok(Math.abs(javascript[i].dPsi[k] - accelerated[i].dPsi[k]) < 1e-7 * scale,
                `${at}: dΨ/dd agrees between kernel and JavaScript, layer ${k}`);
            assert.ok(Math.abs(javascript[i].dDelta[k] - accelerated[i].dDelta[k]) < 1e-7 * scale,
                `${at}: dΔ/dd agrees between kernel and JavaScript, layer ${k}`);
        }
    }
}

assertKernelMatchesJavaScript('QW 9L', STACKS['QW 9L'], [450, 500, 550, 600], 65);
if (kernel) {
    console.log(`kernel path: ${getTmmWasm().hasPhaseJacobianSpectrum?.() ? 'batched' : 'per-wavelength'} phase Jacobian`);
}

// ── Opaque stacks keep their analytic Jacobian ──────────────────────────────
//
// Six layers of 3000 nm chromium hold every layer's imaginary phase at the
// opaque-layer clamp, and the characteristic-matrix product through them runs
// to about 1e128. The phase Jacobian's prefix and suffix products carry binary
// exponents that cancel from every derivative, so each sample comes back with
// its Jacobian and the engine keeps the analytic rows. Held to central
// differences on that stack, where the chromium moves only through the real
// part of its phase and its derivatives are of order e^−100, and on a
// dielectric pair over the same chromium, whose rows are of order one and come
// through the same scaled product.
{
    const chromium = Array.from({ length: 6 }, () => ['Cr', 3000]);
    const OPAQUE = {
        'six 3000 nm Cr layers': chromium,
        'SiO2/TiO2 over the Cr': [['SiO2', 120], ['TiO2', 60], ...chromium],
    };
    for (const [name, spec] of Object.entries(OPAQUE)) {
        assertKernelMatchesJavaScript(name, spec, [500, 550, 600], 65);
        const ops = [550, 600].flatMap((lambda, i) => ['PSI', 'DEL'].map(type => makeOperand({
            id: `${type}-${i}`, type, lambdaStart: lambda, aoi: 65, target: 0, weight: 1,
        })));
        for (const backend of kernel ? [false, true] : [false]) {
            setTmmWasmEnabled(backend);
            assertAnalyticMatchesFd(`${name}, ${backend ? 'kernel' : 'JavaScript'}`, ops, designOf(spec));
        }
    }
    setTmmWasmEnabled(kernel);
}

// ── Newton keeps its hands off rows it has no curvature for ─────────────────
for (const type of ELLIPSOMETRY_TYPES) {
    assert.equal(_operandSupportsFullNewton(makeOperand({ type, lambdaStart: 550, aoi: 65 })), false,
        `${type} is not eligible for the full analytic Hessian`);
}

console.log('PASS: ellipsometry_analytic_jacobian');
