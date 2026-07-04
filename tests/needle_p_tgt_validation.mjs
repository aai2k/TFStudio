/**
 * FD validation of the analytic needle P-function for TGT/RGT/AGT.
 *
 * scanNeedlesAnalytic now handles range-target operands (was: bailed to FD).
 * The analytic P-function is the d→0 limit of the FD needle scan, so the two
 * must agree on every candidate's dMF/grad. This compares them on a small
 * design with TGT operands (passband + stopband) — and, as a regression guard,
 * confirms a TAV-only case is unchanged (the refactor must keep band-average
 * numerics bit-identical).
 *
 * Run: node tests/needle_p_tgt_validation.mjs
 */
import {
  makeOperand, scanNeedlesAnalytic, scanNeedlesFD,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);
const POOL = [
  { id: 'TiO2', name: 'TiO2', mat: getMaterial('TiO2') },
  { id: 'SiO2', name: 'SiO2', mat: getMaterial('SiO2') },
];
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

// The analytic P-function is the d→0 limit of the FD slope; FD at finite δ has
// O(δ) truncation. So we verify analytic == FD as δ→0: compute the FD grad at
// two shrinking δ and check it CONVERGES toward the analytic value (error
// roughly halves as δ halves). A TGT bug would show as non-convergence /
// divergent error, distinct from the benign O(δ) offset.
function gradMaxRel(operands, deltaNm) {
  const A = scanNeedlesAnalytic({ operands, design, resolveMat, candidateMats: POOL, deltaNm, side: 'front' });
  const F = scanNeedlesFD({ operands, design, resolveMat, candidateMats: POOL, deltaNm, side: 'front' });
  if (!A) return { nullA: true };
  const n = Math.min(A.candidates.length, F.candidates.length);
  let maxRel = 0, worst = null;
  for (let i = 0; i < n; i++) {
    const ag = A.candidates[i].grad, fg = F.candidates[i].grad;
    if (Math.abs(fg) > 1e-4) {
      const rel = Math.abs(ag - fg) / Math.abs(fg);
      if (rel > maxRel) { maxRel = rel; worst = { i, ag, fg, pos: A.candidates[i].pos, mat: A.candidates[i].materialId }; }
    }
  }
  return { maxRel, worst, mf0d: Math.abs(A.mf0 - F.mf0) };
}

function compare(label, operands) {
  const big   = gradMaxRel(operands, 0.20);
  const small = gradMaxRel(operands, 0.02);
  if (big.nullA || small.nullA) { console.log(`[${label}] analytic returned null (FD fallback) — FAIL`); return false; }
  // Pass if FD→analytic CONVERGES (small-δ error well under big-δ error) and the
  // small-δ error is tight (<1%). mf0 must match exactly (shared calcMF).
  const converges = small.maxRel < big.maxRel * 0.7 + 1e-9;
  const tight     = small.maxRel < 0.01;
  const mf0ok     = small.mf0d < 1e-9;
  const ok = mf0ok && tight && converges;
  console.log(`[${label}] mf0Δ=${small.mf0d.toExponential(1)}  gradMaxRel: δ=0.20→${(big.maxRel*100).toFixed(2)}%  δ=0.02→${(small.maxRel*100).toFixed(3)}%  ${converges?'(converging)':'(NOT converging!)'}  ${ok ? 'PASS ✅' : 'FAIL ❌'}`);
  if (small.worst) console.log(`    worst@δ0.02 i=${small.worst.i} (${small.worst.mat}@${typeof small.worst.pos==='number'?small.worst.pos.toFixed(2):small.worst.pos}) analytic=${small.worst.ag.toExponential(3)} fd=${small.worst.fg.toExponential(3)}`);
  return ok;
}

const tgt = (a, b, t) => makeOperand({ type: 'TGT', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: t, targetEnd: t, weight: 1 });
const tav = (a, b, t) => makeOperand({ type: 'TAV', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: t, weight: 1 });

let ok = true;
ok = compare('TGT passband+stopband', [tgt(500, 560, 1), tgt(600, 700, 0)]) && ok;
ok = compare('TGT weighted', [{ ...tgt(500, 560, 1), weight: 4 }, tgt(600, 700, 0)]) && ok;
ok = compare('TAV regression (must still match)', [tav(500, 560, 1), tav(600, 700, 0)]) && ok;
ok = compare('mixed TAV+TGT', [tav(500, 560, 1), tgt(600, 700, 0)]) && ok;

console.log(ok ? '\nPASS ✅  analytic TGT P-function matches FD' : '\nFAIL ❌');
process.exit(ok ? 0 : 1);
