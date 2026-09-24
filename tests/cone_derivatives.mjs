/**
 * Cone-averaged derivatives on the single-cavity 1550 nm filter.
 *
 *  1. The cone-averaged analytic Jacobian matches central differences of the
 *     cone-averaged residuals (range target, band average, single wavelength,
 *     worst-case minimum), with the cone about the normal and tilted, and a
 *     cone makes the Newton system the Gauss-Newton one.
 *  2. The cone-averaged analytic needle function matches the finite-difference
 *     needle scan.
 *
 * Run: node tests/cone_derivatives.mjs
 */

import { makeOperand, DLSOptimizer, scanNeedlesAnalytic, scanNeedlesFD } from '../src/utils/physics/optimizer.js';
import { initWasmForTest } from './_wasmInit.mjs';
import { MATS, resolveMat, filterDesign } from './_coneFilter.mjs';

await initWasmForTest();

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const CONE = { enabled: true, halfAngleDeg: 5, distribution: 'uniform', gridPoints: 15 };

// Central differences of the residual vector, step h (nm), row × column.
function centralJacobian(engine, h) {
    const thk = engine.thicknesses;
    const cols = thk.map((_, k) => {
        const p = [...thk]; p[k] += h;
        const m = [...thk]; m[k] -= h;
        const rp = engine._residuals(p), rm = engine._residuals(m);
        return rp.map((v, i) => (v - rm[i]) / (2 * h));
    });
    return engine._residuals(thk).map((_, i) => cols.map(c => c[i]));
}

// Largest entry of `reference` and largest |a − reference| over two matrices.
function matrixGap(a, reference) {
    let scale = 0, diff = 0;
    reference.forEach((row, i) => row.forEach((v, k) => {
        scale = Math.max(scale, Math.abs(v));
        diff = Math.max(diff, Math.abs(a[i][k] - v));
    }));
    return { scale, diff };
}

// ── 1. analytic Jacobian against central differences ────────────────────────
for (const axis of [0, 12]) {
    const ops = [
        { ...makeOperand({ type: 'TGT', lambdaStart: 1545, lambdaEnd: 1552, aoi: axis, pol: 'avg', target: 0.5, weight: 1 }), id: 'a', rampPoints: 29 },
        { ...makeOperand({ type: 'TAV', lambdaStart: 1500, lambdaEnd: 1520, aoi: axis, pol: 'avg', target: 0, weight: 2 }), id: 'b', bandPoints: 21 },
        { ...makeOperand({ type: 'R', lambdaStart: 1548, aoi: axis, pol: 's', target: 0, weight: 1 }), id: 'c' },
        { ...makeOperand({ type: 'TMN', lambdaStart: 1546, lambdaEnd: 1552, aoi: axis, target: 0.9, weight: 1 }), id: 'd', bandPoints: 61 },
    ];
    const engine = new DLSOptimizer(ops, filterDesign(CONE), resolveMat);
    const free = engine.thicknesses.map((_, i) => i);
    const J = engine._analyticJacobian(engine.thicknesses, free);
    ok(Array.isArray(J), `axis ${axis}: analytic Jacobian declined under a cone`);
    if (!Array.isArray(J)) continue;
    const Jfd = centralJacobian(engine, 1e-4);
    ok(J.length === Jfd.length, `axis ${axis}: Jacobian rows ${J.length} vs residuals ${Jfd.length}`);
    const { scale, diff } = matrixGap(J, Jfd);
    ok(diff <= 1e-5 * scale, `axis ${axis}: cone Jacobian vs central differences, max |Δ| ${diff.toExponential(2)} on a scale of ${scale.toExponential(2)}`);
    // The curvature sampler reads one angle, so a cone takes Gauss-Newton.
    const gn = engine._gaussNewtonSystem(engine.thicknesses, free);
    const nw = engine._newtonSystem(engine.thicknesses, free);
    ok(nw.H.every((row, a) => row.every((v, b) => v === gn.H[a][b])), `axis ${axis}: Newton system under a cone is the Gauss-Newton one`);
}

// ── 2. needle function against the finite-difference scan ──────────────────
{
    const ops = [
        { ...makeOperand({ type: 'TGT', lambdaStart: 1545, lambdaEnd: 1552, aoi: 0, pol: 'avg', target: 0.5, weight: 1 }), id: 'a', rampPoints: 29 },
        { ...makeOperand({ type: 'TAV', lambdaStart: 1500, lambdaEnd: 1520, aoi: 0, pol: 'avg', target: 0, weight: 1 }), id: 'b', bandPoints: 21 },
    ];
    const args = {
        operands: ops, design: filterDesign(CONE), resolveMat,
        candidateMats: [{ id: 'H', mat: MATS.H }, { id: 'L', mat: MATS.L }], nIntra: 2,
    };
    const analytic = scanNeedlesAnalytic(args);
    ok(analytic !== null, 'analytic needle scan declined under a cone');
    const key = c => `${c.pos}|${c.materialId}`;
    const fdBy = new Map(scanNeedlesFD({ ...args, deltaNm: 1e-4 }).candidates.map(c => [key(c), c.grad]));
    const pairs = (analytic?.candidates || []).filter(c => fdBy.has(key(c)));
    ok(analytic && pairs.length === analytic.candidates.length, `needle candidates matched ${pairs.length}`);
    const scale = Math.max(0, ...pairs.map(c => Math.abs(fdBy.get(key(c)))));
    const diff = Math.max(0, ...pairs.map(c => Math.abs(c.grad - fdBy.get(key(c)))));
    ok(pairs.length > 0 && diff <= 2e-3 * scale, `cone needle function vs FD scan, max |Δ| ${diff.toExponential(2)} on a scale of ${scale.toExponential(2)}`);
}

if (fails === 0) console.log('cone_derivatives: ALL PASS');
else { console.error(`cone_derivatives: ${fails} FAIL(S)`); process.exit(1); }
