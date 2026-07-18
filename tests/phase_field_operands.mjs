/**
 * Tests for the phase/field merit operands:
 *   • PSI/DEL/TANPSI/COSDEL — ellipsometric Ψ, Δ, tanΨ, cosΔ at a wavelength
 *   • GD/GDD                — reflection group delay (fs) / GDD (fs²) at λ
 *   • GDFLAT/GDDFLAT        — RMS deviation of GD/GDD from a flat target band
 *   • EFMX                  — peak normalized |E|² in the coating
 *
 * The operand evaluators must agree with the standalone thinFilmMath routines
 * that power the Ellipsometry / GD-GDD / E-field analysis windows (front side),
 * carry the right physical units, and force the finite-difference Jacobian.
 */

import {
    makeOperand, evaluateOperands, calcMF, buildEvalContext,
    isPhase, isEllipsometry, isGroupDelay, isGroupDelayFlat, isEField, isFractionalUnit,
    operandResidualScale, OPERAND_TYPES, DLSOptimizer,
} from '../src/utils/physics/optimizer.js';
import {
    computeEllipsometry, computeGroupDelaySpectrum, computeEFieldProfile,
    tmmWithAdmittances,
} from '../src/utils/physics/thinFilmMath.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const close = (a, b, eps) => Math.abs(a - b) <= eps;

// A quarter-wave-ish HL stack on BK7.
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
const ctx = buildEvalContext(design, resolveMat);

// Reference n0/ns/layers at λ, matching what _frontStackAt builds in evalCore.
function refStack(lam) {
    const n0 = getMaterial('Air').getNK(lam);
    const ns = getMaterial('BK7').getNK(lam);
    const layers = design.frontLayers.map(l => ({ n: getMaterial(l.material).getNK(lam), d: l.thickness }));
    return { n0, ns, layers };
}

// ── Registry / predicate sanity ───────────────────────────────────────────────
for (const t of ['PSI', 'DEL', 'TANPSI', 'COSDEL', 'GD', 'GDD', 'GDFLAT', 'GDDFLAT', 'EFMX']) {
    ok(OPERAND_TYPES.includes(t), `${t} registered`);
    ok(isPhase(t), `isPhase(${t})`);
    ok(!isFractionalUnit(t), `${t} not a fractional unit`);
}
ok(['PSI', 'DEL', 'TANPSI', 'COSDEL'].every(isEllipsometry), 'isEllipsometry');
ok(['GD', 'GDD', 'GDFLAT', 'GDDFLAT'].every(isGroupDelay), 'isGroupDelay');
ok(isGroupDelayFlat('GDFLAT') && isGroupDelayFlat('GDDFLAT') && !isGroupDelayFlat('GD'), 'isGroupDelayFlat');
ok(isEField('EFMX'), 'isEField');

// ── Residual scales are the documented per-type σ ─────────────────────────────
ok(operandResidualScale({ type: 'PSI' }) === 90, 'σ(PSI) = 90');
ok(operandResidualScale({ type: 'DEL' }) === 180, 'σ(DEL) = 180');
ok(operandResidualScale({ type: 'GD' }) === 50 && operandResidualScale({ type: 'GDD' }) === 50, 'σ(GD/GDD) = 50');
ok(operandResidualScale({ type: 'EFMX' }) === 1, 'σ(EFMX) = 1');

// ── Ellipsometry operands agree with computeEllipsometry ──────────────────────
{
    const lam = 550, aoi = 60;
    const { n0, ns, layers } = refStack(lam);
    const e = computeEllipsometry(lam, aoi, n0, ns, layers);
    const val = type => evaluateOperands([makeOperand({ type, lambdaStart: lam, aoi })], ctx)[0];
    ok(close(val('PSI'), e.psi, 1e-9), 'PSI matches computeEllipsometry.psi');
    ok(close(val('DEL'), e.delta, 1e-9), 'DEL matches computeEllipsometry.delta');
    ok(close(val('TANPSI'), e.tanPsi, 1e-9), 'TANPSI matches tanΨ');
    ok(close(val('COSDEL'), e.cosDelta, 1e-9), 'COSDEL matches cosΔ');
}

