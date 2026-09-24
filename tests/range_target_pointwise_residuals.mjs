/**
 * Range targets (TGT/RGT/AGT) reach least squares as one residual per sample.
 *
 * A range target scores √(Σ qₛ devₛ²) over its samples, qₛ the trapezoid
 * weights of its band grid. As one residual with one Jacobian row, JᵀJ has rank
 * one per operand and Levenberg-Marquardt reduces to a damped gradient step.
 * Written as n residuals √(w·qₛ)·devₛ the sum of squares is w·Σ qₛ devₛ², so the
 * merit is the same, and the Jacobian has full rank. A measured curve is
 * expanded the same way (measuredCurveOperand.js).
 *
 *   1. The residual vector has one row per sample, its sum of squares is ΣW·MF²,
 *      and the merit equals that of explicit single-wavelength rows with
 *      weight w·qₛ, to round-off.
 *   2. The analytic Jacobian has the same rows and matches central differences
 *      of the residuals, on one surface and on the full two-sided system.
 *   3. A 12-layer TiO2/SiO2 stack under RGT(420-680) = 0: DLS reaches, in 30
 *      steps, the merit the explicit single-wavelength form reaches in 30 steps.
 *   4. A band average (TAV/RAV/AAV) stays one residual, so the windows with no
 *      method choice, the Design Cleaner re-optimize and the manual Needle
 *      refine, use the default refiner the Refinement window starts on.
 *
 * Run: node tests/range_target_pointwise_residuals.mjs
 */
import {
    DLSOptimizer, makeOperand, evaluateOperands, buildEvalContext, calcMF, withDesignSampleCounts,
} from '../src/utils/physics/optimizer.js';
import { operandSampleLambdas, bandQuadratureWeights } from '../src/utils/physics/optimizer/sampling.js';
import { makeEngine, DEFAULT_REFINE_METHOD } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();
const resolveMat = (id) => getMaterial(id);
const deep = (x) => JSON.parse(JSON.stringify(x));
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

// The same merit as one explicit single-wavelength row per sample, weight w·qₛ,
// target on the operand's (flat or ramped) target line.
function pointwiseRows(op) {
    const lams = operandSampleLambdas(op);
    const n = lams.length;
    const q = bandQuadratureWeights(n);
    const t1 = op.targetEnd ?? op.target;
    return lams.map((lambda, s) => makeOperand({
        type: op.type[0], lambdaStart: lambda, lambdaEnd: lambda, aoi: op.aoi, pol: op.pol,
        target: op.target + (t1 - op.target) * (s / (n - 1)), weight: op.weight * q[s],
    }));
}

// Alternating TiO2/SiO2 stack, thicknesses in nm, deliberately off any optimum.
function stack(count, base, extra = {}) {
    const frontLayers = Array.from({ length: count }, (_, i) => ({
        id: `L${i + 1}`, material: i % 2 === 0 ? 'TiO2' : 'SiO2',
        thickness: base[i % base.length] * (1 + 0.25 * Math.sin(1.7 * i + 0.3)), locked: false,
    }));
    return {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side', ...extra,
    };
}

const reflectNothing = makeOperand({ type: 'RGT', lambdaStart: 420, lambdaEnd: 680, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 });
const rampedPass = makeOperand({ type: 'TGT', lambdaStart: 700, lambdaEnd: 760, aoi: 20, pol: 's', target: 0.9, targetEnd: 0.97, weight: 2.5 });

// ── 1. One row per sample, same merit ────────────────────────────────────────
{
    const design = stack(6, [25, 40, 110, 20]);
    const ops = [reflectNothing, rampedPass];
    const eng = new DLSOptimizer(ops, deep(design), resolveMat, { dMin: 1 });
    const r = eng._residuals(eng.thicknesses);
    const rows = operandSampleLambdas(reflectNothing).length + operandSampleLambdas(rampedPass).length;
    ok(r.length === rows, `one residual per sample: ${r.length} rows, expected ${rows}`);

    const ssr = r.reduce((sum, x) => sum + x * x, 0);
    const sumW = reflectNothing.weight + rampedPass.weight;
    ok(rel(ssr, sumW * eng.mf * eng.mf) < 1e-12, `SSR = ΣW·MF² (rel ${rel(ssr, sumW * eng.mf * eng.mf).toExponential(2)})`);

    const ctx = buildEvalContext(design, resolveMat);
    const rangeMf = calcMF(ops, evaluateOperands(ops, ctx));
    const pointOps = ops.flatMap(pointwiseRows);
    const pointMf = calcMF(pointOps, evaluateOperands(pointOps, ctx));
    ok(rel(rangeMf, pointMf) < 1e-12, `range and single-wavelength forms agree: ${rangeMf} vs ${pointMf}`);
    ok(rel(rangeMf, eng.mf) === 0, 'the engine reports the merit of the range rows');
}

