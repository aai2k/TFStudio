/**
 * Global-Refinement engine tests.
 *
 * Validates the gradient-free global engines (Differential Evolution, Simulated
 * Annealing) and the gradient-based Conjugate Gradient engine that share the
 * DLSOptimizer-compatible interface. All are REFINEMENT methods: they optimize
 * the thickness vector of a fixed stack and never change the layer count.
 *
 * Checks:
 *   1. mfAt(x0) === DLSOptimizer.mf            (engines minimize the same MF)
 *   2. gradMF analytic === central differences  (O(h²); exact gradient)
 *   3. DE / SA / CG each lower the MF from a detuned BBAR start
 *   4. Bounds [D_MIN,D_MAX] and locked layers are respected
 *   5. DE with a fixed seed is deterministic (reproducible)
 *   6. CG reaches an optimum comparable to DLS on a smooth problem
 *
 * Run: node tests/global_optimizers.mjs
 */

import { DLSOptimizer, makeOperand, calcMF, evaluateOperands, buildEvalContext } from '../src/utils/physics/optimizer.js';
import { makeEngine, DEOptimizer, SAOptimizer, CGOptimizer } from '../src/utils/optimizers/index.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ok:', msg); } };
const resolveMat = id => getMaterial(id);

// A 4-layer BBAR-ish stack on BK7, deliberately detuned so there is room to
// improve. front_only, RAV→0 across 450–650 nm.
function makeDesign(thicks = [80, 140, 60, 120]) {
    return {
        incidentMedium: 'Air',
        exitMedium:     'Air',
        substrate:      { material: 'BK7', thickness: 1.0 },
        frontLayers: [
            { id: 'F1', material: 'TiO2', thickness: thicks[0], locked: false },
            { id: 'F2', material: 'SiO2', thickness: thicks[1], locked: false },
            { id: 'F3', material: 'TiO2', thickness: thicks[2], locked: false },
            { id: 'F4', material: 'SiO2', thickness: thicks[3], locked: false },
        ],
        backLayers: [],
        surfaceMode: 'front_only',
        mfEvalMode:  'side',
    };
}
const makeOps = () => [
    makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
];

function runEngine(engine, maxIter) {
    for (let i = 0; i < maxIter && !engine.isConverged(); i++) engine.step();
    return engine;
}

console.log('\n=== 1. mfAt consistency ===');
{
    const ops = makeOps(), des = makeDesign();
    const dls = new DLSOptimizer(ops, des, resolveMat);
    const eng = makeEngine('de', ops, des, resolveMat, { seed: 1 });
    ok(Math.abs(eng.mfAt(dls.thicknesses) - dls.mf) < 1e-12, `mfAt(x0)=${eng.mfAt(dls.thicknesses).toFixed(8)} == DLS.mf=${dls.mf.toFixed(8)}`);
}

console.log('\n=== 2. analytic gradMF == central differences ===');
{
    const ops = makeOps(), des = makeDesign();
    const dls = new DLSOptimizer(ops, des, resolveMat);
    const x = dls.thicknesses.slice();
    const gA = dls.gradMF(x);
    const h = 1e-3;
    let maxRel = 0;
    for (let j = 0; j < x.length; j++) {
        const xp = x.slice(); xp[j] += h;
        const xm = x.slice(); xm[j] -= h;
        const gFD = (dls.mfAt(xp) - dls.mfAt(xm)) / (2 * h);
        const denom = Math.max(1e-9, Math.abs(gFD));
        maxRel = Math.max(maxRel, Math.abs(gA[j] - gFD) / denom);
    }
    ok(maxRel < 1e-4, `analytic vs FD gradient max rel err = ${maxRel.toExponential(2)} (< 1e-4)`);
}

console.log('\n=== 3. each engine lowers the MF ===');
{
    const ops = makeOps(), des = makeDesign();
    const mf0 = new DLSOptimizer(ops, des, resolveMat).mf;
    for (const m of ['de', 'sa', 'cg']) {
        const eng = runEngine(makeEngine(m, ops, des, resolveMat, { seed: 7, maxIter: 300 }), 300);
        ok(eng.mfBest < mf0, `${m.toUpperCase()}: mfBest=${eng.mfBest.toFixed(6)} < mf0=${mf0.toFixed(6)} (iters=${eng.iter})`);
        ok(eng.mfBest <= eng.mfAt(des.frontLayers.map(l => l.thickness)) + 1e-12, `${m.toUpperCase()}: best never worse than start`);
    }
}

