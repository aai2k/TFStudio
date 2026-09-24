/**
 * The analytic needle P-function scores only rows whose value is R, T or A.
 *
 * TANPSI and the TOD family (TOD, TODT, TODFLAT, TODTFLAT) share a leading T
 * with transmittance but are tanΨ and third-order dispersion. The analytic scan
 * has no chain rule for them, so a merit holding one must leave the scan to the
 * finite-difference path. The P-values the dispatcher returns are checked
 * against the FD scan on the same insertions: relative error, sign agreement
 * and the best insertion. Controls keep plain TAV rows and the s/p-suffixed
 * point types saved designs still carry on the analytic path.
 *
 * P-function: Sullivan & Dobrowolski, Appl. Opt. 35, 5484 (1996);
 * Tikhonravov et al., Appl. Opt. 35, 5493 (1996).
 *
 * Run: node tests/needle_p_tanpsi_tod.mjs
 */
import {
  makeOperand, scanNeedlesAnalytic, scanNeedlesFD, scanNeedlesPFunction,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);
const POOL = [
  { id: 'TiO2', name: 'TiO2', mat: getMaterial('TiO2') },
  { id: 'SiO2', name: 'SiO2', mat: getMaterial('SiO2') },
];
// Thicknesses in nm; 4 layers and 2 candidates give 26 insertions.
const design = {
  incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
  frontLayers: [
    { id: 'a', material: 'TiO2', thickness: 95,  locked: false },
    { id: 'b', material: 'SiO2', thickness: 160, locked: false },
    { id: 'c', material: 'TiO2', thickness: 70,  locked: false },
    { id: 'd', material: 'SiO2', thickness: 130, locked: false },
  ],
  backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
};

// FD step in nm. The FD slope carries an O(δ) truncation offset from the
// d→0 analytic value; at 0.01 nm that offset stays far below the tolerance.
const FD_DELTA_NM = 0.01;
// A candidate enters the relative-error and sign checks when its FD slope is at
// least this fraction of the largest one, so a near-zero slope cannot dominate.
const SIGNIFICANT = 1e-2;
const REL_TOL = 0.01;

const scanArgs = operands => ({
  operands, design, resolveMat, candidateMats: POOL, deltaNm: FD_DELTA_NM, side: 'front',
});

const bestOf = cands => cands.reduce((b, c) => (c.grad < b.grad ? c : b));
const label = c => `${c.materialId} at ${c.pos.toFixed(2)}`;

// Compare a scan result with the FD scan insertion by insertion.
function againstFD(result, fd) {
  const n = fd.candidates.length;
  if (result.candidates.length !== n) return { mismatch: true };
  let gmax = 0;
  for (const c of fd.candidates) gmax = Math.max(gmax, Math.abs(c.grad));
  let maxRel = 0, flips = 0;
  for (let i = 0; i < n; i++) {
    const p = result.candidates[i].grad, f = fd.candidates[i].grad;
    if (Math.abs(f) < SIGNIFICANT * gmax) continue;
    maxRel = Math.max(maxRel, Math.abs(p - f) / Math.abs(f));
    if (Math.sign(p) !== Math.sign(f)) flips++;
  }
  const best = bestOf(result.candidates), bestFd = bestOf(fd.candidates);
  const sameBest = best.materialId === bestFd.materialId && best.pos === bestFd.pos;
  return { n, maxRel, flips, best, bestFd, sameBest };
}

function report(name, cmp) {
  const ok = !cmp.mismatch && cmp.maxRel < REL_TOL && cmp.flips === 0 && cmp.sameBest;
  if (cmp.mismatch) {
    console.log(`[${name}] candidate count differs from the FD scan  FAIL`);
    return false;
  }
  console.log(`[${name}] max rel err ${(cmp.maxRel * 100).toFixed(2)}%  sign flips ${cmp.flips}/${cmp.n}  ` +
    `best ${label(cmp.best)} (FD ${label(cmp.bestFd)})  ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

// A merit holding a non-photometric row: the analytic scan must decline, and
// the dispatcher's P-values must agree with the FD scan.
function nonPhotometricCase(name, operands) {
  const analytic = scanNeedlesAnalytic(scanArgs(operands));
  const fd = scanNeedlesFD(scanArgs(operands));
  const dispatched = report(`${name}, dispatcher`, againstFD(scanNeedlesPFunction(scanArgs(operands)), fd));
  if (analytic) {
    console.log(`[${name}] analytic scan did not decline  FAIL`);
    report(`${name}, analytic`, againstFD(analytic, fd));
    return false;
  }
  console.log(`[${name}] analytic scan declines  PASS`);
  return dispatched;
}

// A photometric merit: the analytic scan must run and match the FD scan.
function photometricCase(name, operands) {
  const analytic = scanNeedlesAnalytic(scanArgs(operands));
  if (!analytic) {
    console.log(`[${name}] analytic scan declined a photometric merit  FAIL`);
    return false;
  }
  return report(`${name}, analytic`, againstFD(analytic, scanNeedlesFD(scanArgs(operands))));
}

const tav = (a, b, t) => makeOperand({ type: 'TAV', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: t, weight: 1 });
const point = (type, lam, aoi, target, pol = 'avg') =>
  makeOperand({ type, lambdaStart: lam, lambdaEnd: lam, aoi, pol, target, weight: 1 });
const band = (type, a, b, target) =>
  makeOperand({ type, lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target, weight: 1 });

let ok = true;

ok = photometricCase('TAV only', [tav(500, 560, 1), tav(600, 700, 0)]) && ok;
ok = photometricCase('s/p-suffixed point types', [
  point('TS', 530, 45, 1), point('RP', 650, 45, 1), point('AS', 600, 0, 0),
]) && ok;

ok = nonPhotometricCase('TAV + TANPSI at 600 nm, 60 deg', [tav(500, 560, 1), point('TANPSI', 600, 60, 1)]) && ok;
ok = nonPhotometricCase('TAV(500-560) + TODFLAT(600-700)', [tav(500, 560, 1), band('TODFLAT', 600, 700, 0)]) && ok;
ok = nonPhotometricCase('TAV + TOD at 650 nm', [tav(500, 560, 1), point('TOD', 650, 0, 0)]) && ok;
ok = nonPhotometricCase('TAV + TODT at 650 nm', [tav(500, 560, 1), point('TODT', 650, 0, 0)]) && ok;
ok = nonPhotometricCase('TAV(500-560) + TODTFLAT(600-700)', [tav(500, 560, 1), band('TODTFLAT', 600, 700, 0)]) && ok;

console.log(ok ? '\nPASS  the analytic scan reads only R, T and A rows' : '\nFAIL');
process.exit(ok ? 0 : 1);
