/**
 * Newton vs CG/DLS PERFORMANCE probe on a large (~50-layer) design.
 *
 * Newton refinement on a 50-layer multipassband is so
 * slow per iteration that it shows no wall-clock win over CG. This quantifies it
 * and locates the cost (dense O(N²) Hessian assembly + O(N³) solve, pure-JS, no
 * WASM) so we can decide the fix (endgame-only / matrix-free Truncated Newton).
 *
 * Pure-JS TMM (no WASM) — in the GUI CG/DLS use the WASM Jacobian while the
 * Hessian is JS-only, so the real gap is WORSE than measured here.
 *
 * Run: node tests/newton_perf.mjs
 */
import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);
const deep = x => JSON.parse(JSON.stringify(x));
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;

// 50-layer alternating TiO2/SiO2, ~QWOT@550 perturbed — a realistic big stack.
const N = 50;
const frontLayers = Array.from({ length: N }, (_, i) => {
  const hi = i % 2 === 0;
  const qwot = (550 / (4 * (hi ? 2.35 : 1.46)));   // nm
  const d = qwot * (1 + 0.12 * Math.sin(i * 1.3));
  return { id: 'L' + i, material: hi ? 'TiO2' : 'SiO2', thickness: d, locked: false };
});
const design = {
  incidentMedium: 'Air', exitMedium: 'Air',
  substrate: { material: 'BK7', thickness: 1.0 },
  frontLayers, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
};
// 3-line multipassband TAV target.
const operands = [
  makeOperand({ type: 'TAV', lambdaStart: 445, lambdaEnd: 455, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
  makeOperand({ type: 'TAV', lambdaStart: 505, lambdaEnd: 515, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
  makeOperand({ type: 'TAV', lambdaStart: 635, lambdaEnd: 645, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
  makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 440, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
  makeOperand({ type: 'TAV', lambdaStart: 460, lambdaEnd: 500, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
  makeOperand({ type: 'TAV', lambdaStart: 520, lambdaEnd: 630, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
  makeOperand({ type: 'TAV', lambdaStart: 650, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
];

console.log(`=== Newton vs CG/DLS perf — ${N}-layer multipassband (pure-JS TMM) ===`);

// (1) Per-step time + MF after a fixed iteration count.
const ITERS = 30;
for (const m of ['cg', 'dls', 'newton', 'newton-cg']) {
  const opt = makeEngine(m, operands, deep(design), resolveMat, { dMin: 1 });
  const mf0 = opt.mf;
  const t0 = now();
  let it = 0;
  for (; it < ITERS && !opt.isConverged(); it++) opt.step();
  const dt = now() - t0;
  console.log(`${m.padEnd(7)}  ${it} steps  ${dt.toFixed(0).padStart(6)} ms  (${(dt / Math.max(it,1)).toFixed(1)} ms/step)  MF ${mf0.toFixed(5)}→${opt.mf.toFixed(5)}`);
}

// (2) MF reached in a fixed WALL-CLOCK budget (the metric that matters).
console.log('\n--- MF reached in a fixed 4s wall-clock budget ---');
const BUDGET = 4000;
for (const m of ['cg', 'dls', 'newton', 'newton-cg']) {
  const opt = makeEngine(m, operands, deep(design), resolveMat, { dMin: 1 });
  const t0 = now(); let it = 0;
  while (now() - t0 < BUDGET && !opt.isConverged()) { opt.step(); it++; }
  console.log(`${m.padEnd(7)}  ${String(it).padStart(5)} steps in budget  → MF ${opt.mf.toFixed(6)}`);
}

// (3) Where does a Newton step spend time? assembly vs solve.
console.log('\n--- Newton step cost breakdown ---');
{
  const opt = new DLSOptimizer(operands, deep(design), resolveMat, { dMin: 1 });
  const thk = opt.thicknesses;
  const freeIdx = thk.map((_, i) => i).filter(i => !opt.lockedMask[i]);
  const R = 5;
  let tSys = 0;
  for (let r = 0; r < R; r++) { const a = now(); opt._newtonSystem(thk, freeIdx); tSys += now() - a; }
  // one analytic gradient eval for comparison (the matrix-free building block)
  let tGrad = 0;
  for (let r = 0; r < R; r++) { const a = now(); opt.gradMF(thk, freeIdx); tGrad += now() - a; }
  console.log(`_newtonSystem (assemble H, ${freeIdx.length} free): ${(tSys / R).toFixed(1)} ms`);
  console.log(`gradMF (one analytic gradient, matrix-free unit): ${(tGrad / R).toFixed(2)} ms`);
  console.log(`ratio H-assembly / gradient ≈ ${(tSys / Math.max(tGrad, 1e-6)).toFixed(0)}×  ← a Newton-CG step needs only a few gradients`);
}
