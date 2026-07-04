/**
 * Merit-function landscape test ("Power" merit).
 *
 * Hypothesis: an L2 (sum-of-squares) absolute-T merit goes FLAT near a rippled-
 * but-close design (the few worst passband-ripple points are diluted by the many
 * good points), so synthesis stalls (4-band high-index stall ~0.106, rippled
 * passbands). Two levers help here: (a) per-band weight (spatial emphasis) and (b)
 * "Power" Lᴾ (magnitude emphasis; P→∞ = minimax/equiripple) to keep a gradient
 * toward the worst points. The *worst-case-emphasis* idea is testable with the
 * existing minmax operands (TMN = worst T in band ≥ target; TMX = worst T ≤
 * target) — that IS the P→∞ limit, no new math.
 *
 * Method (all on the REAL optimizer + WASM; spectra == GUI to 1e-15):
 *   D = best L2-refined fixed-N QWOT design (a realistic "rippled stall").
 *   Re-refine D under each operand set, score on a FIXED yardstick (passband
 *   worst |1−T|, passband RMS, stopband RMS) + dump spectra to tests/out/.
 * WIN for a variant = lower passWorst than L2 (merit shaping cleans the ripple).
 *
 * Run:  node tests/synthesis_merit_landscape.mjs [design.tfs]
 */
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { initWasmForTest, getTmmWasm, tmmWasmActive } from './_wasmInit.mjs';
import { makeOperand, cleanupLayers } from '../src/utils/physics/optimizer.js';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id === 'Air' ? 'Air' : id.includes(':') ? id.split(':').pop() : id);
const AIR = getMaterial('Air');
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const DMIN = 5;

const PASS = [[437, 467], [512, 543], [593, 648], [700, 763]];
const STOP = [[400, 430], [473, 507], [550, 587], [655, 693], [770, 812]];

// ── operand sets ────────────────────────────────────────────────────────────
const tgt = (a, b, t, w) => makeOperand({ type: 'TGT', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: t, targetEnd: t, weight: w });
const tmn = (a, b, w) => makeOperand({ type: 'TMN', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: 1, weight: w }); // worst T ≥ 1
const tmx = (a, b, w) => makeOperand({ type: 'TMX', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: 0, weight: w }); // worst T ≤ 0
const opsTGT   = (pw = 1) => [...PASS.map(([a, b]) => tgt(a, b, 1, pw)), ...STOP.map(([a, b]) => tgt(a, b, 0, 1))];
const opsWorst = ()       => [...PASS.map(([a, b]) => tmn(a, b, 1)),     ...STOP.map(([a, b]) => tmx(a, b, 1))];
const opsBoth  = (pw = 1) => [...opsTGT(pw), ...opsWorst()];

// ── per-λ T via batched WASM spectrum (precomputed nk; == GUI) ───────────────
const _nk = new Map();
const nkOf = (mat, l) => { const k = mat + '@' + l; let v = _nk.get(k); if (v === undefined) { v = resolveMat(mat).getNK(l); _nk.set(k, v); } return v; };
function spectrum(design, lams) {
  const W = getTmmWasm();
  const n0 = lams.map(l => AIR.getNK(l));
  const ns = lams.map(l => nkOf(design.substrate.material, l));
  const layerNK = design.frontLayers.map(L => lams.map(l => nkOf(L.material, l)));
  const thick = design.frontLayers.map(L => L.thickness);
  if (W) return W.tmmSpectrum(lams, n0, ns, layerNK, thick, 0).Ts;
  // (JS fallback omitted — WASM is active)
  throw new Error('WASM not active');
}
// fixed yardstick over a dense in-band grid
const YGRID = [];
for (const [a, b] of PASS) for (let l = a; l <= b + 1e-9; l += 2) YGRID.push({ l, t: 1, p: true });
for (const [a, b] of STOP) for (let l = a; l <= b + 1e-9; l += 2) YGRID.push({ l, t: 0, p: false });
const YLAMS = YGRID.map(g => g.l);
function yardstick(design) {
  const Ts = spectrum(design, YLAMS);
  let pS = 0, pN = 0, sS = 0, sN = 0, pW = 0, sW = 0;
  for (let i = 0; i < YGRID.length; i++) {
    const dev = Ts[i] - YGRID[i].t;
    if (YGRID[i].p) { pS += dev * dev; pN++; pW = Math.max(pW, Math.abs(dev)); }
    else            { sS += dev * dev; sN++; sW = Math.max(sW, Math.abs(dev)); }
  }
  return { passRMS: Math.sqrt(pS / pN), stopRMS: Math.sqrt(sS / sN), passWorst: pW, stopWorst: sW, overallRMS: Math.sqrt((pS + sS) / (pN + sN)) };
}
function writeSpectrum(tag, design) {
  const lams = []; for (let l = 400; l <= 815; l++) lams.push(l);
  const Ts = spectrum(design, lams);
  const rows = ['lam_nm,T']; for (let i = 0; i < lams.length; i++) rows.push(`${lams[i]},${Ts[i].toFixed(6)}`);
  writeFileSync(`tests/out/merit_${tag}.csv`, rows.join('\n'));
}

