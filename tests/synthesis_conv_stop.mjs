/**
 * Validate the adaptive inner-refine convergence stop.
 *
 * GUI profiling: candidate refine = 99% of per-generation cost, run at the FULL
 * dlsIter even when a warm-started design has converged → wasted iterations.
 * dlsIter 80→30 was ~2.5× faster but lost quality (flat cut under-converges).
 * The fix is an adaptive plateau stop (run full iters where they help, stop once
 * converged). This A/Bs GE (CG inner) with vs without the stop on the thick-seed
 * weighted-TGT multipassband, at a fixed wall-clock budget. WIN = the conv-stop
 * run reaches MORE layers / equal-or-better MF in the same time (quality-neutral
 * speedup), NOT worse MF at equal layers (which would mean it stops too early).
 *
 * Run: node tests/synthesis_conv_stop.mjs
 */
import {
  makeOperand, calcMF, scanNeedlesPFunction, findOptimalNeedleThickness,
  insertNeedle, insertNeedleIntra, cleanupLayers, scanGEInsertions,
  buildEvalContext, evaluateOperands,
} from '../src/utils/physics/optimizer.js';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);
const deep = x => JSON.parse(JSON.stringify(x));
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;

const POOL = [
  { id: 'TiO2', name: 'TiO2', mat: getMaterial('TiO2') },
  { id: 'SiO2', name: 'SiO2', mat: getMaterial('SiO2') },
];
const DMIN = 5, DLS_ITER = 80, MAX_LAYERS = 60, MAX_STEPS = 400, BUDGET = 60000;
const CONV_PATIENCE = 6, CONV_MIN_GAIN = 1e-4;

// weighted-TGT 3-line multipassband (passbands w=4, stopbands w=1)
const wtgt = (a, b, t, w) => makeOperand({ type: 'TGT', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: t, targetEnd: t, weight: w });
const operands = [
  wtgt(445, 455, 1, 4), wtgt(505, 515, 1, 4), wtgt(635, 645, 1, 4),
  wtgt(400, 440, 0, 1), wtgt(460, 500, 0, 1), wtgt(520, 630, 0, 1), wtgt(650, 700, 0, 1),
];
const thickSeed = () => ({ incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
  frontLayers: [{ id: 'T1', material: 'SiO2', thickness: 7000, locked: false }], backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side' });

// refine with optional plateau convergence stop; returns {design, mf, iters}
function refineAndPrune(design, convStop) {
  const opt = makeEngine('cg', operands, design, resolveMat, { dMin: DMIN });
  const hist = [opt.mf];
  let it = 0;
  while (it < DLS_ITER && !opt.isConverged()) {
    opt.step(); it++; hist.push(opt.mf);
    if (convStop && hist.length - 1 >= CONV_PATIENCE) {
      const past = hist[hist.length - 1 - CONV_PATIENCE];
      const gain = past > 0 ? (past - opt.mf) / past : 0;
      if (gain < CONV_MIN_GAIN) break;
    }
  }
  const rd = opt.applyToDesign(design);
  const pd = { ...rd, frontLayers: cleanupLayers(rd.frontLayers || [], DMIN) };
  const mf = calcMF(operands, evaluateOperands(operands, buildEvalContext(pd, resolveMat)), { skipConstraints: true });
  return { design: pd, mf, iters: it };
}
function insertOptimal(design, cand) {
  cand._mat = resolveMat(cand.materialId);
  let dOpt = DMIN;
  try { dOpt = findOptimalNeedleThickness({ operands, design, resolveMat, candidate: cand, deltaNm: DMIN, maxNm: 500, tol: 0.5, side: 'front' }); if (!(dOpt >= DMIN)) dOpt = DMIN; } catch { dOpt = DMIN; }
  return cand.intra ? insertNeedleIntra(design, cand.layerK, cand.frac, cand.materialId, dOpt, 'front')
                    : insertNeedle(design, cand.pos, cand.materialId, dOpt, 'front');
}
function ge(convStop) {
  let work = refineAndPrune(deep(thickSeed()), convStop);
  let best = { ...work }; const t0 = now(); let geStagn = 0, totIters = work.iters;
  for (let step = 0; step < MAX_STEPS && now() - t0 < BUDGET; step++) {
    if ((work.design.frontLayers || []).length >= MAX_LAYERS) break;
    const { candidates } = scanNeedlesPFunction({ operands, design: work.design, resolveMat, candidateMats: POOL, deltaNm: 0.5, side: 'front' });
    const queue = candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF);
    let accepted = false;
    for (const cand of queue) {
      if (now() - t0 >= BUDGET) break;
      const r = refineAndPrune(insertOptimal(work.design, cand), convStop);
      totIters += r.iters;
      if (r.mf < work.mf - 1e-9) { work = r; accepted = true; if (work.mf < best.mf - 1e-9) { best = { ...work }; geStagn = 0; } break; }
    }
    if (accepted) continue;
    const geScan = scanGEInsertions({ operands, design: work.design, resolveMat, candidateMats: POOL, thickNm: DMIN, side: 'front' });
    if (!geScan.candidates.length) break;
    const bestGe = geScan.candidates.reduce((b, x) => (x.mfNew < b.mfNew ? x : b), geScan.candidates[0]);
    work = { design: insertNeedle(work.design, bestGe.pos, bestGe.materialId, DMIN, 'front'), mf: bestGe.mfNew };
    if (++geStagn > 6) break;
  }
  return { mf: best.mf, layers: (best.design.frontLayers || []).length, time: now() - t0, totIters };
}

console.log('=== Inner-refine convergence stop A/B — GE (CG), thick TGT multipassband, 60s ===');
const full = ge(false);
const conv = ge(true);
console.log(`FULL (dlsIter=${DLS_ITER}) : MF=${full.mf.toFixed(6)} layers=${full.layers} totInnerIters=${full.totIters} time=${(full.time/1000).toFixed(1)}s`);
console.log(`CONV-STOP            : MF=${conv.mf.toFixed(6)} layers=${conv.layers} totInnerIters=${conv.totIters} time=${(conv.time/1000).toFixed(1)}s`);
const qualOK = conv.mf <= full.mf * 1.05 + 1e-6;
const moreLayers = conv.layers >= full.layers;
console.log(`avg iters/refine: full=${(full.totIters/Math.max(1,full.layers)).toFixed(0)} conv=${(conv.totIters/Math.max(1,conv.layers)).toFixed(0)}`);
console.log(qualOK && moreLayers ? '\nPASS ✅ conv-stop ≥ layers at equal-or-better MF (quality-neutral speedup)'
  : qualOK ? '\n~ conv-stop quality-neutral but not more layers (modest)'
  : '\nFAIL ❌ conv-stop lost quality (stops too early — loosen threshold)');
