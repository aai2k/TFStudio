/**
 * FD validation of the analytic thickness-Hessian kernel.
 *
 * MANDATORY gate (CLAUDE.md): every numerical method is validated before trust.
 * Here we check the EXACT analytic ∂²{R,T}/∂dᵢ∂dⱼ from tmmThicknessHessian
 * against a central finite difference of the EXACT analytic first derivative
 * (tmmThicknessJacobian) — i.e. d²R/∂dᵢ∂dⱼ ≈ [dRdd_j(d+h·eᵢ) − dRdd_j(d−h·eᵢ)]/2h.
 * Differencing the analytic 1st derivative isolates the new 2nd-derivative
 * machinery (layer d²M, middle product, 2nd-order chain) from 1st-order code.
 *
 * Covers normal + oblique incidence, s and p, and an absorbing layer (k>0).
 *
 * Run: node tests/hessian_fd_validation.mjs
 */
import { tmmThicknessJacobian, tmmThicknessHessian } from '../src/utils/physics/thinFilmMath.js';

const n0 = [1.0, 0];          // air
const ns = [1.52, 0];         // glass substrate
// A deliberately mixed stack: high/low dielectric + one absorbing layer.
const baseLayers = [
  { n: [2.35, 0.0],   d: 95  },   // TiO2-like
  { n: [1.46, 0.0],   d: 180 },   // SiO2-like
  { n: [2.35, 0.0],   d: 60  },   // TiO2-like
  { n: [1.50, 0.02],  d: 40  },   // weakly absorbing
  { n: [1.46, 0.0],   d: 220 },   // SiO2-like
];

const cases = [
  { lam: 550, theta: 0,  pol: 's' },
  { lam: 550, theta: 0,  pol: 'p' },
  { lam: 633, theta: 30, pol: 's' },
  { lam: 633, theta: 45, pol: 'p' },
  { lam: 450, theta: 60, pol: 's' },
];

const H = 1e-3;   // FD step in nm
const withD = (layers, i, dd) => layers.map((l, k) => k === i ? { ...l, d: l.d + dd } : l);

let maxRelR = 0, maxRelT = 0, maxAbsR = 0, maxAbsT = 0, worst = null;
let firstDerivMaxAbs = 0;

for (const c of cases) {
  const N = baseLayers.length;
  const hess = tmmThicknessHessian(c.lam, c.theta, c.pol, n0, ns, baseLayers);
  const jac0 = tmmThicknessJacobian(c.lam, c.theta, c.pol, n0, ns, baseLayers);

  // Sanity: Hessian's own first derivatives must equal the Jacobian's.
  for (let k = 0; k < N; k++) {
    firstDerivMaxAbs = Math.max(firstDerivMaxAbs,
      Math.abs(hess.dRdd[k] - jac0.dRdd[k]),
      Math.abs(hess.dTdd[k] - jac0.dTdd[k]));
  }

  for (let i = 0; i < N; i++) {
    const jp = tmmThicknessJacobian(c.lam, c.theta, c.pol, n0, ns, withD(baseLayers, i, +H));
    const jm = tmmThicknessJacobian(c.lam, c.theta, c.pol, n0, ns, withD(baseLayers, i, -H));
    for (let j = 0; j < N; j++) {
      const fdR = (jp.dRdd[j] - jm.dRdd[j]) / (2 * H);
      const fdT = (jp.dTdd[j] - jm.dTdd[j]) / (2 * H);
      const aR = hess.d2Rdd[i][j], aT = hess.d2Tdd[i][j];
      const eR = Math.abs(aR - fdR), eT = Math.abs(aT - fdT);
      const rR = eR / (Math.abs(fdR) + 1e-9), rT = eT / (Math.abs(fdT) + 1e-9);
      maxAbsR = Math.max(maxAbsR, eR); maxAbsT = Math.max(maxAbsT, eT);
      if (rR > maxRelR) { maxRelR = rR; }
      if (rT > maxRelT) { maxRelT = rT; }
      // Track the worst absolute offender (relative blows up where the true
      // value is ~0; absolute error is the meaningful gate there).
      if (eR + eT > (worst?.e ?? 0)) worst = { ...c, i, j, aR, fdR, aT, fdT, e: eR + eT };
    }
  }
}

console.log('=== Analytic thickness-Hessian vs FD-of-analytic-Jacobian ===');
console.log(`first-derivative agreement (Hessian vs Jacobian) max|Δ| = ${firstDerivMaxAbs.toExponential(3)}`);
console.log(`∂²R  max|Δ| = ${maxAbsR.toExponential(3)}   max rel (where |val|≫0) = ${maxRelR.toExponential(3)}`);
console.log(`∂²T  max|Δ| = ${maxAbsT.toExponential(3)}   max rel (where |val|≫0) = ${maxRelT.toExponential(3)}`);
if (worst) {
  console.log(`worst entry: λ=${worst.lam} θ=${worst.theta} ${worst.pol} (i=${worst.i},j=${worst.j})`);
  console.log(`   ∂²R analytic=${worst.aR.toExponential(4)} fd=${worst.fdR.toExponential(4)}`);
  console.log(`   ∂²T analytic=${worst.aT.toExponential(4)} fd=${worst.fdT.toExponential(4)}`);
}

// FD truncation error is O(H²)≈1e-6 here; gate on absolute error.
const TOL_ABS = 1e-5;
const ok = firstDerivMaxAbs < 1e-12 && maxAbsR < TOL_ABS && maxAbsT < TOL_ABS;
console.log(ok ? '\nPASS ✅  analytic Hessian matches finite differences' : '\nFAIL ❌  mismatch exceeds tolerance');
process.exit(ok ? 0 : 1);
