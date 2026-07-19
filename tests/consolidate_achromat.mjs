/**
 * Merit-aware layer-consolidation validation on the USER's real achromat case.
 *
 * Loads the actual project files + user_achromat catalog from Documents\TFStudio,
 * resolves the tabular (formulaNum −1) materials with the SAME linear-λ interp
 * the app uses (catalogManager.makeGetNK), and runs the production makeEngine
 * refiner. Three checks:
 *
 *   A. Faithfulness — refine the KNOWN-GOOD 3-layer design; MF should land near
 *      the user's reported 0.001167 (confirms materials/operands/refiner match).
 *   B. Bloat — needle-synthesise from the 1-layer "achromat synth" starter
 *      (dMin=40, DLS) until needle-optimal → an over-segmented stack (the user
 *      saw 8–23 layers).
 *   C. Consolidate — run removeRedundantLayers on the bloated stack; expect it
 *      to collapse toward ~3 layers WITHOUT worsening MF. Also consolidate the
 *      known-good design (must stay 3 layers — nothing redundant to remove).
 *
 * Run:  node tests/consolidate_achromat.mjs
 */
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';
import {
  makeOperand, isConstraint, scanNeedlesPFunction, findOptimalNeedleThickness,
  insertNeedle, insertNeedleIntra, cleanupLayers, removeRedundantLayers,
} from '../src/utils/physics/optimizer.js';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { generateARSeeds, rankSeeds, classifyPoolByIndex } from '../src/utils/synthesis/seedGenerator.js';

const PROJ = join(homedir(), 'Documents', 'TFStudio', 'Projects', 'synthesis improvement');
const CAT  = join(homedir(), 'Documents', 'TFStudio', 'Materials', 'user', 'user_achromat.catalog.json');
const deep = (x) => JSON.parse(JSON.stringify(x));
const sumTot = (d) => (d.frontLayers || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);

// ── material resolution: user catalog (tabular) + builtin (BK7/Air) ──────────
// Mirrors catalogManager.makeGetNK for formulaNum === -1 (linear-λ, clamped).
function makeTabularGetNK(tabData) {
  const data = (tabData || []).slice().sort((a, b) => a[0] - b[0]);
  if (data.length === 0) return () => [1.5, 0];
  if (data.length === 1) return () => [data[0][1], data[0][2] || 0];
  return (lam) => {
    if (lam <= data[0][0]) return [data[0][1], data[0][2] || 0];
    const last = data[data.length - 1];
    if (lam >= last[0]) return [last[1], last[2] || 0];
    let lo = 0, hi = data.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (data[mid][0] <= lam) lo = mid; else hi = mid; }
    const frac = (lam - data[lo][0]) / (data[hi][0] - data[lo][0]);
    return [data[lo][1] + frac * (data[hi][1] - data[lo][1]),
            (data[lo][2] || 0) + frac * ((data[hi][2] || 0) - (data[lo][2] || 0))];
  };
}
const catalog = JSON.parse(readFileSync(CAT, 'utf8'));
const userMats = new Map();   // bareId → { id, name, getNK }
for (const [id, m] of Object.entries(catalog.materials)) {
  userMats.set(id, { id, name: m.name || id, getNK: makeTabularGetNK(m.tabData) });
}
function resolveMat(id) {
  if (id == null || id === '' || id === 'Air') return getMaterial('Air');
  const bare = id.includes(':') ? id.split(':').pop() : id;
  if (userMats.has(bare)) return userMats.get(bare);
  return getMaterial(bare);                                  // BK7 etc.
}