// ── GD/GDD point operands agree with computeGroupDelaySpectrum ────────────────
{
    const lam = 550, aoi = 0;
    const coeffAt = (l) => {
        const { n0, ns, layers } = refStack(l);
        return tmmWithAdmittances(l, aoi, 's', n0, ns, layers.filter(x => x.d > 0)).r;
    };
    const half = Math.max(2, lam * 0.01);
    const spec = computeGroupDelaySpectrum(coeffAt, lam - half, lam + half, 11);
    let bi = 0, bd = Infinity;
    for (let i = 0; i < spec.lambda.length; i++) { const d = Math.abs(spec.lambda[i] - lam); if (d < bd) { bd = d; bi = i; } }
    const gdOp = evaluateOperands([makeOperand({ type: 'GD', lambdaStart: lam, aoi, pol: 's' })], ctx)[0];
    ok(close(gdOp, spec.gd[bi], 1e-9), 'GD point matches nearest sample');
    ok(Number.isFinite(gdOp), 'GD point is finite');
    const gddOp = evaluateOperands([makeOperand({ type: 'GDD', lambdaStart: lam, aoi, pol: 's' })], ctx)[0];
    ok(close(gddOp, spec.gdd[bi], 1e-9), 'GDD point matches nearest sample');
}

// ── GDFLAT is the RMS deviation from the flat target ──────────────────────────
{
    const op = makeOperand({ type: 'GDFLAT', lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 's', target: 0 });
    const rms = evaluateOperands([op], ctx)[0];
    ok(Number.isFinite(rms) && rms >= 0, 'GDFLAT is a finite, non-negative RMS');
    // Perfectly-flat target equal to the mean GD gives a smaller residual than a
    // wildly-off target.
    const opBad = makeOperand({ type: 'GDFLAT', lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 's', target: 1e4 });
    ok(evaluateOperands([opBad], ctx)[0] > rms, 'GDFLAT residual grows as target leaves the actual GD band');
}

// ── EFMX = peak |E|² over the profile ─────────────────────────────────────────
{
    const lam = 550, aoi = 0;
    const { n0, ns, layers } = refStack(lam);
    const prof = computeEFieldProfile(lam, aoi, 's', n0, ns, layers);
    const peak = Math.max(...prof.e2);
    const op = evaluateOperands([makeOperand({ type: 'EFMX', lambdaStart: lam, aoi, pol: 's' })], ctx)[0];
    ok(close(op, peak, 1e-9), 'EFMX matches peak |E|²');
    ok(op > 0, 'EFMX peak is positive');
}

// ── Phase operands participate in the merit function without poisoning it ─────
{
    const ops = [
        makeOperand({ type: 'PSI', lambdaStart: 550, aoi: 60, target: 45, weight: 1 }),
        makeOperand({ type: 'GD',  lambdaStart: 550, aoi: 0, pol: 's', target: 0, weight: 1 }),
        makeOperand({ type: 'EFMX', lambdaStart: 550, aoi: 0, pol: 's', target: 0, weight: 1 }),
    ];
    const mf = calcMF(ops, evaluateOperands(ops, ctx));
    ok(Number.isFinite(mf) && mf >= 0, 'mixed phase-operand MF is finite');
}

// ── Optimizer drives a phase operand via the FD Jacobian fallback ─────────────
{
    const ops = [
        makeOperand({ type: 'EFMX', lambdaStart: 550, aoi: 0, pol: 's', target: 0, weight: 1 }),
    ];
    const opt = new DLSOptimizer(ops, JSON.parse(JSON.stringify(design)), resolveMat);
    const thk = opt.thicknesses;
    const freeIdx = thk.map((_, i) => i).filter(i => !opt.lockedMask[i]);
    ok(opt._analyticJacobian(thk, freeIdx) === null, 'phase operand declines the analytic Jacobian (FD fallback)');
    const mf0 = calcMF(ops, evaluateOperands(ops, opt._ctxFor(opt.thicknesses.slice())));
    for (let i = 0; i < 6; i++) opt.step();
    const mf1 = calcMF(ops, evaluateOperands(ops, opt._ctxFor(opt.thicknesses.slice())));
    ok(Number.isFinite(mf1), 'MF finite after FD-driven steps');
    ok(mf1 <= mf0 + 1e-9, `EFMX peak field did not increase (${mf0.toFixed(4)} → ${mf1.toFixed(4)})`);
    ok(opt.thicknesses.every(Number.isFinite), 'thicknesses stay finite');
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
