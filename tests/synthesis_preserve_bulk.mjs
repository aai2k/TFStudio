/**
 * Preserve-bulk + GE-vs-Needle diagnostic.
 *
 * Two questions, both on the REAL optimizer (makeEngine 'cg') + WASM kernel,
 * run on the user's REAL 4-line OTF-demo HIGH-index-seed project (single thick
 * 7000 nm TiO2 layer → 4 passbands / 5 stopbands, TGT per-λ targets):
 *
 *  Q1 — Why does GE underperform standalone Needle even when it makes ZERO
 *       forced-TOT steps?  Prime suspect: GE's synthesis floor dMin=15 nm
 *       (MNT-coupled) vs Needle's dMin=1 nm. A 15 nm insert/prune floor carves
 *       the index profile coarsely; 1 nm needles split finely. Test: same
 *       faithful needle loop at dMin ∈ {1, 15}.
 *
 *  Q2 — Does the "gentle refine" (cap inner refine to GENTLE iters)
 *       hold the seed's optical thickness higher than a full per-step refine,
 *       and reach equal-or-better quality?  User GUI Needle (dMin≈1, full
 *       refine) rode TOT 7060 → ~5600 to 97 L / MF 0.026. Test full vs gentle.
 *
 * This is a FAITHFUL re-implementation of the worker-pool needle loop (scan →
 * best-of-batch candidate refine with keep-best → accept-or-needle-optimal),
 * NOT a hand-rolled optimizer — the refiner is the production makeEngine('cg').
 * Materials are the builtin TiO2/SiO2 (the project's user-catalog dispersion is
 * close); the comparison is relative (identical materials across all arms), so
 * absolute MF may differ slightly from the GUI but the TREND is faithful.
 *
 * Run:  node tests/synthesis_preserve_bulk.mjs
 *       [DIAG_BUDGET_S=90] [DIAG_MAXLAYERS=70] node tests/synthesis_preserve_bulk.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { initWasmForTest, getTmmWasm, tmmWasmActive } from './_wasmInit.mjs';
import {
  makeOperand, scanNeedlesPFunction, findOptimalNeedleThickness,
  insertNeedle, insertNeedleIntra, cleanupLayers, isConstraint,
} from '../src/utils/physics/optimizer.js';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id === 'Air' || !id ? 'Air' : id.includes(':') ? id.split(':').pop() : id);
const AIR = getMaterial('Air');
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;          // ms
const deep = x => JSON.parse(JSON.stringify(x));
const sumTot = d => (d.frontLayers || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);

const BUDGET_S    = Number(process.env.DIAG_BUDGET_S || 90);
const MAX_LAYERS  = Number(process.env.DIAG_MAXLAYERS || 70);
const DLS_ITER    = 80;
const GENTLE_ITER = 15;     // = PRESERVE_BULK_GENTLE_ITER
const K           = 4;      // batch size (pool-size analogue)
const MAX_BATCHES = 2;      // 'balanced' default

// ── plateau-stopping CG refine (matches synthesisWorker.runDls) ──────────────
const CONV_PATIENCE = 6, CONV_MIN_GAIN = 1e-4;
function refine(operands, design, dMin, maxIter, engine = 'cg') {
  const opt = makeEngine(engine, operands, design, resolveMat, { dMin });
  const hist = [opt.mf];
  while (!(opt.isConverged() || opt.iter >= maxIter)) {
    opt.step();
    hist.push(opt.mf);
    const h = hist.length - 1;
    if (h >= CONV_PATIENCE) {
      const past = hist[h - CONV_PATIENCE];
      const gain = past > 0 ? (past - opt.mf) / past : 0;
      if (gain < CONV_MIN_GAIN) break;
    }
  }
  return opt;
}

// ── faithful needle loop (the worker-pool path, serial) ──────────────────────
// seedMode: 'refine' (full seed refine + full step refine) |
//           'preserve-bulk' (skip seed refine + gentle step refine)
function runNeedle(seedDesign, operands, pool, { dMin, skipSeed, gentle, engine = 'cg', label }) {
  const stepIter = gentle ? Math.min(DLS_ITER, GENTLE_ITER) : DLS_ITER;
  const t0 = now();
  const recs = [];

  // Seed: refine (legacy GE) or evaluate-only (skipSeed — what GUI Needle does
  // by scanning first; the lone-layer refine is the TOT collapse).
  const seedOpt = refine(operands, seedDesign, dMin, skipSeed ? 0 : DLS_ITER, engine);
  let workDesign = seedOpt.applyToDesign(seedDesign);
  const best = { mf: seedOpt.mf, design: deep(workDesign) };
  recs.push({ gen: 0, mf: best.mf, layers: workDesign.frontLayers.length, tot: sumTot(workDesign), tMs: now() - t0 });

  let gen = 0, reason = 'needle-optimal';
  while (true) {
    if ((now() - t0) / 1000 > BUDGET_S) { reason = 'budget'; break; }
    if (workDesign.frontLayers.length >= MAX_LAYERS) { reason = 'max-layers'; break; }

    const { candidates } = scanNeedlesPFunction({
      operands, design: workDesign, resolveMat, candidateMats: pool, deltaNm: 0.5, side: 'front' });
    const queue = candidates.filter(c => c.dMF < 0).sort((a, b) =>
      (a.dMF - b.dMF) || ((a.pos ?? 0) - (b.pos ?? 0)));
    if (!queue.length) { reason = 'needle-optimal'; break; }

    let accepted = false;
    for (let i = 0, bN = 0; i < queue.length && bN < MAX_BATCHES; i += K, bN++) {
      const batch = queue.slice(i, i + K);
      let bestCand = null;
      for (const cand of batch) {
        cand._mat = pool.find(p => p.id === cand.materialId)?.mat;
        let dOpt = dMin;
        try {
          dOpt = findOptimalNeedleThickness({
            operands, design: workDesign, resolveMat, candidate: cand,
            deltaNm: dMin, maxNm: 500, tol: 0.5, side: 'front' });
          if (!(dOpt >= dMin)) dOpt = dMin;
        } catch (_) { dOpt = dMin; }
        const inserted = cand.intra
          ? insertNeedleIntra(workDesign, cand, dOpt, 'front')
          : insertNeedle(workDesign, cand.pos, cand.materialId, dOpt, 'front');
        const d = refine(operands, inserted, dMin, stepIter, engine);
        const post = d.applyToDesign(inserted);
        const pruned = cleanupLayers(post.frontLayers, dMin);
        if (!pruned.length) continue;
        if (!bestCand || d.mf < bestCand.mf)
          bestCand = { mf: d.mf, design: { ...post, frontLayers: pruned }, mat: cand.materialId };
      }
      if (bestCand && bestCand.mf < best.mf - 1e-9) {
        best.mf = bestCand.mf; best.design = deep(bestCand.design);
        workDesign = deep(bestCand.design);
        gen++;
        recs.push({ gen, mf: best.mf, layers: workDesign.frontLayers.length,
          tot: sumTot(workDesign), tMs: now() - t0, mat: bestCand.mat });
        accepted = true;
        break;
      }
    }
    if (!accepted) { reason = 'needle-optimal'; break; }
  }
  return { recs, best, ms: now() - t0, reason, label };
}

// ── spectral yardstick (dense in-band grid; identical to merit_landscape) ────
const PASS = [[437, 467], [512, 543], [593, 648], [700, 763]];
const STOP = [[400, 430], [473, 507], [550, 587], [655, 693], [770, 812]];
const _nk = new Map();
const nkOf = (m, l) => { const k = m + '@' + l; let v = _nk.get(k); if (v === undefined) { v = resolveMat(m).getNK(l); _nk.set(k, v); } return v; };
function spectrum(design, lams) {
  const W = getTmmWasm();
  const n0 = lams.map(l => AIR.getNK(l));
  const ns = lams.map(l => nkOf(design.substrate.material, l));
  const layerNK = design.frontLayers.map(L => lams.map(l => nkOf(L.material, l)));
  const thick = design.frontLayers.map(L => L.thickness);
  return W.tmmSpectrum(lams, n0, ns, layerNK, thick, 0).Ts;
}
const YGRID = [];
for (const [a, b] of PASS) for (let l = a; l <= b + 1e-9; l += 2) YGRID.push({ l, t: 1, p: true });
for (const [a, b] of STOP) for (let l = a; l <= b + 1e-9; l += 2) YGRID.push({ l, t: 0, p: false });
const YLAMS = YGRID.map(g => g.l);
function yardstick(design) {
  const Ts = spectrum(design, YLAMS);
  let pS = 0, pN = 0, sS = 0, sN = 0, pW = 0;
  for (let i = 0; i < YGRID.length; i++) {
    const dev = Ts[i] - YGRID[i].t;
    if (YGRID[i].p) { pS += dev * dev; pN++; pW = Math.max(pW, Math.abs(dev)); }
    else            { sS += dev * dev; sN++; }
  }
  return { passWorst: pW, passRMS: Math.sqrt(pS / pN), stopRMS: Math.sqrt(sS / sN) };
}

// ── load the project ─────────────────────────────────────────────────────────
const TFS = process.argv[2] || join(homedir(), 'Documents', 'TFStudio', 'Projects',
  'My Designs', 'Multipassband 4-line (OTF demo, HIGH-index seed) TGT.tfs');
function loadTfs(p) {
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const design = {
    incidentMedium: j.incidentMedium || 'Air', exitMedium: j.exitMedium || 'Air',
    substrate: { material: (j.substrate?.material || 'BK7').split(':').pop(), thickness: j.substrate?.thickness ?? 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: (j.frontLayers || []).map(L => ({ ...L, material: L.material.includes(':') ? L.material.split(':').pop() : L.material })),
    backLayers: [],
  };
  const operands = (j.meritOperands || [])
    .filter(o => o.enabled && o.type !== 'DMFS' && !isConstraint(o.type))
    .map(o => makeOperand(o));
  return { design, operands };
}

// ── run ────────────────────────────────────────────────────────────────────
mkdirSync('tests/out', { recursive: true });
const ok = await initWasmForTest();
console.log(`WASM active: ${ok} (tmmWasmActive=${tmmWasmActive()})`);
console.log(`Project: ${TFS}`);
const { design, operands } = loadTfs(TFS);
console.log(`Seed: ${design.frontLayers.length} layer(s), TOT=${sumTot(design).toFixed(0)} nm, ${operands.length} operands`);
console.log(`Budget ${BUDGET_S}s/arm, maxLayers ${MAX_LAYERS}, dlsIter ${DLS_ITER}, gentle ${GENTLE_ITER}, K=${K}, maxBatches=${MAX_BATCHES}\n`);

const TiO2 = { id: 'TiO2', name: 'TiO2', mat: resolveMat('TiO2') };
const SiO2 = { id: 'SiO2', name: 'SiO2', mat: resolveMat('SiO2') };
const pool = [TiO2, SiO2];

// Q3 (user direction 2026-06-03): GUI showed DLS >> CG and preserve-bulk+DLS=0.087
// @ dMin15. Does dropping GE's floor to dMin=1 (Needle's value) close the gap to
// standalone Needle's 0.026? All preserve-bulk + DLS (the GUI-best combo).
const ARMS = [
  { label: 'preserve-bulk + DLS, dMin=15 (≈user GUI 0.087)', dMin: 15, skipSeed: true, gentle: true, engine: 'dls' },
  { label: 'preserve-bulk + DLS, dMin=1  (Needle floor)',    dMin: 1,  skipSeed: true, gentle: true, engine: 'dls' },
  { label: 'preserve-bulk + CG,  dMin=1  (engine compare)',  dMin: 1,  skipSeed: true, gentle: true, engine: 'cg'  },
];

const results = [];
for (const arm of ARMS) {
  const r = runNeedle(design, operands, pool, arm);
  const y = yardstick(r.best.design);
  results.push({ arm, r, y });
  const totMin = Math.min(...r.recs.map(x => x.tot));
  const totFinal = r.recs[r.recs.length - 1].tot;
  console.log(`■ ${arm.label}`);
  console.log(`   final MF=${r.best.mf.toFixed(5)}  layers=${r.best.design.frontLayers.length}  ` +
    `TOT: seed→${totFinal.toFixed(0)} (min ${totMin.toFixed(0)})  ${(r.ms/1000).toFixed(1)}s  [${r.reason}]`);
  console.log(`   spectral: passWorst=${y.passWorst.toFixed(4)}  passRMS=${y.passRMS.toFixed(4)}  stopRMS=${y.stopRMS.toFixed(4)}`);
  // sparse TOT trajectory
  const step = Math.max(1, Math.floor(r.recs.length / 8));
  const traj = r.recs.filter((_, i) => i % step === 0 || i === r.recs.length - 1)
    .map(x => `${x.layers}L:${x.tot.toFixed(0)}/${x.mf.toFixed(3)}`).join('  ');
  console.log(`   traj (L:TOT/MF): ${traj}\n`);
}

// dump best spectra for eyeballing
for (const { arm, r } of results) {
  const lams = []; for (let l = 400; l <= 812; l++) lams.push(l);
  const Ts = spectrum(r.best.design, lams);
  const tag = arm.label.replace(/[^a-z0-9]+/gi, '_');
  writeFileSync(`tests/out/pbulk_${tag}.csv`, ['lam_nm,T', ...lams.map((l, i) => `${l},${Ts[i].toFixed(6)}`)].join('\n'));
}

console.log('Spectra → tests/out/pbulk_*.csv');
console.log('\nReading:');
console.log(' • Q1 (GE<Needle): dMin=15 vs dMin=1 at the SAME (refine) settings — if 15 is worse');
console.log('   MF/quality, the GE deficit is its MNT-coupled 15 nm floor, not the GE algorithm.');
console.log(' • Q2 (preserve-bulk): does gentle hold TOT higher than refine AND match/beat its MF?');