console.log('\n=== 4. bounds + locked layers respected ===');
{
    const ops = makeOps();
    const des = makeDesign();
    des.frontLayers[1].locked = true;             // lock layer 2 (SiO2 140 nm)
    const lockedVal = des.frontLayers[1].thickness;
    for (const m of ['de', 'sa', 'cg']) {
        const eng = runEngine(makeEngine(m, ops, des, resolveMat, { seed: 3, maxIter: 120, dMin: 1, dMax: 2000 }), 120);
        const best = eng.thickBest;
        let inBounds = true, lockHeld = true;
        for (let i = 0; i < best.length; i++) {
            if (best[i] < eng.D_MIN - 1e-9 || best[i] > eng.D_MAX + 1e-9) inBounds = false;
        }
        if (Math.abs(best[1] - lockedVal) > 1e-9) lockHeld = false;
        ok(inBounds, `${m.toUpperCase()}: all thicknesses within [${eng.D_MIN}, ${eng.D_MAX}]`);
        ok(lockHeld, `${m.toUpperCase()}: locked layer held at ${lockedVal} (got ${best[1].toFixed(4)})`);
    }
}

console.log('\n=== 5. DE determinism (same seed) ===');
{
    const ops = makeOps(), des = makeDesign();
    const a = runEngine(new DEOptimizer(ops, des, resolveMat, { seed: 42, maxIter: 60 }), 60);
    const b = runEngine(new DEOptimizer(ops, des, resolveMat, { seed: 42, maxIter: 60 }), 60);
    ok(Math.abs(a.mfBest - b.mfBest) < 1e-15, `seed=42 reproducible: ${a.mfBest.toFixed(10)} == ${b.mfBest.toFixed(10)}`);
}

console.log('\n=== 6. CG vs DLS optimum (smooth problem) ===');
{
    const ops = makeOps(), des = makeDesign();
    const dls = new DLSOptimizer(ops, des, resolveMat);
    for (let i = 0; i < 200 && !dls.isConverged(); i++) dls.step();
    const cg = runEngine(new CGOptimizer(ops, des, resolveMat, { maxIter: 400 }), 400);
    // CG is a different method; require it gets within a modest factor of DLS.
    ok(cg.mfBest < dls.mfBest * 3 + 1e-6, `CG mfBest=${cg.mfBest.toFixed(6)} comparable to DLS=${dls.mfBest.toFixed(6)}`);
}

console.log('\n=== 7. applyToDesign writes engine thicknesses ===');
{
    const ops = makeOps(), des = makeDesign();
    const eng = runEngine(makeEngine('de', ops, des, resolveMat, { seed: 5, maxIter: 40 }), 40);
    eng.restoreBest();
    const out = eng.applyToDesign(des);
    const written = out.frontLayers.map(l => l.thickness);
    let match = true;
    for (let i = 0; i < written.length; i++) if (Math.abs(written[i] - eng.thicknesses[i]) > 1e-12) match = false;
    ok(match, 'applyToDesign front thicknesses == engine.thicknesses');
    // and the MF of the written design equals engine.mf
    const ctx = buildEvalContext(out, resolveMat);
    const mfOut = calcMF(ops, evaluateOperands(ops, ctx));
    ok(Math.abs(mfOut - eng.mf) < 1e-9, `written-design MF=${mfOut.toFixed(8)} == engine.mf=${eng.mf.toFixed(8)}`);
}

console.log('\n=== 8. parallel DE == serial DE (chunked eval, bit-identical) ===');
{
    // The window's parallel path = produceTrials() → fan eval across K workers →
    // ingestTrials(). Simulate the pool by chunking the evaluations and running
    // them serially; because all RNG stays in produceTrials and mfAt is a pure
    // function of the vector, the result MUST equal serial step() exactly.
    const ops = makeOps(), des = makeDesign();
    const serial   = new DEOptimizer(ops, des, resolveMat, { seed: 99, maxIter: 40 });
    const parallel = new DEOptimizer(ops, des, resolveMat, { seed: 99, maxIter: 40 });
    const K = 4;
    let maxThkDiff = 0;
    for (let g = 0; g < 30; g++) {
        serial.step();
        // chunked "parallel" generation
        const trials = parallel.produceTrials();
        const mfs = new Array(trials.length);
        const per = Math.max(1, Math.ceil(trials.length / K));
        for (let s = 0; s < trials.length; s += per) {
            const end = Math.min(trials.length, s + per);
            for (let i = s; i < end; i++) mfs[i] = parallel.mfAt(trials[i]);   // a worker's batch
        }
        parallel.ingestTrials(trials, mfs);
        for (let i = 0; i < serial.thickBest.length; i++)
            maxThkDiff = Math.max(maxThkDiff, Math.abs(serial.thickBest[i] - parallel.thickBest[i]));
    }
    ok(Math.abs(serial.mfBest - parallel.mfBest) < 1e-15, `mfBest identical: ${serial.mfBest.toFixed(12)} == ${parallel.mfBest.toFixed(12)}`);
    ok(maxThkDiff < 1e-12, `thickBest identical: max Δthk = ${maxThkDiff.toExponential(2)}`);
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}\n`);
process.exit(fails === 0 ? 0 : 1);
