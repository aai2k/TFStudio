/**
 * Needle-sensitivity cull validation (H1 — safe tail-trim subset).
 *
 * H1's per-scan cull drops the marginal TAIL of a needle scan (needles much
 * weaker than the strongest needle in the same scan), so a 'thorough' (uncapped)
 * synthesis run stops grinding near-zero-gain candidates. It ALWAYS keeps the
 * strongest needle, so it can never stall stack growth.
 *
 * (The more aggressive MF-relative variant that emptied the queue to force a
 * preemptive TOT step was rejected — it froze a thick-seed bandpass at 1 layer
 * because early needles are individually weak vs. the large initial MF. The
 * effective preemptive escape must be stagnation-based.)
 *
 * Asserts:
 *   (1) cull unit behavior: off = identity (bit-identical); light/medium/
 *       aggressive trim the right tail; the strongest needle is always kept.
 *   (2) Headless GE (runSynth, THOROUGH/uncapped): the cull does not worsen the
 *       final optical MF vs. off on real benchmark cases (safety).
 *
 * Run: node tests/needle_sensitivity.mjs
 */
import { cullMarginalNeedles } from '../src/utils/synthesis/synthesisConfig.js';
import { caseById, runSynth, opticalMF } from '../src/utils/benchmark/optimizerBenchmark.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initWasmForTest, tmmWasmActive } from './_wasmInit.mjs';

const resolveMat = (id) => getMaterial(id);
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('FAIL:', name); } };
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(6) : '—');

await initWasmForTest();
console.log(`=== Needle sensitivity (H1, safe tail-trim) · WASM ${tmmWasmActive() ? 'ON' : 'off'} ===\n`);

// ── (1) Unit behavior (relative to the strongest needle, never empties) ───────
{
  const q = [
    { dMF: -1.0,  pos: 0, materialId: 'A' },   // strongest
    { dMF: -0.5,  pos: 1, materialId: 'B' },   // 50%
    { dMF: -0.04, pos: 2, materialId: 'C' },   // 4%
    { dMF: -0.008, pos: 3, materialId: 'D' },  // 0.8%
    { dMF: -0.001, pos: 4, materialId: 'E' },  // 0.1%
  ];
  const ids = (arr) => arr.map(c => c.materialId).join('');

  ok('off (relFloor=0) returns the SAME array reference (bit-identical)', cullMarginalNeedles(q, 0) === q);
  ok('light: drop weaker than 1% of best (B 50%,C 4%,D 0.8%✗,E✗)', ids(cullMarginalNeedles(q, 0.01)) === 'ABC');
  ok('medium: drop weaker than 5% (keep A,B)', ids(cullMarginalNeedles(q, 0.05)) === 'AB');
  ok('aggressive: drop weaker than 15% (keep A,B)', ids(cullMarginalNeedles(q, 0.15)) === 'AB');
  ok('very high floor still keeps the strongest (never empties)', cullMarginalNeedles(q, 0.99).length >= 1);
  ok('single-element queue unchanged', cullMarginalNeedles([q[0]], 0.5).length === 1);
  ok('empty queue safe', cullMarginalNeedles([], 0.5).length === 0);
}

// ── (2) Headless GE in THOROUGH mode: cull must not worsen quality ────────────
const BUDGET = 6000;
const CASES = ['bbar', 'bandpass'];
const FLOORS = [
  { label: 'off',        floor: 0 },
  { label: 'light',      floor: 0.01 },
  { label: 'aggressive', floor: 0.15 },
];

console.log(`  ${'case'.padEnd(10)} ${'sens'.padEnd(11)} ${'MF'.padStart(10)} ${'layers'.padStart(7)} ${'steps'.padStart(6)} ${'time'.padStart(7)}`);
for (const id of CASES) {
  const C = caseById(id);
  const results = {};
  for (const { label, floor } of FLOORS) {
    // Uncapped ('thorough') so the tail is actually reached — that's where the
    // cull does work. maxBatches default would already skip the tail.
    const r = runSynth(true, C.thick(), C.ops, 1, resolveMat,
      { budgetMs: BUDGET, engine: 'cg', needleSensFloor: floor });
    const mf = opticalMF(r.design, C.ops, resolveMat);
    results[label] = { ...r, mfOpt: mf };
    console.log(`  ${id.padEnd(10)} ${label.padEnd(11)} ${fmt(mf).padStart(10)} ${String(r.layers).padStart(7)} ${String(r.steps).padStart(6)} ${(`${(r.ms/1000).toFixed(1)}s`).padStart(7)}`);
  }
  const off = results.off.mfOpt;
  for (const lab of ['light', 'aggressive']) {
    const on = results[lab].mfOpt;
    ok(`${id}/${lab}: optical MF not worse than off (${fmt(on)} ≤ ${fmt(off)}·1.10+3e-3)`,
       Number.isFinite(on) && on <= off * 1.10 + 3e-3);
    ok(`${id}/${lab}: grew a real multilayer (≥3 layers, growth not stalled)`, results[lab].layers >= 3);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
