/**
 * Back-only full-Newton Hessian validation.
 *
 * back_only is the SAME single-surface problem as front_only (light enters the
 * exit medium → reversed back stack → substrate), so the full analytic Newton
 * Hessian applies. _newtonSystem now assembles it for back_only (getH mirrors
 * _analyticJacobian's isSingleBack reversal + index remap), instead of dropping
 * to Gauss-Newton.
 *
 * This pins the assembled back_only Hessian H = JᵀJ + S against a finite-
 * difference Hessian of the SSR (H_SSR = 2·H). If the full path were NOT taken
 * (GN fallback), the missing curvature term S would make this FAIL where the
 * residuals are non-zero — so the test also proves the full path is active.
 *
 * Run: node tests/newton_hessian_back_only.mjs
 */
import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
import { NewtonOptimizer } from '../src/utils/optimizers/newton.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = (id) => getMaterial(id);
const deep = (x) => JSON.parse(JSON.stringify(x));
let allOk = true;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); allOk = false; } };

function backDesign() {
    return {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: [{ id: 'F1', material: 'TiO2', thickness: 100, locked: false }], // fixed front
        backLayers: [
            { id: 'B1', material: 'TiO2', thickness: 110, locked: false },
            { id: 'B2', material: 'SiO2', thickness: 90,  locked: false },
            { id: 'B3', material: 'TiO2', thickness: 65,  locked: false },
        ],
        surfaceMode: 'back_only', mfEvalMode: 'side',
    };
}
// Non-trivial residuals so the second-order curvature term S is exercised.
const OPSETS = {
    'TAV+RAV': [
        makeOperand({ type: 'TAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
        makeOperand({ type: 'RAV', lambdaStart: 600, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 2 }),
    ],
    'single-λ': [
        makeOperand({ type: 'T', lambdaStart: 510, aoi: 0, pol: 's', target: 1, weight: 1 }),
        makeOperand({ type: 'R', lambdaStart: 620, aoi: 0, pol: 'p', target: 0, weight: 1 }),
    ],
};
const ssrAt = (dls, thk) => { const r = dls._residuals(thk); let s = 0; for (const x of r) s += x * x; return s; };

for (const [label, operands] of Object.entries(OPSETS)) {
    const dls = new DLSOptimizer(operands, backDesign(), resolveMat, { dMin: 1 });
    const thk = dls.thicknesses;
    const freeIdx = thk.map((_, i) => i).filter((i) => !dls.lockedMask[i]);
    const nFree = freeIdx.length;
    ok(nFree === 3, `${label}: back stack has 3 free vars (got ${nFree})`);

    const sys = dls._newtonSystem(thk, freeIdx);
    ok(sys && sys.H && sys.Jtr, `${label}: _newtonSystem returned a system`);
    const H = sys.H;

    const h = 1e-2;
    const bump2 = (a, da, b, db) => { const t = thk.slice(); t[freeIdx[a]] += da; t[freeIdx[b]] += db; return t; };
    let maxAbs = 0, maxRel = 0, worst = null;
    for (let a = 0; a < nFree; a++) {
        for (let b = a; b < nFree; b++) {
            const fpp = ssrAt(dls, bump2(a, +h, b, +h));
            const fpm = ssrAt(dls, bump2(a, +h, b, -h));
            const fmp = ssrAt(dls, bump2(a, -h, b, +h));
            const fmm = ssrAt(dls, bump2(a, -h, b, -h));
            const fdHss = (fpp - fpm - fmp + fmm) / (4 * h * h);
            const analytic = 2 * H[a][b];   // H_SSR = 2(JᵀJ + S)
            const e = Math.abs(analytic - fdHss);
            const rel = e / (Math.abs(fdHss) + 1e-9);
            if (e > maxAbs) maxAbs = e;
            if (Math.abs(fdHss) > 1e-3 && rel > maxRel) { maxRel = rel; worst = { a, b, analytic, fdHss }; }
        }
    }
    const good = maxRel < 5e-3;
    allOk = allOk && good;
    console.log(`[${label}] back_only Hessian vs FD: max|Δ|=${maxAbs.toExponential(2)}  maxRel=${(maxRel * 100).toFixed(3)}%  ${good ? 'PASS ✅' : 'FAIL ❌'}`);
    if (worst && !good) console.log(`    worst (a=${worst.a},b=${worst.b}) analytic=${worst.analytic.toExponential(4)} fd=${worst.fdHss.toExponential(4)}`);
}

// Convergence: Newton (full Hessian) in back_only should match-or-beat LM iters.
{
    const operands = OPSETS['TAV+RAV'];
    const base = backDesign();
    const perturbed = { ...base, backLayers: base.backLayers.map((l, i) => ({ ...l, thickness: l.thickness * (1 + 0.15 * Math.sin(i + 1)) })) };
    const run = (useNewton) => {
        // Newton step now lives on NewtonOptimizer (step() === old newtonStep).
        const dls = useNewton
            ? new NewtonOptimizer(operands, deep(perturbed), resolveMat, { dMin: 1 })
            : new DLSOptimizer(operands, deep(perturbed), resolveMat, { dMin: 1 });
        let it = 0; const mf0 = dls.mf;
        for (; it < 200 && dls.mf > 1e-4; it++) { dls.step(); if (dls.lamD >= 1e8 || dls.lamN >= 1e8) { it++; break; } }
        return { mf0, mf: dls.mf, iters: it };
    };
    const lm = run(false), nw = run(true);
    console.log(`\nback_only convergence: start MF=${lm.mf0.toFixed(6)} | LM ${lm.iters} iters → ${lm.mf.toExponential(3)} | Newton ${nw.iters} iters → ${nw.mf.toExponential(3)}`);
    ok(nw.mf <= lm.mf * 1.10 + 1e-9, `back_only Newton reaches comparable MF (${nw.mf.toExponential(3)} vs LM ${lm.mf.toExponential(3)})`);
}

console.log(allOk ? '\nPASS ✅  back_only full-Newton Hessian matches finite differences' : '\nFAIL ❌');
process.exit(allOk ? 0 : 1);
