/**
 * P3: per-environment operands wired into the ENGINE paths.
 *
 * P2 delivered `EnvironmentSpec.operands`, `buildEnvironmentSpecs` carrying
 * `spec.operands`, `calcMFMultiEnv` using `spec.operands || operands`, and the
 * LSQEngine constructor building `_envOperands`. This test locks the ENGINE
 * paths that still used the shared operand set:
 *
 *   1. gradMF multi-env loop + _gradMFForCtx use per-env operands (oracle #2)
 *   2. step() (LM) optimizes the multi-env MF, not just environment 0 (oracle #1)
 *   3. mfOpticalAt returns the weighted multi-env OMF (oracle #5)
 *   4. analyticScan accumulates per-env operands per environment (oracle #3)
 *   5. mfEvalWorker construction carries per-env operands into _envOperands
 *      and mfAt evaluates with them (oracle #7)
 *
 * Run: node tests/multi_env_engine_per_env.mjs
 */

import { calcMFMultiEnv } from '../src/utils/physics/optimizer/multiEnv.js';
import { getMeritAccumulation, evaluateOperands, calcMF } from '../src/utils/physics/optimizer/evalCore.js';
import { makeOperand } from '../src/utils/physics/optimizer/operandModel.js';
import { LSQEngine, DLSOptimizer } from '../src/utils/physics/optimizer/lsqEngine.js';
import { scanNeedlesAnalytic } from '../src/utils/physics/optimizer/scanners/analyticScan.js';

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };

// Simple material resolver (avoids DesignContext React dependency)
function simpleResolveMat(name) {
    const materials = {
        'Air': 1.0, 'Water': 1.33, 'BK7': 1.52,
        'SiO2': 1.46, 'TiO2': 2.4
    };
    const n = materials[name] || 1.5;
    return { getNK: (_lam) => [n, 0] };
}
const resolveMat = simpleResolveMat;

// Per-env RGT operand sets: seawater R≤0.5% @400-700nm, air R≤2% @400-700nm
const rgtSeawater = [
    makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
        aoi: 0, pol: 'avg', target: 0.005, weight: 1.0 })
];
const rgtAir = [
    makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
        aoi: 0, pol: 'avg', target: 0.02, weight: 1.0 })
];

const baseDesign = {
    id: 'engine-per-env', name: 'EnginePerEnv',
    incidentMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    exitMedium: 'Air',
    surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: [{ id: 'l1', material: 'SiO2', thickness: 100, locked: false }],
    backLayers: [], referenceWavelength: 550, notes: '',
    meritEnvironments: []
};

// Two environments: seawater (R≤0.5%) and air (R≤2%), both weight 1.
const design2Env = {
    ...baseDesign,
    meritEnvironments: [
        { id: 'seawater', incidentMedium: 'Water', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtSeawater },
        { id: 'air', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtAir }
    ]
};

// Correct multi-env MF at thk using per-env operands (the reference).
function mfAtCorrect(engine, thk) {
    const specs = engine._envCtxs.map((ctx, i) => ({
        ctx: engine._envCtxFor(thk, ctx),
        weight: engine._envWeights[i],
        index: i,
        operands: engine._envOperands[i]
    }));
    return calcMFMultiEnv(specs, engine.operands, { getMeritAccumulation }).mf;
}

