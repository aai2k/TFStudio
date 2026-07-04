/**
 * 4-band OTF-demo target: is the ~0.106 GE stall a property of the greedy-needle
 * PATH (escapable by another method) or of the PROBLEM itself?
 *
 * GUI finding: GE from a thick TiO2 seed reaches needle-optimal
 * at ~35 layers MF~0.106 and STALLS — forced-TOT only oscillates ~0.106, never
 * breaks toward OTF's clean 96-layer solution. This A/Bs:
 *   (A) baseline greedy GE from the thick seed (reproduce the stall),
 *   (B) fixed-N multistart (Approach B): K structured N-layer starts, CG-refine
 *       each to convergence, keep best — at N=40 and N=60.
 * WIN for B = final MF << 0.106 (the trap is the greedy path → build Approach B).
 * If B also stalls ~0.106 = the target is genuinely that hard at this N/pool.
 *
 * Run: node tests/synthesis_4band_escape.mjs
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
const DMIN = 5;

// 4-line OTF-demo target, EQUAL weights (matches the project file)
const tgt = (a, b, t) => makeOperand({ type: 'TGT', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: t, targetEnd: t, weight: 1 });
const operands = [
  tgt(437, 467, 1), tgt(512, 543, 1), tgt(593, 648, 1), tgt(700, 763, 1),   // passbands
  tgt(400, 430, 0), tgt(473, 507, 0), tgt(550, 587, 0),                       // stopbands
  tgt(655, 693, 0), tgt(770, 812, 0),
];

const media = { incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 }, surfaceMode: 'front_only', mfEvalMode: 'side' };
const mkDesign = layers => ({ ...deep(media), frontLayers: layers, backLayers: [] });
const mfOf = d => calcMF(operands, evaluateOperands(operands, buildEvalContext(d, resolveMat)), { skipConstraints: true });

// CG refine to convergence (or maxIter), prune, return {design, mf, iters}
function refine(design, maxIter = 400) {
  const opt = makeEngine('cg', operands, design, resolveMat, { dMin: DMIN });
  let it = 0;
  while (it < maxIter && !opt.isConverged()) { opt.step(); it++; }
  const rd = opt.applyToDesign(design);
  const pd = { ...rd, frontLayers: cleanupLayers(rd.frontLayers || [], DMIN) };
  return { design: pd, mf: mfOf(pd), iters: it };
}

// ─────────────────────────────────────────────────────────────────────────────
// (A) Baseline greedy GE from a thick TiO2 seed (reproduce the ~0.106 stall)
function insertOptimal(design, cand) {
  cand._mat = resolveMat(cand.materialId);
  let dOpt = DMIN;
  try { dOpt = findOptimalNeedleThickness({ operands, design, resolveMat, candidate: cand, deltaNm: DMIN, maxNm: 500, tol: 0.5, side: 'front' }); if (!(dOpt >= DMIN)) dOpt = DMIN; } catch { dOpt = DMIN; }
  return cand.intra ? insertNeedleIntra(design, cand.layerK, cand.frac, cand.materialId, dOpt, 'front')
                    : insertNeedle(design, cand.pos, cand.materialId, dOpt, 'front');
}
function greedyGE({ maxLayers = 60, budgetS = 90, stagnStop = 6 }) {
  const seed = mkDesign([{ id: 'T1', material: 'TiO2', thickness: 7000, locked: false }]);
  let work = refine(seed);
  let best = { ...work }; const t0 = now(); let geStagn = 0;
  while (now() - t0 < budgetS) {
    if ((work.design.frontLayers || []).length >= maxLayers) break;
    const { candidates } = scanNeedlesPFunction({ operands, design: work.design, resolveMat, candidateMats: POOL, deltaNm: 0.5, side: 'front' });
    const queue = candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF);
    let accepted = false;
    for (const cand of queue) {
      if (now() - t0 >= budgetS) break;
      const r = refine(insertOptimal(work.design, cand));
      if (r.mf < work.mf - 1e-9) { work = r; accepted = true; if (work.mf < best.mf - 1e-9) { best = { ...work }; geStagn = 0; } break; }
    }
    if (accepted) continue;
    // forced-TOT GE step (canonical: thin layer at boundary, least-bad)
    const ge = scanGEInsertions({ operands, design: work.design, resolveMat, candidateMats: POOL, thickNm: DMIN, side: 'front' });
    if (!ge.candidates.length) break;
    const bge = ge.candidates.reduce((b, x) => (x.mfNew < b.mfNew ? x : b), ge.candidates[0]);
    const forced = refine(insertNeedle(work.design, bge.pos, bge.materialId, DMIN, 'front'));
    work = forced;
    if (++geStagn > stagnStop) break;
  }
  return { mf: best.mf, layers: (best.design.frontLayers || []).length, time: now() - t0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// (B) Fixed-N multistart (Approach B): structured N-layer starts, refine, keep best
const N_H = 2.4, N_L = 1.46;   // nominal indices for QWOT starts (refine corrects)
// simple deterministic-ish PRNG varied per start index (Math.random fine in node)
function buildStart(N, scheme, lam0) {
  const layers = [];
  for (let i = 0; i < N; i++) {
    const isH = i % 2 === 0;
    const material = isH ? 'TiO2' : 'SiO2';
    let thickness;
    if (scheme === 'qwot')  thickness = lam0 / (4 * (isH ? N_H : N_L));
    else if (scheme === 'equal') thickness = 7000 / N;
    else /* random */       thickness = 40 + Math.random() * 220;
    layers.push({ id: 'L' + i, material, thickness, locked: false });
  }
  return mkDesign(layers);
}
function multistart(N, K = 8) {
  const starts = [];
  starts.push({ tag: 'equal', d: buildStart(N, 'equal') });
  for (const l0 of [450, 560, 670, 760]) starts.push({ tag: 'qwot' + l0, d: buildStart(N, 'qwot', l0) });
  while (starts.length < K) starts.push({ tag: 'rand' + starts.length, d: buildStart(N, 'random') });
  let best = null;
  const t0 = now();
  for (const s of starts) {
    const r = refine(s.d, 500);
    if (!best || r.mf < best.mf) best = { ...r, tag: s.tag };
  }
  return { mf: best.mf, layers: (best.design.frontLayers || []).length, tag: best.tag, time: now() - t0 };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('=== 4-band OTF-demo target: greedy-GE stall vs fixed-N multistart ===\n');
console.log('(A) Baseline greedy GE from thick TiO2 seed (reproduce the stall)…');
const a = greedyGE({ maxLayers: 60, budgetS: 90 });
console.log(`    GE: MF=${a.mf.toFixed(6)} layers=${a.layers} time=${(a.time/1000).toFixed(1)}s\n`);

for (const N of [40, 60]) {
  console.log(`(B) Fixed-N multistart, N=${N} (8 structured starts, CG refine)…`);
  const b = multistart(N, 8);
  const verdict = b.mf < a.mf * 0.7 ? 'ESCAPES ✅ (<<baseline → build Approach B)'
    : b.mf < a.mf ? '~ better but not dramatic'
    : 'no better than greedy';
  console.log(`    best: MF=${b.mf.toFixed(6)} layers=${b.layers} start=${b.tag} time=${(b.time/1000).toFixed(1)}s  → ${verdict}\n`);
}
