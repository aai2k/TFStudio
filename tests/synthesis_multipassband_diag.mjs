/**
 * Multipassband synthesis diagnostic (scratch).
 *
 * Replicates the canonical needle / GE synthesis loop headless (no React, no
 * worker) using the exported optimizer primitives, on a 3-line bandpass target
 * modelled on Trubetskov, Appl. Opt. 59(5):A75 (2020) §4A.
 *
 * Goal: measure achieved MF / layer count / wall-time, and compare the
 * production "greedy-ordered, accept-first-improving (break)" needle trajectory
 * against a "deep-ish: refine all improving candidates, keep global best" one —
 * to see whether our stop behaviour leaves quality on the table on a
 * normal-incidence dielectric multipassband problem.
 *
 * Run: node tests/synthesis_multipassband_diag.mjs
 */

import {
  DLSOptimizer, makeOperand, calcMF,
  scanNeedlesPFunction, findOptimalNeedleThickness,
  insertNeedle, insertNeedleIntra, cleanupLayers,
  scanGEInsertions, buildEvalContext, evaluateOperands,
  refineWithEarlyStop,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const resolveMat = id => getMaterial(id);
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms
const deep = x => JSON.parse(JSON.stringify(x));

// Incremental log (this harness runs pure-JS TMM — timings are NOT
// production-representative; we care about final MF / layer count).
const LOG = join(dirname(fileURLToPath(import.meta.url)), '_mpb_diag_out.txt');
writeFileSync(LOG, '');
const emit = s => { console.log(s); appendFileSync(LOG, s + '\n'); };

// ── Target: 3-line transmission bandpass (TiO2/SiO2 on BK7, air, 0°) ──────────
// Passbands T→1 around 450/510/640 nm; stopbands T→0 between.
const operands = [
  // passbands
  makeOperand({ type: 'TAV', lambdaStart: 445, lambdaEnd: 455, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
  makeOperand({ type: 'TAV', lambdaStart: 505, lambdaEnd: 515, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
  makeOperand({ type: 'TAV', lambdaStart: 635, lambdaEnd: 645, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
  // stopbands
  makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 440, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
  makeOperand({ type: 'TAV', lambdaStart: 460, lambdaEnd: 500, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
  makeOperand({ type: 'TAV', lambdaStart: 520, lambdaEnd: 630, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
  makeOperand({ type: 'TAV', lambdaStart: 650, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
];

function seedDesign() {
  return {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    // start from a modest seed; needle/GE grow it
    frontLayers: [
      { id: 'S1', material: 'TiO2', thickness: 60, locked: false },
      { id: 'S2', material: 'SiO2', thickness: 100, locked: false },
    ],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
  };
}

// Thick single-layer seed: supply the bulk total optical thickness up front so
// needle has material to CARVE (needle adds no bulk). ~7000 nm ≈ the TOT a
// 3-line filter needs. This is the route the OTF multipassband demo almost
// certainly uses.
function thickSeed(materialId, thicknessNm = 7000) {
  return {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
      { id: 'T1', material: materialId, thickness: thicknessNm, locked: false },
    ],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
  };
}

const POOL = [
  { id: 'TiO2', name: 'TiO2', mat: getMaterial('TiO2') },
  { id: 'SiO2', name: 'SiO2', mat: getMaterial('SiO2') },
];

const DMIN = 5;
const DLS_ITER = 40;
const MAX_LAYERS = 28;
const MAX_STEPS = 120;
const DEEP_CAP = 16;   // deep variant refines top-N candidates by |dMF| (cap cost)

function refine(design, maxIter) {
  const dls = new DLSOptimizer(operands, design, resolveMat, { dMin: DMIN });
  let it = 0;
  for (; it < maxIter && !dls.isConverged(); it++) dls.step();
  return { design: dls.applyToDesign(design), mf: dls.mf, iters: it };
}

function refineAndPrune(design, maxIter) {
  const r = refine(design, maxIter);
  const pruned = cleanupLayers(r.design.frontLayers || [], DMIN);
  const pd = { ...r.design, frontLayers: pruned };
  // re-evaluate MF after prune (prune can change it)
  const ctx = buildEvalContext(pd, resolveMat);
  const mf = calcMF(operands, evaluateOperands(operands, ctx), { skipConstraints: true });
  return { design: pd, mf, iters: r.iters };
}

// Early-stop variant: refine with refineWithEarlyStop against an optional
// reference MF-trajectory, then prune + re-eval. Returns the refinement
// trajectory so the caller can use the best candidate's trajectory as the
// reference for the rest of the sweep.
function refineAndPruneES(design, maxIter, reference) {
  const dls = new DLSOptimizer(operands, design, resolveMat, { dMin: DMIN });
  const es  = refineWithEarlyStop(dls, { maxIter, reference });
  const rd  = dls.applyToDesign(design);
  const pruned = cleanupLayers(rd.frontLayers || [], DMIN);
  const pd = { ...rd, frontLayers: pruned };
  const ctx = buildEvalContext(pd, resolveMat);
  const mf = calcMF(operands, evaluateOperands(operands, ctx), { skipConstraints: true });
  return { design: pd, mf, iters: es.iters, trajectory: es.trajectory, aborted: es.aborted };
}

function insertOptimal(design, cand) {
  cand._mat = resolveMat(cand.materialId);
  let dOpt = DMIN;
  try {
    dOpt = findOptimalNeedleThickness({ operands, design, resolveMat, candidate: cand, deltaNm: DMIN, maxNm: 500, tol: 0.5, side: 'front' });
    if (!(dOpt >= DMIN)) dOpt = DMIN;
  } catch { dOpt = DMIN; }
  return cand.intra
    ? insertNeedleIntra(design, cand, dOpt, 'front')
    : insertNeedle(design, cand.pos, cand.materialId, dOpt, 'front');
}

// ── Variant A: production-style needle (greedy order, accept first improving) ──
function needleGreedy(start, { maxLayers = MAX_LAYERS, timeBudgetMs = Infinity } = {}) {
  let best = refineAndPrune(deep(start), DLS_ITER);
  let steps = 0, refinements = 0, timedOut = false;
  const tStart = now();
  for (; steps < MAX_STEPS; steps++) {
    if (now() - tStart > timeBudgetMs) { timedOut = true; break; }
    if ((best.design.frontLayers || []).length >= maxLayers) break;
    const { candidates } = scanNeedlesPFunction({ operands, design: best.design, resolveMat, candidateMats: POOL, deltaNm: 0.5, side: 'front' });
    const queue = candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF);
    if (!queue.length) break;
    let accepted = false;
    for (const cand of queue) {
      if (now() - tStart > timeBudgetMs) { timedOut = true; break; }
      const inserted = insertOptimal(best.design, cand);
      const r = refineAndPrune(inserted, DLS_ITER);
      refinements++;
      if (r.mf < best.mf - 1e-9) { best = r; accepted = true; break; } // <-- break (greedy)
    }
    if (timedOut || !accepted) break;
  }
  return { ...best, steps, refinements, timedOut };
}

// ── Variant B: deep-ish needle (refine ALL improving, keep global best) ───────
function needleDeep(start, { maxLayers = MAX_LAYERS, timeBudgetMs = Infinity } = {}) {
  let best = refineAndPrune(deep(start), DLS_ITER);
  let steps = 0, refinements = 0, timedOut = false;
  const tStart = now();
  for (; steps < MAX_STEPS; steps++) {
    if (now() - tStart > timeBudgetMs) { timedOut = true; break; }
    if ((best.design.frontLayers || []).length >= maxLayers) break;
    const { candidates } = scanNeedlesPFunction({ operands, design: best.design, resolveMat, candidateMats: POOL, deltaNm: 0.5, side: 'front' });
    const queue = candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF);
    if (!queue.length) break;
    let bestR = null;
    for (const cand of queue.slice(0, DEEP_CAP)) {
      if (now() - tStart > timeBudgetMs) { timedOut = true; break; }
      const inserted = insertOptimal(best.design, cand);
      const r = refineAndPrune(inserted, DLS_ITER);
      refinements++;
      if (!bestR || r.mf < bestR.mf) bestR = r;
    }
    const improved = bestR && bestR.mf < best.mf - 1e-9;
    if (improved) best = bestR;
    if (timedOut || !improved) break;
  }
  return { ...best, steps, refinements, timedOut };
}

// ── Variant B+: deep needle WITH early-termination ───────────────────────────
// Same "refine all top-N, keep global best" as needleDeep, but each candidate
// is refined with refineWithEarlyStop against the best trajectory seen so far
// in the sweep — doomed candidates are killed early, so the budget buys more
// carve depth. The FIRST candidate of each step runs reference-free (sets the
// bar); the rest abort when they plateau below it.
function needleDeepES(start, { maxLayers = MAX_LAYERS, timeBudgetMs = Infinity } = {}) {
  let best = refineAndPrune(deep(start), DLS_ITER);
  let steps = 0, refinements = 0, timedOut = false;
  const tStart = now();
  for (; steps < MAX_STEPS; steps++) {
    if (now() - tStart > timeBudgetMs) { timedOut = true; break; }
    if ((best.design.frontLayers || []).length >= maxLayers) break;
    const { candidates } = scanNeedlesPFunction({ operands, design: best.design, resolveMat, candidateMats: POOL, deltaNm: 0.5, side: 'front' });
    const queue = candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF);
    if (!queue.length) break;
    let bestR = null, ref = null;
    for (const cand of queue.slice(0, DEEP_CAP)) {
      if (now() - tStart > timeBudgetMs) { timedOut = true; break; }
      const inserted = insertOptimal(best.design, cand);
      const r = refineAndPruneES(inserted, DLS_ITER, ref);
      refinements++;
      if (!bestR || r.mf < bestR.mf) { bestR = r; ref = r.trajectory; } // best trajectory becomes the bar
    }
    const improved = bestR && bestR.mf < best.mf - 1e-9;
    if (improved) best = bestR;
    if (timedOut || !improved) break;
  }
  return { ...best, steps, refinements, timedOut };
}

// ── Variant C: GE (inner needle-opt + forced TOT) ─────────────────────────────
function geSynthesis(start, { maxLayers = MAX_LAYERS, timeBudgetMs = Infinity } = {}) {
  let work = refineAndPrune(deep(start), DLS_ITER);
  let best = { ...work };
  let needleRows = 0, geRows = 0, refinements = 0, geStagn = 0, timedOut = false;
  const tStart = now();
  for (let step = 0; step < MAX_STEPS; step++) {
    if (now() - tStart > timeBudgetMs) { timedOut = true; break; }
    if ((work.design.frontLayers || []).length >= maxLayers) break;
    // inner needle-opt on `work`
    const { candidates } = scanNeedlesPFunction({ operands, design: work.design, resolveMat, candidateMats: POOL, deltaNm: 0.5, side: 'front' });
    const queue = candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF);
    let accepted = false;
    for (const cand of queue) {
      if (now() - tStart > timeBudgetMs) { timedOut = true; break; }
      const inserted = insertOptimal(work.design, cand);
      const r = refineAndPrune(inserted, DLS_ITER);
      refinements++;
      if (r.mf < work.mf - 1e-9) {
        work = r; accepted = true; needleRows++;
        if (work.mf < best.mf - 1e-9) { best = { ...work }; geStagn = 0; }
        break;
      }
    }
    if (timedOut) break;
    if (accepted) continue;
    // needle-optimal → forced TOT (GE step)
    const geScan = scanGEInsertions({ operands, design: work.design, resolveMat, candidateMats: POOL, thickNm: DMIN, side: 'front' });
    if (!geScan.candidates.length) break;
    const bestGe = geScan.candidates.reduce((b, x) => (x.mfNew < b.mfNew ? x : b), geScan.candidates[0]);
    const geDesign = insertNeedle(work.design, bestGe.pos, bestGe.materialId, DMIN, 'front');
    work = { design: geDesign, mf: bestGe.mfNew };
    geRows++; geStagn++;
    if (geStagn > 6) break;
  }
  return { ...best, needleRows, geRows, refinements, timedOut };
}

// ── Run ───────────────────────────────────────────────────────────────────────
const THICK_MAX_LAYERS = 80;   // thick seed already holds the TOT; let needle carve freely
// Wall-clock budget PER METHOD. Pure-JS TMM is far slower than the production
// WASM core (user reports a good ~60-layer design in 1-2 min in the TFStudio
// GUI); this harness only compares MF/layers reachable within a fixed budget,
// and the budget is what stops a runaway carve. Override via env DIAG_BUDGET_S.
const BUDGET_MS = (Number(process.env.DIAG_BUDGET_S) || 90) * 1000;

const METHODS = [
  ['Needle GREEDY (break-first)', needleGreedy],
  [`Needle DEEP (top-${DEEP_CAP})`, needleDeep],
  [`Needle DEEP+ES (top-${DEEP_CAP})`, needleDeepES],
  ['Gradual Evolution', geSynthesis],
];

function runSuite(seedLabel, start, opts) {
  const mf0 = new DLSOptimizer(operands, start, resolveMat, { dMin: DMIN }).mf;
  const tot0 = (start.frontLayers || []).reduce((s, l) => s + (l.thickness || 0), 0);
  emit(`--- SEED: ${seedLabel} — ${start.frontLayers.length} layer(s), Σd=${tot0.toFixed(0)} nm, start MF = ${mf0.toFixed(6)} (maxLayers=${opts.maxLayers}) ---`);
  for (const [label, fn] of METHODS) {
    const t0 = now();
    const r = fn(start, opts);
    const dt = now() - t0;
    const layers = (r.design.frontLayers || []).length;
    const tot = (r.design.frontLayers || []).reduce((s, l) => s + (l.thickness || 0), 0);
    const extra = r.steps != null
      ? `steps=${r.steps} refines=${r.refinements}`
      : `needleRows=${r.needleRows} geRows=${r.geRows} refines=${r.refinements}`;
    const to = r.timedOut ? ' [TIMED OUT]' : '';
    emit(`${label.padEnd(26)}  finalMF=${r.mf.toFixed(6)}  layers=${String(layers).padStart(3)}  Σd=${String(tot.toFixed(0)).padStart(5)}nm  time=${(dt/1000).toFixed(1).padStart(6)}s  ${extra}${to}`);
  }
  emit('');
}

emit('=== Multipassband synthesis diagnostic (3-line bandpass, lower MF = better) ===');
emit('NOTE: pure-JS TMM (no WASM) — timings NOT production-representative; compare MF/layers.');
emit('Thin vs thick seed: thin (160nm) is TOT-starved (needle adds no bulk); thick (~7000nm)');
emit('supplies the TOT up front so needle can carve it — user finding 2026-06-02, PLAN §13.\n');

emit(`Per-method wall-clock budget: ${(BUDGET_MS / 1000).toFixed(0)}s (env DIAG_BUDGET_S to override).\n`);
runSuite('thin 160 nm (TiO2 60 / SiO2 100) — TOT-starved baseline', seedDesign(), { maxLayers: MAX_LAYERS, timeBudgetMs: BUDGET_MS });
runSuite('thick 7000 nm TiO2 (high-index)', thickSeed('TiO2', 7000), { maxLayers: THICK_MAX_LAYERS, timeBudgetMs: BUDGET_MS });
runSuite('thick 7000 nm SiO2 (low-index)',  thickSeed('SiO2', 7000), { maxLayers: THICK_MAX_LAYERS, timeBudgetMs: BUDGET_MS });