// ── 2. Analytic Jacobian rows match central differences ──────────────────────
function checkJacobian(label, design, ops) {
    const eng = new DLSOptimizer(ops, deep(design), resolveMat, { dMin: 1 });
    const thk = eng.thicknesses.slice();
    const freeIdx = thk.map((_, i) => i);
    const J = eng._analyticJacobian(thk, freeIdx);
    const r0 = eng._residuals(thk);
    ok(J && J.length === r0.length, `${label}: ${J?.length} Jacobian rows for ${r0.length} residuals`);
    if (!J || J.length !== r0.length) return;
    const h = 1e-3;   // nm
    let worst = 0;
    for (let c = 0; c < freeIdx.length; c++) {
        const up = thk.slice(); up[c] += h;
        const down = thk.slice(); down[c] -= h;
        const rUp = eng._residuals(up), rDown = eng._residuals(down);
        for (let row = 0; row < r0.length; row++) {
            const fd = (rUp[row] - rDown[row]) / (2 * h);
            worst = Math.max(worst, Math.abs(J[row][c] - fd) / (Math.abs(fd) + 1e-6));
        }
    }
    ok(worst < 1e-4, `${label}: analytic rows match central differences (worst ${worst.toExponential(2)})`);
}
checkJacobian('front surface', stack(6, [25, 40, 110, 20]), [reflectNothing, rampedPass]);
{
    const both = stack(4, [60, 95], { surfaceMode: 'both_independent' });
    both.backLayers = [
        { id: 'B1', material: 'Ta2O5', thickness: 80, locked: false },
        { id: 'B2', material: 'MgF2', thickness: 95, locked: false },
    ];
    checkJacobian('two-sided system', both, [reflectNothing, rampedPass]);
}

// ── 3. DLS on RGT keeps pace with the explicit single-wavelength form ───────
{
    const design = stack(12, [25, 40, 110, 20]);
    const STEPS = 30;
    const run = (ops) => {
        const eng = makeEngine('dls', ops, deep(design), resolveMat, { dMin: 1 });
        for (let i = 0; i < STEPS; i++) eng.step();
        return eng.mf;
    };
    const rangeMf = run([reflectNothing]);
    const pointMf = run(pointwiseRows(reflectNothing));
    ok(rangeMf <= pointMf * 1.01,
        `DLS, ${STEPS} steps: RGT reaches ${rangeMf.toExponential(4)}, single-wavelength rows ${pointMf.toExponential(4)}`);
}

// ── 4. Windows with no method choice refine with the default refiner ─────────
{
    shimBrowserGlobals();
    const { applyCleanup, computeCleanupPreview } =
        await import('../src/components/windows/optimization/designCleaner/model.js');
    const { makeInsertionRefiner } =
        await import('../src/components/windows/optimization/needleManual/model.js');
    const { loadMethod } =
        await import('../src/components/windows/optimization/refinement/refinementConfig.js');
    ok(loadMethod() === DEFAULT_REFINE_METHOD,
        `the Refinement window starts on the default refiner (${loadMethod()} vs ${DEFAULT_REFINE_METHOD})`);

    const bandAverage = makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 });
    const design = stack(10, [25, 40, 110, 20]);
    design.frontLayers.splice(3, 0, { id: 'thin', material: 'SiO2', thickness: 2, locked: false });
    design.meritOperands = [bandAverage];
    const settings = { reoptimize: true, reoptIters: 80, dMin: 5 };
    const preview = computeCleanupPreview(design, { dMin: settings.dMin, mergeAdjacent: true, cleanBack: true });
    const silent = { appliedMsg: () => '', mfRefineMsg: () => '' };
    const { nextDesign } = await applyCleanup(preview, design, silent, settings, resolveMat);

    // The cleaner refines on the band grid it samples the cleaned design with.
    const sampled = withDesignSampleCounts([bandAverage], preview.design, resolveMat);
    const direct = makeEngine(DEFAULT_REFINE_METHOD, sampled, preview.design, resolveMat, { dMin: settings.dMin });
    for (let i = 0; i < settings.reoptIters && !direct.isConverged(); i++) direct.step();
    direct.restoreBest();
    const expected = direct.applyToDesign(preview.design).frontLayers.map(l => l.thickness);
    ok(nextDesign.frontLayers.length === expected.length
        && nextDesign.frontLayers.every((l, i) => l.thickness === expected[i]),
        'Design Cleaner re-optimize runs the default refiner');

    const refiner = makeInsertionRefiner([bandAverage], deep(design), resolveMat, settings.dMin);
    const reference = makeEngine(DEFAULT_REFINE_METHOD, [bandAverage], deep(design), resolveMat);
    ok(refiner.constructor === reference.constructor, `manual Needle refines with the default refiner (${refiner.constructor.name})`);
}

if (fails === 0) { console.log('PASS: range targets reach least squares one residual per sample'); process.exit(0); }
console.error(`\n${fails} assertion(s) failed`);
process.exit(1);
