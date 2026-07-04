/**
 * Self-contained regression test for the smart-seed generator
 * (src/utils/synthesis/seedGenerator.js) and the merit-aware consolidation pass
 * (src/utils/physics/optimizer/consolidate.js).
 *
 * Uses BUILTIN materials only (no Documents dependency) so it runs in the fast
 * suite. Target: a broadband AR (R→0, 450–650 nm) on BK7 with a low/med/high
 * pool (MgF2 / Al2O3 / TiO2).
 *
 * Asserts:
 *   1. classifyPoolByIndex assigns low/med/high by n(λ0).
 *   2. generateARSeeds emits the canonical QHQ template (¼λ low, ½λ high, ¼λ med)
 *      with quarter/half-wave thicknesses, and rankSeeds beats the 1-layer seed.
 *   3. removeRedundantLayers strips an injected redundant layer without worsening
 *      MF beyond tol, and is a no-op on a design with nothing to remove.
 *
 * Run:  node tests/seed_consolidate.mjs
 */
import { initWasmForTest } from './_wasmInit.mjs';
import { makeOperand, cleanupLayers, removeRedundantLayers } from '../src/utils/physics/optimizer.js';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { classifyPoolByIndex, generateARSeeds, rankSeeds } from '../src/utils/synthesis/seedGenerator.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const resolveMat = (id) => getMaterial(id === 'Air' || !id ? 'Air' : id);
const deep = (x) => JSON.parse(JSON.stringify(x));

await initWasmForTest();

const LAM0 = 550;
const baseDesign = {
  incidentMedium: 'Air', exitMedium: 'Air',
  substrate: { material: 'BK7', thickness: 1 },
  surfaceMode: 'front_only', mfEvalMode: 'side',
  frontLayers: [], backLayers: [], referenceWavelength: LAM0,
};
const operands = [
  makeOperand({ type: 'RGT', enabled: true, lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 }),
  makeOperand({ type: 'TGT', enabled: true, lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, targetEnd: 1, weight: 1 }),
];
const pool = ['MgF2', 'Al2O3', 'TiO2'].map(id => ({ id, name: id, mat: resolveMat(id) }));
const DMIN = 10;

function refine(design, maxIter = 200) {
  const opt = makeEngine('dls', operands, design, resolveMat, { dMin: DMIN });
  while (!(opt.isConverged() || opt.iter >= maxIter)) opt.step();
  return { mf: opt.mf, design: { ...opt.applyToDesign(design),
    frontLayers: cleanupLayers(opt.applyToDesign(design).frontLayers || [], DMIN) } };
}

// ── 1. classification ─────────────────────────────────────────────────────────
console.log('\n1. classifyPoolByIndex');
const roles = classifyPoolByIndex(pool, LAM0);
ok(roles.low?.id === 'MgF2',  `low = MgF2 (got ${roles.low?.id}, n=${roles.low?.n.toFixed(3)})`);
ok(roles.high?.id === 'TiO2', `high = TiO2 (got ${roles.high?.id}, n=${roles.high?.n.toFixed(3)})`);
ok(roles.med?.id === 'Al2O3', `med = Al2O3 (got ${roles.med?.id})`);

// ── 2. seed generation + ranking ───────────────────────────────────────────────
console.log('\n2. generateARSeeds + rankSeeds');
const seeds = generateARSeeds({ pool, lambda0: LAM0, baseDesign, maxLayers: 6 });
const qhq = seeds.find(s => s.key === 'L1_H2_M1');
ok(!!qhq, 'QHQ template (L¼ H½ M¼) emitted');
if (qhq) {
  const [l0, l1, l2] = qhq.frontLayers;
  const nLow = roles.low.n, nHigh = roles.high.n, nMed = roles.med.n;
  ok(near(l0.thickness, LAM0 / (4 * nLow), 0.5),  `QHQ layer0 = ¼λ MgF2 (${l0.thickness.toFixed(1)} nm)`);
  ok(near(l1.thickness, LAM0 / (2 * nHigh), 0.5), `QHQ layer1 = ½λ TiO2 (${l1.thickness.toFixed(1)} nm)`);
  ok(near(l2.thickness, LAM0 / (4 * nMed), 0.5),  `QHQ layer2 = ¼λ Al2O3 (${l2.thickness.toFixed(1)} nm)`);
}
const { best, ranked } = rankSeeds(seeds, (d) => refine(d, 200));
const oneLayer = ranked.find(s => s.key === 'L1');
console.log('   ranked:', ranked.map(s => `${s.key}=${s.mf.toFixed(5)}`).join(' '));
ok(best && best.mf < (oneLayer?.mf ?? Infinity) - 1e-6, `best seed (${best?.key}, MF ${best?.mf.toFixed(5)}) beats 1-layer (${oneLayer?.mf.toFixed(5)})`);
ok(best && best.mf < 0.01, `best seed reaches a good AR (MF ${best?.mf.toFixed(5)} < 0.01)`);

// ── 3. consolidation ────────────────────────────────────────────────────────────
console.log('\n3. removeRedundantLayers');
const refineFn = (d) => refine(d, 120);
// 3a. inject a redundant layer into the refined best seed, then consolidate.
const baseRef = refine(best.refinedDesign, 200);
const injected = deep(baseRef.design);
injected.frontLayers = [
  { id: 'inj', material: 'TiO2', thickness: 30, locked: false },
  ...baseRef.design.frontLayers,
];
const resInj = removeRedundantLayers({ design: injected, side: 'front', dMin: DMIN, tol: 0.10, minLayers: 1, maxIter: 120, refineFn });
console.log(`   injected ${injected.frontLayers.length}L (MF ${refine(injected,120).mf.toFixed(5)}) → ${resInj.design.frontLayers.length}L (MF ${resInj.mf.toFixed(5)}), removed=${resInj.removed}`);
ok(resInj.removed >= 1, `removed the injected redundant layer (removed=${resInj.removed})`);
ok(resInj.design.frontLayers.length < injected.frontLayers.length, 'layer count decreased');
ok(resInj.mf <= resInj.baseMf * 1.10 + 1e-9, `MF not worsened beyond tol (${resInj.mf.toFixed(5)} ≤ ${(resInj.baseMf*1.10).toFixed(5)})`);

// 3b. no-op on a clean minimal design (single layer).
const clean = { ...baseDesign, frontLayers: [{ id: 's', material: 'MgF2', thickness: LAM0/(4*roles.low.n), locked: false }] };
const resClean = removeRedundantLayers({ design: clean, side: 'front', dMin: DMIN, tol: 0.0, minLayers: 1, maxIter: 120, refineFn });
ok(resClean.removed === 0, `no removal on a 1-layer design (removed=${resClean.removed})`);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
