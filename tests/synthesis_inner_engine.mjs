/**
 * Synthesis inner-loop engine: DLS vs CG across DIVERSE problems (task #5).
 *
 * Before swapping the validated needle/GE inner refiner DLS→CG we confirm the
 * win is broad, not specific to one TAV multipassband. Runs Gradual Evolution
 * (the general synthesis-from-scratch tool — grows thin seeds via forced-TOT,
 * carves thick seeds) with a DLS vs CG inner loop on several problem classes,
 * using the CORRECT per-λ target operands (TGT/RGT) where applicable, not just
 * TAV band-averages. Compares final MF / layers at equal wall-clock.
 *
 * (Plateau early-stop was shown to HURT in the prior run — dropped here; ES, if
 * pursued, must be the reference-based cross-candidate form, deep-search only.)
 *
 * Run: node tests/synthesis_inner_engine.mjs
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
const DMIN = 5, DLS_ITER = 40, MAX_LAYERS = 60, MAX_STEPS = 200, BUDGET = 60000;

const baseDesign = (frontLayers) => ({
  incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
  frontLayers, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});
const thickSeed = () => baseDesign([{ id: 'T1', material: 'SiO2', thickness: 7000, locked: false }]);
const thinSeed  = () => baseDesign([
  { id: 'S1', material: 'TiO2', thickness: 30, locked: false },
  { id: 'S2', material: 'SiO2', thickness: 50, locked: false },
]);
const tgt = (type, a, b, t) => makeOperand({ type, lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: t, targetEnd: t, weight: 1 });

// Diverse synthesis problems, per-λ targets (TGT/RGT).
const PROBLEMS = [
  { name: 'Multipassband 3-line TGT', seed: thickSeed, ops: [
    tgt('TGT', 445, 455, 1), tgt('TGT', 505, 515, 1), tgt('TGT', 635, 645, 1),
    tgt('TGT', 400, 440, 0), tgt('TGT', 460, 500, 0), tgt('TGT', 520, 630, 0), tgt('TGT', 650, 700, 0),
  ] },
  { name: 'BBAR 450-650 (T→1)', seed: thinSeed, ops: [ tgt('TGT', 450, 650, 1) ] },
  { name: 'Beamsplitter R=0.5', seed: thinSeed, ops: [ tgt('RGT', 500, 600, 0.5) ] },
  { name: 'Shortpass edge 575nm', seed: thinSeed, ops: [ tgt('TGT', 400, 550, 1), tgt('TGT', 600, 700, 0) ] },
];

let operands = [];   // set per problem; the helpers below read this global

function refineAndPrune(design, engine) {
  const opt = makeEngine(engine, operands, design, resolveMat, { dMin: DMIN });
  let it = 0; while (it < DLS_ITER && !opt.isConverged()) { opt.step(); it++; }
  const rd = opt.applyToDesign(design);
  const pd = { ...rd, frontLayers: cleanupLayers(rd.frontLayers || [], DMIN) };
  const mf = calcMF(operands, evaluateOperands(operands, buildEvalContext(pd, resolveMat)), { skipConstraints: true });
  return { design: pd, mf };
}
function insertOptimal(design, cand) {
  cand._mat = resolveMat(cand.materialId);
  let dOpt = DMIN;
  try { dOpt = findOptimalNeedleThickness({ operands, design, resolveMat, candidate: cand, deltaNm: DMIN, maxNm: 500, tol: 0.5, side: 'front' }); if (!(dOpt >= DMIN)) dOpt = DMIN; } catch { dOpt = DMIN; }
  return cand.intra
    ? insertNeedleIntra(design, cand, dOpt, 'front')
    : insertNeedle(design, cand.pos, cand.materialId, dOpt, 'front');
}
function ge(start, engine) {
  let work = refineAndPrune(deep(start), engine);
  let best = { ...work }; const t0 = now(); let geStagn = 0;
  for (let step = 0; step < MAX_STEPS && now() - t0 < BUDGET; step++) {
    if ((work.design.frontLayers || []).length >= MAX_LAYERS) break;
    const { candidates } = scanNeedlesPFunction({ operands, design: work.design, resolveMat, candidateMats: POOL, deltaNm: 0.5, side: 'front' });
    const queue = candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF);
    let accepted = false;
    for (const cand of queue) {
      if (now() - t0 >= BUDGET) break;
      const r = refineAndPrune(insertOptimal(work.design, cand), engine);
      if (r.mf < work.mf - 1e-9) { work = r; accepted = true; if (work.mf < best.mf - 1e-9) { best = { ...work }; geStagn = 0; } break; }
    }
    if (accepted) continue;
    const geScan = scanGEInsertions({ operands, design: work.design, resolveMat, candidateMats: POOL, thickNm: DMIN, side: 'front' });
    if (!geScan.candidates.length) break;
    const bestGe = geScan.candidates.reduce((b, x) => (x.mfNew < b.mfNew ? x : b), geScan.candidates[0]);
    work = { design: insertNeedle(work.design, bestGe.pos, bestGe.materialId, DMIN, 'front'), mf: bestGe.mfNew };
    if (++geStagn > 6) break;
  }
  return { ...best, layers: (best.design.frontLayers || []).length, time: now() - t0 };
}

console.log(`=== Synthesis inner-loop DLS vs CG, Gradual Evolution, ${BUDGET / 1000}s budget/run (lower MF better) ===`);
for (const prob of PROBLEMS) {
  operands = prob.ops;
  const rDls = ge(prob.seed(), 'dls');
  const rCg  = ge(prob.seed(), 'cg');
  const win = rCg.mf < rDls.mf * 0.98 ? 'CG' : rDls.mf < rCg.mf * 0.98 ? 'DLS' : 'tie';
  console.log(`\n${prob.name}`);
  console.log(`  DLS  MF=${rDls.mf.toFixed(6)} layers=${String(rDls.layers).padStart(3)} time=${(rDls.time/1000).toFixed(1)}s`);
  console.log(`  CG   MF=${rCg.mf.toFixed(6)} layers=${String(rCg.layers).padStart(3)} time=${(rCg.time/1000).toFixed(1)}s   → ${win}`);
}
