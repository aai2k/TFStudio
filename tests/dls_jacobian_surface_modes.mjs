/**
 * DLS analytic-Jacobian surface-mode tests (follow-up to surface-mode
 * extension, 2026-05-22).
 *
 * Verifies _analyticJacobian agrees with a central-difference Jacobian on
 * the same design + operand set in EVERY surface mode (front_only,
 * back_only, symmetric, both_independent). The analytic Jacobian is the
 * exact h→0 limit of central differences, so they must agree to O(h²).
 *
 * Run: node tests/dls_jacobian_surface_modes.mjs
 */

import {
    DLSOptimizer, makeOperand,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const resolveMat = id => getMaterial(id);

function makeDesign(surfaceMode, mfEvalMode = 'side') {
    const front = [
        { id: 'F1', material: 'TiO2', thickness: 90,  locked: false },
        { id: 'F2', material: 'SiO2', thickness: 150, locked: false },
        { id: 'F3', material: 'TiO2', thickness: 65,  locked: false },
    ];
    const backSym = front.slice().reverse().map(l => ({ ...l, id: 'B' + l.id.slice(1) }));
    const backInd = [
        { id: 'B1', material: 'SiO2', thickness: 110, locked: false },
        { id: 'B2', material: 'TiO2', thickness: 75,  locked: false },
    ];
    return {
        incidentMedium: 'Air',
        exitMedium:     'Air',
        substrate:      { material: 'BK7', thickness: 1.0 },
        frontLayers:    front,
        backLayers:     surfaceMode === 'symmetric' ? backSym : backInd,
        surfaceMode,
        mfEvalMode,
    };
}

function makeOps() {
    return [
        makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0,    weight: 1 }),
        makeOperand({ type: 'TAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1,    weight: 1 }),
        makeOperand({ type: 'R',   lambdaStart: 550,                   aoi: 0, pol: 'avg', target: 0,    weight: 1 }),
    ];
}

// Central-difference Jacobian using DLSOptimizer's _residuals().
function fdJacobian(opt, thk, freeIdx, h = 0.5) {
    const r0 = opt._residuals(thk);
    const J = Array.from({ length: r0.length }, () => new Array(freeIdx.length).fill(0));
    for (let ci = 0; ci < freeIdx.length; ci++) {
        const k = freeIdx[ci];
        const thkP = thk.slice(); thkP[k] = thk[k] + h;
        const thkM = thk.slice(); thkM[k] = thk[k] - h;
        const rp = opt._residuals(thkP);
        const rm = opt._residuals(thkM);
        for (let i = 0; i < rp.length; i++) J[i][ci] = (rp[i] - rm[i]) / (2 * h);
    }
    return J;
}

function maxAbsDiff(A, B) {
    let m = 0;
    for (let i = 0; i < A.length; i++)
        for (let j = 0; j < A[i].length; j++)
            m = Math.max(m, Math.abs(A[i][j] - B[i][j]));
    return m;
}

function runOne(mode, mfEvalMode = 'side') {
    const design = makeDesign(mode, mfEvalMode);
    const ops    = makeOps();
    const opt    = new DLSOptimizer(ops, design, resolveMat);
    const tag    = mfEvalMode === 'total' ? `${mode}+total` : mode;

    const thk     = opt.thicknesses.slice();
    const freeIdx = thk.map((_, i) => i).filter(i => !opt.lockedMask[i]);

    const Jana = opt._analyticJacobian(thk, freeIdx);
    ok(Jana != null, `[${tag}] analytic Jacobian must not be null`);
    if (!Jana) return;

    const Jfd = fdJacobian(opt, thk, freeIdx, 0.25);

    // Shape check
    ok(Jana.length === Jfd.length, `[${tag}] row count matches FD`);
    ok(Jana[0].length === Jfd[0].length, `[${tag}] col count matches FD`);

    // Magnitude scale: take RMS of FD entries as the reference.
    let rms = 0, n = 0;
    for (const row of Jfd) for (const v of row) { rms += v * v; n++; }
    rms = Math.sqrt(rms / n);
    // Analytic Jacobian is the exact h→0 limit; the residual measured here is
    // the FD reference's own O(h²) truncation at h=0.25 — largest in symmetric
    // mode (front + mirrored-back double the curvature on the single-λ term).
    // 0.1% relative + 4e-6 floor stays far below any value that could mask a
    // genuine analytic error (which would scale with rms, not with h²).
    const tol = Math.max(4e-6, 1e-3 * rms);

    const diff = maxAbsDiff(Jana, Jfd);
    ok(diff < tol,
        `[${tag}] max |J_analytic − J_FD| = ${diff.toExponential(2)} ` +
        `(rms ≈ ${rms.toExponential(2)}, tol ${tol.toExponential(2)})`);
    console.log(`  ${tag.padEnd(20)}  J shape ${Jana.length}×${Jana[0].length}  ` +
                `max diff = ${diff.toExponential(2)}  tol = ${tol.toExponential(2)}`);
}

console.log('DLS analytic-Jacobian vs FD, per surface mode:');
runOne('front_only');
runOne('back_only');
runOne('symmetric');
runOne('both_independent');
// New: single-side optimize + total (full-system) MF evaluation. The analytic
// Jacobian reuses the full-system chain rule with free vars on one side only.
runOne('front_only', 'total');
runOne('back_only',  'total');

if (fails === 0) {
    console.log('\nALL PASS');
    process.exit(0);
} else {
    console.log(`\n${fails} FAIL(S)`);
    process.exit(1);
}