console.log('=== Test 1: gradMF uses per-env operands (oracle #2) ===');
{
    const engine = new LSQEngine(rgtAir, design2Env, resolveMat,
        { environments: design2Env.meritEnvironments });
    const thk = engine.thicknesses;
    const grad = engine.gradMF(thk);
    const free = thk.map((_, i) => i).filter(i => !engine.lockedMask[i]);

    // Reference: weighted sum of per-env FD gradients (each env with its OWN
    // operands), normalized exactly as the engine does:
    //   g = Σ_e W_e·∇MF_e / (2·MF_total·D_total)
    const specs = engine._envCtxs.map((ctx, i) => ({
        ctx: engine._envCtxFor(thk, ctx),
        weight: engine._envWeights[i],
        index: i,
        operands: engine._envOperands[i]
    }));
    const { mf: mfTotal } = calcMFMultiEnv(specs, rgtAir, { getMeritAccumulation });
    let totalSumWopt = 0, totalSumWcon = 0;
    for (const spec of specs) {
        const { sumWopt, sumWcon } =
            getMeritAccumulation(spec.operands, evaluateOperands(spec.operands, spec.ctx), false);
        totalSumWopt += spec.weight * sumWopt;
        totalSumWcon += spec.weight * sumWcon;
    }
    const denom = totalSumWopt > 0 ? totalSumWopt : totalSumWcon;

    const expected = new Array(thk.length).fill(0);
    for (const spec of specs) {
        const envCtx = spec.ctx;
        const ops = spec.operands;
        for (let ci = 0; ci < free.length; ci++) {
            const k = free[ci];
            const hk = Math.max(engine.h, Math.abs(thk[k]) * 1e-4);
            const thkP = thk.slice(); thkP[k] = Math.min(thk[k] + hk, engine.D_MAX);
            const thkM = thk.slice(); thkM[k] = Math.max(thk[k] - hk, engine.D_MIN);
            const dh = thkP[k] - thkM[k];
            if (dh <= 0) continue;
            const mfP = calcMF(ops, evaluateOperands(ops, engine._envCtxFor(thkP, envCtx)));
            const mfM = calcMF(ops, evaluateOperands(ops, engine._envCtxFor(thkM, envCtx)));
            expected[k] += spec.weight * (mfP - mfM) / dh;
        }
    }
    const scale = 1.0 / (2.0 * mfTotal * denom);
    for (let ci = 0; ci < free.length; ci++) expected[free[ci]] *= scale;

    let maxDiff = 0;
    for (let ci = 0; ci < free.length; ci++) {
        maxDiff = Math.max(maxDiff, Math.abs(grad[free[ci]] - expected[free[ci]]));
    }
    ok(maxDiff < 1e-6,
        `gradMF should match per-env FD weighted sum (maxDiff=${maxDiff.toExponential(3)})`);
    console.log(`  gradMF vs per-env FD reference: maxDiff=${maxDiff.toExponential(3)} PASS`);
}

console.log('\n=== Test 2: step() (LM) optimizes the multi-env MF (oracle #1) ===');
{
    // Conflicting envs: env1 wants R@450→0 (w=1), env2 wants R@650→0 (w=10).
    // Optimizing env 1 alone moves toward t≈77nm and RAISES the multi-env MF;
    // the multi-env step must balance both and lower it.
    const r450 = [makeOperand({ type: 'R', lambdaStart: 450, lambdaEnd: 450,
        aoi: 0, pol: 'avg', target: 0, weight: 1.0 })];
    const r650 = [makeOperand({ type: 'R', lambdaStart: 650, lambdaEnd: 650,
        aoi: 0, pol: 'avg', target: 0, weight: 1.0 })];
    const designConflict = {
        ...baseDesign,
        meritEnvironments: [
            { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: r450 },
            { id: 'e2', incidentMedium: 'Air', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 10.0,
                operands: r650 }
        ]
    };
    const engine = new LSQEngine(r450, designConflict, resolveMat,
        { environments: designConflict.meritEnvironments });
    const mf0 = mfAtCorrect(engine, engine.thicknesses);
    for (let i = 0; i < 15; i++) engine.step();
    const mf1 = mfAtCorrect(engine, engine.thicknesses);
    ok(mf1 < mf0,
        `step() should decrease the multi-env MF: ${mf0.toFixed(6)} -> ${mf1.toFixed(6)}`);
    console.log(`  multi-env MF: ${mf0.toFixed(6)} -> ${mf1.toFixed(6)} PASS`);
}

