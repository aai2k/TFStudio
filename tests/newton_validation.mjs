/**
 * Validation of the merit-function Hessian + modified-Newton step.
 *
 * Two checks (CLAUDE.md: validate before trust):
 *  (1) ASSEMBLED HESSIAN vs FINITE DIFFERENCE — the analytic H = JᵀJ + S from
 *      DLSOptimizer._newtonSystem must equal ½·(FD Hessian of SSR), where
 *      SSR = Σ residualₚ². Tested for TAV (range-avg), single-λ, and TGT
 *      (range-target) merit functions — the three curvature branches.
 *  (2) CONVERGENCE — from a perturbed start, newtonStep() should reach a given
 *      MF in no more iterations than LM step() (quadratic vs linear endgame).
 *
 * Run: node tests/newton_validation.mjs
 */
import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
import { NewtonOptimizer } from '../src/utils/optimizers/newton.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);
const deep = x => JSON.parse(JSON.stringify(x));

function design() {
  return {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
      { id: 'L1', material: 'TiO2', thickness: 110, locked: false },
      { id: 'L2', material: 'SiO2', thickness: 90,  locked: false },
      { id: 'L3', material: 'TiO2', thickness: 65,  locked: false },
      { id: 'L4', material: 'SiO2', thickness: 140, locked: false },
    ],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
  };
}

const OPSETS = {
  'TAV (range-avg)': [
    makeOperand({ type: 'TAV', lambdaStart: 480, lambdaEnd: 520, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
    makeOperand({ type: 'RAV', lambdaStart: 600, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 2 }),
  ],
  'single-λ': [
    makeOperand({ type: 'T', lambdaStart: 510, aoi: 0, pol: 's', target: 1, weight: 1 }),
    makeOperand({ type: 'R', lambdaStart: 620, aoi: 0, pol: 'p', target: 0, weight: 1 }),
  ],
  'TGT (range-target)': [
    makeOperand({ type: 'TGT', lambdaStart: 470, lambdaEnd: 530, aoi: 0, pol: 'avg', target: 1, targetEnd: 1, weight: 1 }),
    makeOperand({ type: 'RGT', lambdaStart: 590, lambdaEnd: 660, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 }),
  ],
};

const ssrAt = (dls, thk) => {
  const r = dls._residuals(thk);
  let s = 0; for (const x of r) s += x * x;
  return s;
};

let allOk = true;

for (const [label, operands] of Object.entries(OPSETS)) {
  const dls = new DLSOptimizer(operands, design(), resolveMat, { dMin: 1 });
  const thk = dls.thicknesses;
  const freeIdx = thk.map((_, i) => i).filter(i => !dls.lockedMask[i]);
  const nFree = freeIdx.length;

  const sys = dls._newtonSystem(thk, freeIdx);
  if (!sys) { console.log(`[${label}] _newtonSystem returned null — UNSUPPORTED`); allOk = false; continue; }
  const { H } = sys;

  // FD Hessian of SSR via the symmetric 4-point stencil.
  const h = 1e-2;
  const bump = (i, di) => { const t = thk.slice(); t[freeIdx[i]] += di; return t; };
  const bump2 = (i, di, j, dj) => { const t = thk.slice(); t[freeIdx[i]] += di; t[freeIdx[j]] += dj; return t; };
  let maxAbs = 0, maxRel = 0, worst = null;
  for (let a = 0; a < nFree; a++) {
    for (let b = a; b < nFree; b++) {
      const fpp = ssrAt(dls, bump2(a, +h, b, +h));
      const fpm = ssrAt(dls, bump2(a, +h, b, -h));
      const fmp = ssrAt(dls, bump2(a, -h, b, +h));
      const fmm = ssrAt(dls, bump2(a, -h, b, -h));
      const fdHss = (fpp - fpm - fmp + fmm) / (4 * h * h);   // ∂²SSR/∂dₐ∂d_b
      const analytic = 2 * H[a][b];                          // H_SSR = 2(JᵀJ+S)
      const e = Math.abs(analytic - fdHss);
      const rel = e / (Math.abs(fdHss) + 1e-9);
      if (e > maxAbs) maxAbs = e;
      if (Math.abs(fdHss) > 1e-3 && rel > maxRel) { maxRel = rel; worst = { a, b, analytic, fdHss }; }
    }
  }
  void bump;
  const ok = maxRel < 5e-3;   // FD truncation O(h²) dominates; 0.5% is comfortable
  allOk = allOk && ok;
  console.log(`[${label}] Hessian vs FD: max|Δ|=${maxAbs.toExponential(2)}  maxRel(|val|>1e-3)=${(maxRel * 100).toFixed(3)}%  ${ok ? 'PASS ✅' : 'FAIL ❌'}`);
  if (worst) console.log(`    worst (a=${worst.a},b=${worst.b}) analytic=${worst.analytic.toExponential(4)} fd=${worst.fdHss.toExponential(4)}`);
}

// ── Convergence: LM vs Newton from a perturbed start ──────────────────────────
console.log('\n--- Convergence (iterations to MF < 1e-4 from a perturbed start) ---');
{
  const operands = OPSETS['TAV (range-avg)'];
  const base = design();
  // Perturb away from the (already-decent) start so both have work to do.
  const perturbed = { ...base, frontLayers: base.frontLayers.map((l, i) => ({ ...l, thickness: l.thickness * (1 + 0.15 * Math.sin(i + 1)) })) };

  const runner = (useNewton) => {
    // Newton step now lives on NewtonOptimizer (step() === the old newtonStep);
    // the LM step is DLSOptimizer.step().
    const dls = useNewton
      ? new NewtonOptimizer(operands, deep(perturbed), resolveMat, { dMin: 1 })
      : new DLSOptimizer(operands, deep(perturbed), resolveMat, { dMin: 1 });
    const TGT = 1e-4; let it = 0;
    const mf0 = dls.mf;
    for (; it < 200; it++) {
      if (dls.mf < TGT) break;
      dls.step();
      if (dls.lamD >= 1e8 || dls.lamN >= 1e8) { it++; break; }
    }
    return { mf0, mf: dls.mf, iters: it };
  };
  const lm = runner(false);
  const nw = runner(true);
  console.log(`start MF = ${lm.mf0.toFixed(6)}`);
  console.log(`LM     : ${lm.iters} iters → MF ${lm.mf.toExponential(3)}`);
  console.log(`Newton : ${nw.iters} iters → MF ${nw.mf.toExponential(3)}`);
  const newtonGood = nw.mf <= lm.mf * 1.05 + 1e-9 && nw.iters <= lm.iters;
  console.log(newtonGood ? 'Newton ≤ LM iterations at equal-or-better MF ✅' : 'Newton did not beat LM (informational)');
}

console.log(allOk ? '\nPASS ✅  merit-Hessian matches finite differences' : '\nFAIL ❌  Hessian mismatch');
process.exit(allOk ? 0 : 1);