// ── real-optimizer refine (CG, analytic, WASM); keep N fixed (no prune) ─────
const mkDesign = layers => ({ incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 }, frontLayers: layers, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side' });
function refine(design, operands, iters = 400) {
  const opt = makeEngine('cg', operands, design, resolveMat, { dMin: DMIN });
  let it = 0; while (it < iters && !opt.isConverged()) { opt.step(); it++; }
  return { design: opt.applyToDesign(design), iters: it };
}
function qwot(N, lam0) {
  const nH = 2.5, nL = 1.46, layers = [];
  for (let i = 0; i < N; i++) { const H = i % 2 === 0; layers.push({ id: 'L' + i, material: H ? 'TiO2' : 'SiO2', thickness: lam0 / (4 * (H ? nH : nL)), locked: false }); }
  return mkDesign(layers);
}
function loadTfs(p) { const j = JSON.parse(readFileSync(p, 'utf8')); return mkDesign((j.frontLayers || []).map(L => ({ ...L, material: L.material.includes(':') ? L.material.split(':').pop() : L.material }))); }

// ── run ──────────────────────────────────────────────────────────────────────
mkdirSync('tests/out', { recursive: true });
const ok = await initWasmForTest();
console.log(`WASM active: ${ok} (tmmWasmActive=${tmmWasmActive()})\n`);

const arg = process.argv[2];
let D;
if (arg) { console.log(`D = ${arg}`); D = loadTfs(arg); }
else {
  console.log('D = best L2-refined QWOT N=40 over λ0∈{450,550,650,730} (a realistic rippled stall)…');
  let best = null;
  for (const l0 of [450, 550, 650, 730]) {
    const r = refine(qwot(40, l0), opsTGT(1), 500);
    const y = yardstick(r.design);
    if (!best || y.overallRMS < best.y.overallRMS) best = { design: r.design, y, l0 };
  }
  D = best.design;
  console.log(`  best start λ0=${best.l0}`);
}
const N = D.frontLayers.length;
writeSpectrum('D', D);
const yD = yardstick(D);
console.log(`\nD (N=${N}): passWorst=${yD.passWorst.toFixed(4)} passRMS=${yD.passRMS.toFixed(4)} stopRMS=${yD.stopRMS.toFixed(4)} overallRMS=${yD.overallRMS.toFixed(4)}\n`);

const VARIANTS = [
  { tag: 'L2',        ops: opsTGT(1)  },   // control
  { tag: 'L2_w10',    ops: opsTGT(10) },   // spatial emphasis (passband ×10)
  { tag: 'worstcase', ops: opsWorst() },   // minmax only = P→∞ emphasis
  { tag: 'L2+worst',  ops: opsBoth(1) },   // L2 + worst-case
];
console.log('Re-refine D under each merit (real CG optimizer + WASM), scored on FIXED L2 yardstick:\n');
console.log('variant     passWorst  passRMS  stopRMS  overallRMS   vs D');
for (const v of VARIANTS) {
  const t0 = now();
  const r = refine(D, v.ops, 500);
  const y = yardstick(r.design);
  writeSpectrum(v.tag, r.design);
  const m = y.passWorst < yD.passWorst * 0.95 ? 'passWorst ↓' : y.passWorst > yD.passWorst * 1.05 ? 'passWorst ↑' : 'passWorst =';
  console.log(`${v.tag.padEnd(10)}  ${y.passWorst.toFixed(4)}     ${y.passRMS.toFixed(4)}   ${y.stopRMS.toFixed(4)}   ${y.overallRMS.toFixed(4)}   ${m}  (${r.iters} it, ${((now()-t0)/1000).toFixed(1)}s)`);
}
console.log('\nSpectra → tests/out/merit_{D,L2,L2_w10,worstcase,L2+worst}.csv  (lam_nm,T 400–815).');
console.log('Hypothesis SUPPORTED if worstcase / L2+worst give lower passWorst than L2 (worst-case emphasis cleans ripple L2 leaves).');