// ── project loader ────────────────────────────────────────────────────────────
function loadTfs(name) {
  const j = JSON.parse(readFileSync(join(PROJ, name), 'utf8'));
  const design = {
    incidentMedium: j.incidentMedium || 'Air', exitMedium: j.exitMedium || 'Air',
    substrate: { material: (j.substrate?.material || 'BK7').split(':').pop(),
                 thickness: j.substrate?.thickness ?? 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: (j.frontLayers || []).map(L => ({ ...L })),  // keep full catalog ids
    backLayers: [],
  };
  const operands = (j.meritOperands || [])
    .filter(o => o.enabled && o.type !== 'DMFS' && !isConstraint(o.type))
    .map(o => makeOperand(o));
  return { design, operands };
}

// ── plateau-stopping refine (matches synthesisWorker.runDls) ─────────────────
const CONV_PATIENCE = 6, CONV_MIN_GAIN = 1e-4;
function refine(operands, design, dMin, maxIter, engine = 'dls') {
  const opt = makeEngine(engine, operands, design, resolveMat, { dMin });
  const hist = [opt.mf];
  while (!(opt.isConverged() || opt.iter >= maxIter)) {
    opt.step(); hist.push(opt.mf);
    const h = hist.length - 1;
    if (h >= CONV_PATIENCE) {
      const past = hist[h - CONV_PATIENCE];
      if ((past > 0 ? (past - opt.mf) / past : 0) < CONV_MIN_GAIN) break;
    }
  }
  return opt;
}
// refineFn for removeRedundantLayers: returns applied + pruned design.
function makeRefineFn(operands, dMin, engine) {
  return (design, maxIter) => {
    const opt = refine(operands, design, dMin, maxIter, engine);
    const applied = opt.applyToDesign(design);
    return {
      mf: opt.mf,
      omf: opt.mfOpticalAt(opt.thicknesses),
      design: { ...applied, frontLayers: cleanupLayers(applied.frontLayers || [], dMin),
                            backLayers:  cleanupLayers(applied.backLayers  || [], dMin) },
    };
  };
}

// ── faithful needle synthesis (serial worker-pool path) ──────────────────────
function runNeedle(seedDesign, operands, pool, { dMin, maxLayers, dlsIter, engine = 'dls' }) {
  const seed = refine(operands, seedDesign, dMin, dlsIter, engine);
  let work = { ...seed.applyToDesign(seedDesign) };
  work.frontLayers = cleanupLayers(work.frontLayers, dMin);
  let bestMf = seed.mf;
  let reason = 'needle-optimal';
  while (true) {
    if (work.frontLayers.length >= maxLayers) { reason = 'max-layers'; break; }
    const { candidates } = scanNeedlesPFunction({
      operands, design: work, resolveMat, candidateMats: pool, deltaNm: 0.5, side: 'front' });
    const queue = candidates.filter(c => c.dMF < 0).sort((a, b) => (a.dMF - b.dMF) || ((a.pos ?? 0) - (b.pos ?? 0)));
    if (!queue.length) break;
    let accepted = false;
    for (let i = 0, bN = 0; i < queue.length && bN < 2; i += 4, bN++) {
      let bestCand = null;
      for (const cand of queue.slice(i, i + 4)) {
        cand._mat = pool.find(p => p.id === cand.materialId)?.mat;
        let dOpt = dMin;
        try {
          dOpt = findOptimalNeedleThickness({ operands, design: work, resolveMat, candidate: cand,
            deltaNm: dMin, maxNm: 500, tol: 0.5, side: 'front' });
          if (!(dOpt >= dMin)) dOpt = dMin;
        } catch (_) { dOpt = dMin; }
        const inserted = cand.intra
          ? insertNeedleIntra(work, cand, dOpt, 'front')
          : insertNeedle(work, cand.pos, cand.materialId, dOpt, 'front');
        const d = refine(operands, inserted, dMin, dlsIter, engine);
        const post = d.applyToDesign(inserted);
        const pruned = cleanupLayers(post.frontLayers, dMin);
        if (!pruned.length) continue;
        if (!bestCand || d.mf < bestCand.mf) bestCand = { mf: d.mf, design: { ...post, frontLayers: pruned } };
      }
      if (bestCand && bestCand.mf < bestMf - 1e-9) {
        bestMf = bestCand.mf; work = deep(bestCand.design); accepted = true; break;
      }
    }
    if (!accepted) break;
  }
  return { design: work, mf: bestMf, layers: work.frontLayers.length, reason };
}

const fmtStack = (d) => (d.frontLayers || [])
  .map(L => `${(L.material.split(':').pop())}:${L.thickness.toFixed(1)}`).join(' | ');

// ── run ──────────────────────────────────────────────────────────────────────
const ok = await initWasmForTest();
console.log(`WASM active: ${ok} (${tmmWasmActive()})\n`);

const DMIN = 40, DLS_ITER = 40, MAX_LAYERS = 50, ENGINE = 'dls';
// Pool ids MUST be the full catalog-prefixed ids so they match the seed layer's
// material string — otherwise cleanupLayers treats 'MgF2' and 'user_achromat:MgF2'
// as different materials and never merges adjacent same-material layers.
const pool = ['user_achromat:MgF2', 'user_achromat:ZrO2P', 'user_achromat:Al2O3__190-800nm__RIT']
  .map(id => ({ id, name: id.split(':').pop(), mat: resolveMat(id) }));

// ── A. faithfulness: refine the known-good 3-layer ───────────────────────────
const good = loadTfs('achromat.tfs');
const goodOpt = refine(good.operands, good.design, DMIN, 200, ENGINE);
console.log('── A. Known-good 3-layer (faithfulness check) ──');
console.log(`   operands: ${good.operands.map(o => o.type).join(', ')}`);
console.log(`   refined MF = ${goodOpt.mf.toFixed(6)}   (user reported 0.001167)`);
console.log(`   stack: ${fmtStack(goodOpt.applyToDesign(good.design))}\n`);

// ── B0. pure needle from the 1-layer starter (no forced steps) ───────────────
const start = loadTfs('achromat synth.tfs');
console.log('── B0. Pure needle from 1-layer starter (stops needle-optimal) ──');
console.log(`   seed: ${fmtStack(start.design)}  dMin=${DMIN} engine=${ENGINE}`);
const syn = runNeedle(start.design, start.operands, pool, { dMin: DMIN, maxLayers: MAX_LAYERS, dlsIter: DLS_ITER, engine: ENGINE });
console.log(`   → ${syn.layers} layers, MF = ${syn.mf.toFixed(6)}  [${syn.reason}]`);
console.log(`   stack: ${fmtStack(syn.design)}\n`);

// ── C. consolidate the pure-needle result ────────────────────────────────────
console.log('── C. Consolidation pass on pure-needle stack ──');
for (const tol of [0.05, 0.20]) {
  const refineFn = makeRefineFn(start.operands, DMIN, ENGINE);
  const res = removeRedundantLayers({
    design: deep(syn.design), side: 'front', dMin: DMIN, tol, minLayers: 1, maxIter: DLS_ITER, refineFn });
  console.log(`   tol=${(tol * 100).toFixed(0).padStart(2)}%  ${res.baseLayers}L (MF ${res.baseMf.toFixed(6)}) ` +
    `→ ${res.design.frontLayers.length}L (MF ${res.mf.toFixed(6)})  removed=${res.removed}`);
  console.log(`            stack: ${fmtStack(res.design)}`);
}

// ── B2/C-bloat. CONTROLLED bloat: known-good 3L + injected redundant layers ──
// This is exactly what GE's forced-TOT steps do: drop extra dMin-thick layers
// the MNT penalty then parks at ~40 nm. Consolidation should remove them and
// recover the 3-layer optimum.
console.log('\n── B2. Controlled bloat: good 3L + 4 injected 40nm layers ──');
let bloated = deep(good.design);
const mkL = (mat, t) => ({ id: 'inj' + Math.random().toString(36).slice(2, 7), material: mat, thickness: t, locked: false });
bloated.frontLayers = [
  mkL('user_achromat:ZrO2P', 40), good.design.frontLayers[0],
  mkL('user_achromat:Al2O3__190-800nm__RIT', 40), good.design.frontLayers[1],
  mkL('user_achromat:MgF2', 40), good.design.frontLayers[2], mkL('user_achromat:ZrO2P', 40),
].map(deep);
const bloatedRef = refine(good.operands, bloated, DMIN, DLS_ITER, ENGINE);
console.log(`   injected 7L, refined MF = ${bloatedRef.mf.toFixed(6)}`);
console.log(`   stack: ${fmtStack(bloatedRef.applyToDesign(bloated))}`);
console.log('── C-bloat. Consolidate the injected-bloat stack ──');
for (const tol of [0.05, 0.20]) {
  const refineFn = makeRefineFn(good.operands, DMIN, ENGINE);
  const res = removeRedundantLayers({
    design: deep(bloated), side: 'front', dMin: DMIN, tol, minLayers: 1, maxIter: DLS_ITER, refineFn });
  console.log(`   tol=${(tol * 100).toFixed(0).padStart(2)}%  ${res.baseLayers}L (MF ${res.baseMf.toFixed(6)}) ` +
    `→ ${res.design.frontLayers.length}L (MF ${res.mf.toFixed(6)})  removed=${res.removed}`);
  console.log(`            stack: ${fmtStack(res.design)}`);
}

// ── D. SMART SEED: generateARSeeds() from the pool, refine + rank ─────────────
// Exercises the REAL generator: classify pool by index, emit canonical QW/HW AR
// templates, refine each with the production refiner, keep the best. No
// knowledge of the answer.
const LAM0 = good.design.referenceWavelength || 550;
const roles = classifyPoolByIndex(pool, LAM0);
console.log(`\n── D. Smart-seed generator (λ0=${LAM0}) ──`);
console.log(`   roles: low=${roles.low?.name}(${roles.low?.n.toFixed(3)})  ` +
  `med=${roles.med?.name}(${roles.med?.n.toFixed(3)})  high=${roles.high?.name}(${roles.high?.n.toFixed(3)})`);
const seeds = generateARSeeds({ pool, lambda0: LAM0, baseDesign: good.design, maxLayers: 6 });
const refineFnSeed = makeRefineFn(good.operands, DMIN, ENGINE);
const { best, ranked } = rankSeeds(seeds, (d) => refineFnSeed(d, 200));
for (const s of ranked) {
  console.log(`   ${s.name.padEnd(28)} → MF ${s.mf.toFixed(6)} (${s.refinedDesign.frontLayers.length}L)  ${fmtStack(s.refinedDesign)}`);
}
console.log(`   BEST: ${best.name}  MF ${best.mf.toFixed(6)}`);

// ── C2. consolidate the known-good (should NOT shrink) ───────────────────────
const refineFnGood = makeRefineFn(good.operands, DMIN, ENGINE);
const resGood = removeRedundantLayers({
  design: deep(good.design), side: 'front', dMin: DMIN, tol: 0.05, minLayers: 1, maxIter: 200, refineFn: refineFnGood });
console.log(`\n── C2. Consolidate known-good 3L (sanity: stays 3) ──`);
console.log(`   ${resGood.baseLayers}L (MF ${resGood.baseMf.toFixed(6)}) → ${resGood.design.frontLayers.length}L (MF ${resGood.mf.toFixed(6)})  removed=${resGood.removed}`);
