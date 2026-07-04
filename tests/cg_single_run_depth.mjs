/**
 * CG premature-stall regression (user 2026-06-03):
 *   Before the auto-restart fix, a single CG run quit after 3 trapped
 *   line-search probes (`_stall>=3`), so the user had to relaunch CG ~5×
 *   by hand to keep improving — each relaunch discarded the collapsed
 *   warm-start step `_alpha` and the stale conjugate direction `_dir`.
 *
 * This test reproduces the manual workflow: run CG ONCE to its own
 * convergence, then RE-LAUNCH it from its own result up to 5 more times
 * (exactly what the user did in the GUI). The fix is good iff the first
 * run already lands essentially where the re-launches do — i.e. a single
 * run no longer stops short.
 *
 * Run: node tests/cg_single_run_depth.mjs
 */
import { makeEngine } from '../src/utils/optimizers/index.js';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else console.log('  ok:', msg); };
const resolveMat = id => getMaterial(id);

// A detuned 6-layer BBAR-ish stack on BK7 — enough variables for CG's
// conjugate directions to get ill-conditioned (where the old stall bit),
// but a smooth RAV→0 target with a genuine minimum it can actually reach.
function makeDesign() {
    const mats = ['TiO2', 'SiO2'];
    const start = [70, 130, 55, 110, 80, 120];   // detuned, off the optimum
    return {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: start.map((thk, i) => ({ id: `F${i}`, material: mats[i % 2], thickness: thk, locked: false })),
        backLayers: [],
        surfaceMode: 'front_only', mfEvalMode: 'side',
    };
}
const ops = () => [ makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }) ];

function runToConv(engine, cap = 400) {
    let n = 0;
    while (!engine.isConverged() && n < cap) { engine.step(); n++; }
    engine.restoreBest();
    return { mf: engine.mfBest, iters: n, thick: engine.thickBest.slice() };
}

console.log('\n=== CG: single run vs manual re-launch chain ===');
const des = makeDesign();

// 1) ONE CG run to its own convergence.
const first = runToConv(makeEngine('cg', ops(), des, resolveMat, { maxIter: 400, persistent: true }));
console.log(`  single run: mf=${first.mf.toFixed(6)} in ${first.iters} iters`);

// 2) Mimic the user: re-launch CG from the previous result up to 5×.
let cur = first.thick, best = first.mf, totalRelaunchIters = 0;
for (let r = 0; r < 5; r++) {
    const d2 = makeDesign();
    d2.frontLayers.forEach((l, i) => { l.thickness = cur[i]; });
    const res = runToConv(makeEngine('cg', ops(), d2, resolveMat, { maxIter: 400, persistent: true }));
    totalRelaunchIters += res.iters;
    cur = res.thick;
    best = Math.min(best, res.mf);
}
console.log(`  after 5 re-launches: mf=${best.toFixed(6)} (+${totalRelaunchIters} iters)`);

// The fix: the single run should already be within a hair of the
// re-launch-chain optimum (tiny slack for line-search noise).
const rel = (first.mf - best) / Math.max(1e-9, best);
ok(rel < 0.05, `single-run MF within 5% of re-launch optimum (rel gap = ${(rel * 100).toFixed(2)}%)`);
ok(first.iters > 6, `single run used a real iteration budget, not an early stall (iters=${first.iters})`);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}\n`);
process.exit(fails === 0 ? 0 : 1);