console.log('\n=== Test 3: mfOpticalAt returns weighted multi-env OMF (oracle #5) ===');
{
    const engine = new LSQEngine(rgtAir, design2Env, resolveMat,
        { environments: design2Env.meritEnvironments });
    const thk = engine.thicknesses;
    const omf = engine.mfOpticalAt(thk);
    const specs = engine._envCtxs.map((ctx, i) => ({
        ctx: engine._envCtxFor(thk, ctx),
        weight: engine._envWeights[i],
        index: i,
        operands: engine._envOperands[i]
    }));
    const omfRef = calcMFMultiEnv(specs, rgtAir, { skipConstraints: true, getMeritAccumulation }).mf;
    ok(Math.abs(omf - omfRef) < 1e-9,
        `mfOpticalAt should be the weighted multi-env OMF: ${omf} vs ${omfRef}`);
    console.log(`  mfOpticalAt: ${omf.toFixed(8)} == reference ${omfRef.toFixed(8)} PASS`);
}

console.log('\n=== Test 4: analyticScan uses per-env operands (oracle #3) ===');
{
    const candidateMats = [
        { id: 'SiO2', name: 'SiO2', mat: resolveMat('SiO2') },
        { id: 'TiO2', name: 'TiO2', mat: resolveMat('TiO2') }
    ];
    // Scan A: env2 carries rgtAir; Scan B: env2 carries rgtSeawater.
    // With per-env operands wired, the two scans must differ.
    const designB = {
        ...baseDesign,
        meritEnvironments: [
            { id: 'seawater', incidentMedium: 'Water', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtSeawater },
            { id: 'air', incidentMedium: 'Air', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtSeawater }
        ]
    };
    const scanA = scanNeedlesAnalytic({ operands: rgtAir, design: design2Env, resolveMat, candidateMats, deltaNm: 0.5 });
    const scanB = scanNeedlesAnalytic({ operands: rgtAir, design: designB, resolveMat, candidateMats, deltaNm: 0.5 });
    ok(scanA && scanB, 'both scans should run');
    if (scanA && scanB) {
        const dA = scanA.candidates.map(c => c.dMF);
        const dB = scanB.candidates.map(c => c.dMF);
        const differs = dA.some((v, i) => Math.abs(v - dB[i]) > 1e-12);
        ok(differs, 'candidate dMF should reflect per-env operands (scanA != scanB)');
        const bestA = scanA.candidates.reduce((b, c) => (c.dMF < b.dMF ? c : b));
        const bestB = scanB.candidates.reduce((b, c) => (c.dMF < b.dMF ? c : b));
        console.log(`  scanA best: pos=${bestA.pos} dMF=${bestA.dMF.toFixed(6)}; scanB best: pos=${bestB.pos} dMF=${bestB.dMF.toFixed(6)}`);
        console.log(`  per-env operands change candidate scores: PASS`);
    }
}

console.log('\n=== Test 5: mfEvalWorker construction carries per-env operands (oracle #7) ===');
{
    // Simulate the worker: DLSOptimizer(job.operands, job.design, resolveMat)
    // with job.design carrying meritEnvironments[i].operands.
    const opt = new DLSOptimizer(rgtAir, design2Env, resolveMat);
    ok(opt._envOperands[0] === rgtSeawater, '_envOperands[0] should be the seawater operand set');
    ok(opt._envOperands[1] === rgtAir, '_envOperands[1] should be the air operand set');
    const thk = opt.thicknesses;
    const mf = opt.mfAt(thk);
    const mfRef = mfAtCorrect(opt, thk);
    ok(Math.abs(mf - mfRef) < 1e-9,
        `mfAt should use per-env operands: ${mf} vs ${mfRef}`);
    console.log(`  _envOperands structure + mfAt per-env: PASS`);
}

console.log('\n=== Summary ===');
console.log(`multi_env_engine_per_env: ${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}`);
process.exit(fails ? 1 : 0);