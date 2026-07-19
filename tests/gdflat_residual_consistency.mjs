/**
 * Regression: the LSQ engine's residual vector must be consistent with calcMF
 * for a group-delay-flatness operand (GDFLAT/GDDFLAT) with a NON-ZERO target.
 *
 * GDFLAT's comp value is already the RMS deviation of GD from the flat target
 * level — the target is subtracted INSIDE the RMS (evalCore `_evalGroupDelayFlat`).
 * So the least-squares residual is that RMS itself (calcMF/`_operandResidual`
 * treat it like a ramp: residual = comp). A regressed `_residuals` that fell
 * through to the generic "comp − target" branch double-subtracted the target,
 * so the optimizer descended Σ(comp − target)² while reporting/accepting Σcomp²
 * — a silently wrong step direction whenever the flat target is non-zero.
 *
 * This locks `_residuals` to the reported merit: MF-from-residuals == calcMF.
 */

import {
    makeOperand, evaluateOperands, calcMF, buildEvalContext,
    operandResidualScale, DLSOptimizer,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const close = (a, b, eps) => Math.abs(a - b) <= eps;

const design = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'L1', material: 'Ta2O5', thickness: 120, locked: false },
        { id: 'L2', material: 'SiO2',  thickness: 180, locked: false },
        { id: 'L3', material: 'Ta2O5', thickness:  95, locked: false },
    ],
    backLayers: [],
    surfaceMode: 'front_only',
};

for (const type of ['GDFLAT', 'GDDFLAT']) {
    // A non-zero flat target — the case the regressed path double-subtracted.
    const op = makeOperand({ type, lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 's', target: 30, weight: 1 });
    const ctx = buildEvalContext(design, resolveMat);
    const comp = evaluateOperands([op], ctx);
    const compVal = comp[0];
    ok(Number.isFinite(compVal) && compVal > 0, `${type}: comp is a positive RMS deviation`);

    // The RMS already bakes in the target, so a further "− target" would differ.
    ok(!close(compVal, compVal - op.target, 1e-9), `${type}: comp and comp−target differ (target is non-trivial)`);

    const scale = operandResidualScale(op);   // 50 for GD/GDD
    const expected = Math.sqrt(op.weight) * compVal / scale;   // √w·RMS/σ, NOT (RMS−target)

    const opt = new DLSOptimizer([op], JSON.parse(JSON.stringify(design)), resolveMat);
    const r = opt._residuals(opt.thicknesses);
    ok(r.length === 1, `${type}: one residual row for the single operand`);
    ok(close(r[0], expected, 1e-12),
        `${type}: residual = √w·RMS/σ (target already inside the RMS, not subtracted again)`);

    // The optimizer must minimize the objective it reports: MF-from-residuals == calcMF.
    const mfDirect = calcMF([op], comp);
    const mfFromRes = Math.sqrt((r[0] * r[0]) / op.weight);
    ok(close(mfFromRes, mfDirect, 1e-12),
        `${type}: _residuals is consistent with calcMF (${mfFromRes.toExponential(4)} vs ${mfDirect.toExponential(4)})`);
}

// ── The unified residual keeps _residuals consistent with calcMF for EVERY
//    phase/field operand added in 1.3.0 (ellipsometry, GD/GDD point, EFMX), not
//    just the flatness ones. MF-from-residuals must equal the reported calcMF. ──
{
    const ops = [
        makeOperand({ type: 'PSI',     lambdaStart: 550, aoi: 60, target: 30, weight: 1 }),
        makeOperand({ type: 'DEL',     lambdaStart: 550, aoi: 60, target: 90, weight: 1 }),
        makeOperand({ type: 'TANPSI',  lambdaStart: 550, aoi: 60, target: 0.5, weight: 1 }),
        makeOperand({ type: 'COSDEL',  lambdaStart: 550, aoi: 60, target: 0.2, weight: 1 }),
        makeOperand({ type: 'GD',      lambdaStart: 550, aoi: 0, pol: 's', target: 5,  weight: 1 }),
        makeOperand({ type: 'GDD',     lambdaStart: 550, aoi: 0, pol: 's', target: -3, weight: 1 }),
        makeOperand({ type: 'GDFLAT',  lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 's', target: 20, weight: 1 }),
        makeOperand({ type: 'EFMX',    lambdaStart: 550, aoi: 0, pol: 's', target: 1.2, weight: 1 }),
    ];
    const ctx = buildEvalContext(design, resolveMat);
    const comp = evaluateOperands(ops, ctx);
    const mfDirect = calcMF(ops, comp);

    const opt = new DLSOptimizer(ops, JSON.parse(JSON.stringify(design)), resolveMat);
    const r = opt._residuals(opt.thicknesses);
    ok(r.length === ops.length, `mixed 1.3.0 ops: one residual per operand (${r.length}/${ops.length})`);
    const sumW = ops.reduce((s, o) => s + o.weight, 0);   // all non-constraint → full denominator
    let sos = 0; for (const ri of r) sos += ri * ri;
    const mfFromRes = Math.sqrt(sos / sumW);
    ok(close(mfFromRes, mfDirect, 1e-12),
        `mixed 1.3.0 ops: _residuals consistent with calcMF (${mfFromRes.toExponential(6)} vs ${mfDirect.toExponential(6)})`);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
