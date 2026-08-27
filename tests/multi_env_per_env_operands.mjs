/**
 * Per-environment independent operands test.
 * Tests: buildEnvironmentSpecs carries env.operands on each spec;
 * calcMFMultiEnv uses per-env operands when present, falls back to the
 * shared operand set when spec.operands is null (backward compatible).
 *
 * Run: node tests/multi_env_per_env_operands.mjs
 */

import { buildEnvironmentSpecs, calcMFMultiEnv } from '../src/utils/physics/optimizer/multiEnv.js';
import { getMeritAccumulation, evaluateOperands, calcMF } from '../src/utils/physics/optimizer/evalCore.js';
import { makeOperand, makeConstraintOperand } from '../src/utils/physics/optimizer/operandModel.js';
import { LSQEngine } from '../src/utils/physics/optimizer/lsqEngine.js';
import { scanNeedlesPFunction } from '../src/utils/physics/optimizer/scanners.js';

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

// Design with a film so RGT evaluates to a non-trivial value
const design = {
    id: 'per-env-operands', name: 'PerEnvOperands',
    incidentMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    exitMedium: 'Air',
    surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: [{ id: 'l1', material: 'SiO2', thickness: 100, locked: false }],
    backLayers: [], referenceWavelength: 550, notes: '',
    meritEnvironments: []
};

// Shared operand set (the fallback when a spec has no per-env operands)
const sharedOperands = [
    makeOperand({ type: 'R', lambdaStart: 550, lambdaEnd: 550,
        aoi: 0, pol: 'avg', target: 0, weight: 1.0 })
];

// Per-env RGT operand sets: 400-700 band, flat target 0 vs 0.1
const rgtTarget0 = [
    makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
        aoi: 0, pol: 'avg', target: 0, weight: 1.0 })
];
const rgtTarget01 = [
    makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
        aoi: 0, pol: 'avg', target: 0.1, weight: 1.0 })
];

console.log('=== Test 1: buildEnvironmentSpecs carries env.operands ===');

// 1a. env with operands → spec.operands equals that array
const designWithOps = {
    ...design,
    meritEnvironments: [
        { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtTarget0 },
        { id: 'e2', incidentMedium: 'Water', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtTarget01 }
    ]
};
const specsWithOps = buildEnvironmentSpecs(designWithOps, resolveMat);
ok(specsWithOps.length === 2, '2 envs should produce 2 specs');
ok(specsWithOps[0].operands === rgtTarget0, 'spec[0].operands should be the env operands array');
ok(specsWithOps[1].operands === rgtTarget01, 'spec[1].operands should be the env operands array');
console.log('  1a. env operands carried onto specs: PASS');

// 1b. env without operands → spec.operands === null
const designMixed = {
    ...design,
    meritEnvironments: [
        { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtTarget0 },
        { id: 'e2', incidentMedium: 'Water', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0 }
    ]
};
const specsMixed = buildEnvironmentSpecs(designMixed, resolveMat);
ok(specsMixed[0].operands === rgtTarget0, 'spec[0].operands should be carried');
ok(specsMixed[1].operands === null, 'spec[1].operands should be null when env has none');
console.log('  1b. missing env operands → null: PASS');

// 1c. no meritEnvironments (single env) → spec.operands === null
const specsSingle = buildEnvironmentSpecs(design, resolveMat);
ok(specsSingle.length === 1, 'no meritEnvironments should produce 1 spec');
ok(specsSingle[0].operands === null, 'single-env spec.operands should be null');
console.log('  1c. single env → null: PASS');

console.log('\n=== Test 2: calcMFMultiEnv uses per-env operands ===');

// 2a. spec.operands present → per-env operands drive the MF.
// Both envs carry RGT target 0 → MF_A; both carry RGT target 0.1 → MF_B.
// Different targets must give different MFs (operands actually take effect).
const specsBoth0 = buildEnvironmentSpecs({
    ...design,
    meritEnvironments: [
        { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtTarget0 },
        { id: 'e2', incidentMedium: 'Water', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtTarget0 }
    ]
}, resolveMat);
const specsBoth01 = buildEnvironmentSpecs({
    ...design,
    meritEnvironments: [
        { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtTarget01 },
        { id: 'e2', incidentMedium: 'Water', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtTarget01 }
    ]
}, resolveMat);
const mfBoth0  = calcMFMultiEnv(specsBoth0, sharedOperands, { getMeritAccumulation }).mf;
const mfBoth01 = calcMFMultiEnv(specsBoth01, sharedOperands, { getMeritAccumulation }).mf;
ok(isFinite(mfBoth0) && isFinite(mfBoth01), 'MFs should be finite');
ok(Math.abs(mfBoth0 - mfBoth01) > 1e-9,
    `Per-env operands should change the MF: ${mfBoth0} vs ${mfBoth01}`);
console.log(`  2a. per-env operands change MF: ${mfBoth0.toFixed(6)} vs ${mfBoth01.toFixed(6)} PASS`);

// 2b. Per-env independence: envs have DIFFERENT media, so swapping the
// operand sets between them must change the weighted MF (proves operands
// are applied per-env, not globally).
const specsSwapA = buildEnvironmentSpecs({
    ...design,
    meritEnvironments: [
        { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtTarget0 },
        { id: 'e2', incidentMedium: 'Water', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtTarget01 }
    ]
}, resolveMat);
const specsSwapB = buildEnvironmentSpecs({
    ...design,
    meritEnvironments: [
        { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtTarget01 },
        { id: 'e2', incidentMedium: 'Water', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
            operands: rgtTarget0 }
    ]
}, resolveMat);
const mfSwapA = calcMFMultiEnv(specsSwapA, sharedOperands, { getMeritAccumulation }).mf;
const mfSwapB = calcMFMultiEnv(specsSwapB, sharedOperands, { getMeritAccumulation }).mf;
ok(Math.abs(mfSwapA - mfSwapB) > 1e-9,
    `Swapping per-env operands should change the MF: ${mfSwapA} vs ${mfSwapB}`);
console.log(`  2b. per-env independence (swap changes MF): ${mfSwapA.toFixed(6)} vs ${mfSwapB.toFixed(6)} PASS`);

// 2c. spec.operands === null → fall back to shared operands.
// Result must equal the same specs with operands explicitly stamped to the
// shared set, and must equal the legacy manual computation.
const specsNull = buildEnvironmentSpecs({
    ...design,
    meritEnvironments: [
        { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0 },
        { id: 'e2', incidentMedium: 'Water', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0 }
    ]
}, resolveMat);
const mfFallback = calcMFMultiEnv(specsNull, sharedOperands, { getMeritAccumulation }).mf;

// Explicit: same specs but operands stamped to the shared set
const specsExplicit = specsNull.map(s => ({ ...s, operands: sharedOperands }));
const mfExplicit = calcMFMultiEnv(specsExplicit, sharedOperands, { getMeritAccumulation }).mf;
ok(Math.abs(mfFallback - mfExplicit) < 1e-12,
    `Null-operands fallback should equal explicit shared operands: ${mfFallback} vs ${mfExplicit}`);
console.log(`  2c. null fallback == explicit shared operands: ${mfFallback.toFixed(6)} PASS`);

// 2d. Backward compat: null-operands result equals the legacy manual
// computation (shared operands evaluated per spec ctx).
let totalSumWRes2 = 0, totalSumWopt = 0, totalSumWcon = 0;
for (const spec of specsNull) {
    const values = evaluateOperands(sharedOperands, spec.ctx);
    const { sumWRes2, sumWopt, sumWcon } = getMeritAccumulation(sharedOperands, values, false);
    totalSumWRes2 += spec.weight * sumWRes2;
    totalSumWopt  += spec.weight * sumWopt;
    totalSumWcon  += spec.weight * sumWcon;
}
const denom = totalSumWopt > 0 ? totalSumWopt : totalSumWcon;
const legacyMf = denom > 0 ? Math.sqrt(totalSumWRes2 / denom) : 0;
ok(Math.abs(mfFallback - legacyMf) < 1e-12,
    `Null-operands result should match legacy computation: ${mfFallback} vs ${legacyMf}`);
console.log(`  2d. backward compat with legacy: ${mfFallback.toFixed(6)} PASS`);

console.log('\n=== Test 3: gradMF uses per-env operands (oracle #2) ===');
{
    // Two environments: seawater (R≤0.5%) and air (R≤2%), both weight 1.
    const rgtSeawater = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.005, weight: 1.0 })
    ];
    const rgtAir = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.02, weight: 1.0 })
    ];
    const design2Env = {
        ...design,
        meritEnvironments: [
            { id: 'seawater', incidentMedium: 'Water', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtSeawater },
            { id: 'air', incidentMedium: 'Air', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtAir }
        ]
    };
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

console.log('\n=== Test 4: step() (LM) multi-env lowers MF (oracle #1) ===');
{
    // Two environments: seawater (R≤0.5%) and air (R≤2%), both weight 1.
    // The single-env LM step() would optimize only the first environment
    // (shared operands on the design's own media), so the weighted multi-env
    // MF would not decrease. The multi-env FD step must lower it.
    const rgtSeawater = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.005, weight: 1.0 })
    ];
    const rgtAir = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.02, weight: 1.0 })
    ];
    const design2Env = {
        ...design,
        meritEnvironments: [
            { id: 'seawater', incidentMedium: 'Water', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtSeawater },
            { id: 'air', incidentMedium: 'Air', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtAir }
        ]
    };
    const engine = new LSQEngine(rgtAir, design2Env, resolveMat,
        { environments: design2Env.meritEnvironments });
    const mf0 = engine.mf;
    let mf = mf0;
    for (let i = 0; i < 10; i++) { engine.step(); mf = engine.mf; }
    ok(isFinite(mf), `multi-env step() MF should stay finite (got ${mf})`);
    ok(mf < mf0,
        `step() should lower the weighted multi-env MF: ${mf0.toFixed(6)} -> ${mf.toFixed(6)}`);
    console.log(`  step() 10x: MF ${mf0.toFixed(6)} -> ${mf.toFixed(6)} PASS`);
}

console.log('\n=== Test 5: analyticScan.js per-env operands (oracle #3) ===');
{
    // Two environments: seawater (R≤0.5%) and air (R≤2%), both weight 1.
    // The needle scan must accumulate each environment's gradient with ITS OWN
    // operand set, so candidate ordering reflects environment-specific targets.
    const rgtSeawater = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.005, weight: 1.0 })
    ];
    const rgtAir = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.02, weight: 1.0 })
    ];
    const rgtBoth005 = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.005, weight: 1.0 })
    ];

    const candidateMats = [
        { id: 'SiO2', name: 'SiO2', mat: resolveMat('SiO2') },
        { id: 'TiO2', name: 'TiO2', mat: resolveMat('TiO2') }
    ];

    const design2Env = {
        ...design,
        frontLayers: [{ id: 'l1', material: 'SiO2', thickness: 100, locked: false }],
        meritEnvironments: [
            { id: 'seawater', incidentMedium: 'Water', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtSeawater },
            { id: 'air', incidentMedium: 'Air', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtAir }
        ]
    };

    // Shared operand set passed to the scan — must NOT be used for an env that
    // defines its own operands.
    const scanArgs = (d) => ({
        operands: rgtAir, design: d, resolveMat, candidateMats, deltaNm: 0.5, side: 'front'
    });
    // Deterministic signature of a candidate list (pos, material, dMF).
    const sig = (cands) => cands.map(c => `${c.pos}:${c.materialId}:${c.dMF.toFixed(12)}`).join('|');

    const resA = scanNeedlesPFunction(scanArgs(design2Env));
    ok(resA && resA.candidates.length > 0,
        'analytic scan should produce candidates in multi-env mode');

    // 5a. Per-env operands take effect: changing the AIR env's target must
    // change the merged candidate gradients. If the scan used the shared
    // operand set for both envs (the bug), this would be a no-op.
    const designBoth005 = {
        ...design2Env,
        meritEnvironments: [
            design2Env.meritEnvironments[0],
            { ...design2Env.meritEnvironments[1], operands: rgtBoth005 }
        ]
    };
    const resB = scanNeedlesPFunction(scanArgs(designBoth005));
    ok(sig(resA.candidates) !== sig(resB.candidates),
        'changing the air env target should change merged candidates (per-env operands wired)');

    // 5b. Per-env independence: swapping the operand sets between the two
    // media-different envs must change the result (operands applied per-env,
    // not globally).
    const designSwap = {
        ...design2Env,
        meritEnvironments: [
            { ...design2Env.meritEnvironments[0], operands: rgtAir },
            { ...design2Env.meritEnvironments[1], operands: rgtSeawater }
        ]
    };
    const resSwap = scanNeedlesPFunction(scanArgs(designSwap));
    ok(sig(resA.candidates) !== sig(resSwap.candidates),
        'swapping per-env operands should change merged candidates');

    // 5c. Backward compat: envs WITHOUT operands fall back to the shared set —
    // result must equal the same design with operands explicitly stamped.
    const designNoOps = {
        ...design2Env,
        meritEnvironments: design2Env.meritEnvironments.map(({ operands, ...rest }) => rest)
    };
    const resFallback = scanNeedlesPFunction(scanArgs(designNoOps));
    const designExplicit = {
        ...design2Env,
        meritEnvironments: design2Env.meritEnvironments.map(e => ({ ...e, operands: rgtAir }))
    };
    const resExplicit = scanNeedlesPFunction(scanArgs(designExplicit));
    ok(sig(resFallback.candidates) === sig(resExplicit.candidates),
        'null-operands fallback should equal explicit shared operands');

    // 5d. Backward compat: no meritEnvironments → single-env path unchanged.
    const resSingle = scanNeedlesPFunction(scanArgs({ ...design, frontLayers: design2Env.frontLayers }));
    ok(resSingle && resSingle.candidates.length > 0,
        'single-env analytic scan should still produce candidates');
    console.log('  analyticScan per-env operands: 5a take-effect, 5b swap, 5c fallback, 5d single-env PASS');
}

console.log('\n=== Test 5: mfOpticalAt multi-env returns weighted OMF (oracle #5) ===');
{
    // Two environments: seawater (R≤0.5%) and air (R≤2%), both weight 1.
    // Each env carries its OWN operand set that ALSO includes a violated MNT
    // constraint (min thickness 200nm vs the 100nm layer), so:
    //   • mfAt (full) includes the MNT penalty;
    //   • mfOpticalAt (skipConstraints) must EXCLUDE it;
    //   • mfOpticalAt must be the WEIGHTED multi-env OMF, not the single-env OMF.
    const rgtSeawater = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.005, weight: 1.0 }),
        makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 1000, target: 200 })
    ];
    const rgtAir = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.02, weight: 1.0 }),
        makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 1000, target: 200 })
    ];
    const design2Env = {
        ...design,
        meritEnvironments: [
            { id: 'seawater', incidentMedium: 'Water', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtSeawater },
            { id: 'air', incidentMedium: 'Air', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtAir }
        ]
    };
    const engine = new LSQEngine(rgtAir, design2Env, resolveMat,
        { environments: design2Env.meritEnvironments });
    const thk = engine.thicknesses;

    // Reference: weighted multi-env OMF with constraints skipped.
    const specs = engine._envCtxs.map((ctx, i) => ({
        ctx: engine._envCtxFor(thk, ctx),
        weight: engine._envWeights[i],
        index: i,
        operands: engine._envOperands[i]
    }));
    const refOMF = calcMFMultiEnv(specs, rgtAir, { skipConstraints: true, getMeritAccumulation }).mf;

    // Single-env OMF: shared operands on the design's own media (the legacy path).
    const singleOMF = calcMF(rgtAir, evaluateOperands(rgtAir, engine._ctxFor(thk)), { skipConstraints: true });

    const omf = engine.mfOpticalAt(thk);
    const mf  = engine.mfAt(thk);

    ok(isFinite(omf), `mfOpticalAt should be finite (got ${omf})`);
    ok(Math.abs(omf - refOMF) < 1e-12,
        `mfOpticalAt should equal weighted multi-env OMF: ${omf} vs ${refOMF}`);
    ok(Math.abs(omf - singleOMF) > 1e-9,
        `mfOpticalAt should NOT be the single-env OMF: ${omf} vs ${singleOMF}`);
    ok(Math.abs(omf - mf) > 1e-9,
        `mfOpticalAt should exclude constraints (skipConstraints): OMF=${omf} vs MF=${mf}`);
    console.log(`  mfOpticalAt=${omf.toFixed(6)} refOMF=${refOMF.toFixed(6)} singleOMF=${singleOMF.toFixed(6)} mf=${mf.toFixed(6)} PASS`);
}

console.log('\n=== Test 6: mfAtWithPerEnv (oracle #6) ===');
{
    // Two environments with per-env operands (seawater R≤0.5%, air R≤2%).
    const rgtSeawater = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.005, weight: 1.0 })
    ];
    const rgtAir = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.02, weight: 1.0 })
    ];
    const design2Env = {
        ...design,
        meritEnvironments: [
            { id: 'seawater', incidentMedium: 'Water', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtSeawater },
            { id: 'air', incidentMedium: 'Air', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: rgtAir }
        ]
    };

    // 6a. multi-env: returns { mf, perEnvMf } with perEnvMf.length === env count,
    //     and mf identical to mfAt (same weighted total).
    const engine = new LSQEngine(rgtAir, design2Env, resolveMat,
        { environments: design2Env.meritEnvironments });
    const thk = engine.thicknesses;
    const res = engine.mfAtWithPerEnv(thk);
    ok(res && typeof res.mf === 'number' && Array.isArray(res.perEnvMf),
        'mfAtWithPerEnv should return { mf, perEnvMf }');
    ok(res.perEnvMf.length === 2,
        `perEnvMf.length should equal env count (got ${res.perEnvMf.length})`);
    ok(Math.abs(res.mf - engine.mfAt(thk)) < 1e-12,
        `mf should equal mfAt: ${res.mf} vs ${engine.mfAt(thk)}`);

    // 6b. perEnvMf[i] equals the single-env calcMF scored in that env's ctx
    //     with that env's own operands (per-env operands take effect).
    const specs = engine._envCtxs.map((ctx, i) => ({
        ctx: engine._envCtxFor(thk, ctx),
        weight: engine._envWeights[i],
        index: i,
        operands: engine._envOperands[i]
    }));
    for (let i = 0; i < specs.length; i++) {
        const ref = calcMF(specs[i].operands, evaluateOperands(specs[i].operands, specs[i].ctx));
        ok(Math.abs(res.perEnvMf[i] - ref) < 1e-12,
            `perEnvMf[${i}] should equal single-env calcMF in that env ctx: ${res.perEnvMf[i]} vs ${ref}`);
    }
    ok(Math.abs(res.perEnvMf[0] - res.perEnvMf[1]) > 1e-9,
        'per-env MFs should differ (different media + targets): ' +
        `${res.perEnvMf[0]} vs ${res.perEnvMf[1]}`);

    // 6c. single-env mode: perEnvMf === [mf], mf identical to mfAt.
    const engineSingle = new LSQEngine(rgtAir, design, resolveMat, {});
    const resSingle = engineSingle.mfAtWithPerEnv(engineSingle.thicknesses);
    ok(Array.isArray(resSingle.perEnvMf) && resSingle.perEnvMf.length === 1,
        'single-env perEnvMf should be [mf]');
    ok(Math.abs(resSingle.perEnvMf[0] - resSingle.mf) < 1e-12,
        'single-env perEnvMf[0] should equal mf');
    ok(Math.abs(resSingle.mf - engineSingle.mfAt(engineSingle.thicknesses)) < 1e-12,
        'single-env mf should equal mfAt');
    console.log('  mfAtWithPerEnv: 6a multi-env shape, 6b per-env correctness, 6c single-env compat PASS');
}

// ── P4b: per-environment operand EDITING (breadcrumb navigation) ──────────────
// The hook module reads the GLOBAL `React` at import time, so the browser shim
// must be installed before the dynamic import below.

console.log('\n=== Test 6: useEnvOperands hook (P4b) ===');
{
    const { shimBrowserGlobals } = await import('./_uiShim.mjs');
    shimBrowserGlobals();
    const ReactMod = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { useEnvOperands } =
        await import('../src/components/windows/optimization/meritFunctionEditor/useEnvOperands.js');

    // Minimal hook harness: server-render a probe component once and capture
    // the hook's return value. The hook is stateless w.r.t. the tested paths
    // (operands derive from props; write-backs go through updateDesign), so a
    // single render is enough to exercise source resolution + write-back.
    function renderHook(useHook, props) {
        let result = null;
        function Probe() { result = useHook(props); return null; }
        renderToStaticMarkup(ReactMod.createElement(Probe));
        return result;
    }

    const designLevelOps = [
        makeOperand({ type: 'R', lambdaStart: 550, lambdaEnd: 550,
            aoi: 0, pol: 'avg', target: 0, weight: 1.0 }),
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.02, weight: 1.0 }),
    ];
    const envOwnOps = [
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.005, weight: 1.0 }),
    ];
    const designWithEnvOps = {
        ...design,
        meritOperands: designLevelOps,
        meritEnvironments: [
            { id: 'e1', incidentMedium: 'Water', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0,
                operands: envOwnOps },
            { id: 'e2', incidentMedium: 'Air', exitMedium: 'Air',
                substrate: { material: 'BK7', thickness: 1.0 }, weight: 1.0 },
        ],
    };

    // 6a. envIndex >= 0 with env.operands → the env's own operands
    const h1 = renderHook(useEnvOperands, { design: designWithEnvOps, updateDesign: () => {}, checkpoint: () => {}, envIndex: 0 });
    ok(h1.operands === envOwnOps, 'envIndex=0 should return the env operands array');
    ok(h1.isCustomized === true, 'env with own operands should be customized');

    // 6b. envIndex >= 0 without env.operands → fall back to design operands
    const h2 = renderHook(useEnvOperands, { design: designWithEnvOps, updateDesign: () => {}, checkpoint: () => {}, envIndex: 1 });
    ok(h2.operands === designLevelOps, 'env without operands should fall back to design operands');
    ok(h2.isCustomized === false, 'env without own operands should not be customized');

    // 6c. envIndex null (design level) → design operands
    const h3 = renderHook(useEnvOperands, { design: designWithEnvOps, updateDesign: () => {}, checkpoint: () => {}, envIndex: null });
    ok(h3.operands === designLevelOps, 'envIndex=null should return design operands');

    // 6d. write-back: env mode → updateDesign({ meritEnvironments: [...] })
    const updates = [];
    const h4 = renderHook(useEnvOperands, { design: designWithEnvOps, updateDesign: p => updates.push(p), checkpoint: () => {}, envIndex: 0 });
    const newOps = [makeOperand({ type: 'R', lambdaStart: 600, lambdaEnd: 600,
        aoi: 0, pol: 'avg', target: 0.1, weight: 1.0 })];
    h4.setOperands(newOps);
    ok(updates.length === 1, 'setOperands should call updateDesign once');
    ok(updates[0].meritEnvironments && updates[0].meritEnvironments[0].operands === newOps,
        'env write-back should patch meritEnvironments[0].operands');
    ok(updates[0].meritEnvironments[1].operands === undefined,
        'other envs should be untouched');
    ok(updates[0].meritOperands === undefined,
        'env write-back should NOT touch design-level operands');

    // 6e. write-back: design mode → updateDesign({ meritOperands: [...] })
    const updates2 = [];
    const h5 = renderHook(useEnvOperands, { design: designWithEnvOps, updateDesign: p => updates2.push(p), checkpoint: () => {}, envIndex: null });
    h5.setOperands(newOps);
    ok(updates2.length === 1 && updates2[0].meritOperands === newOps,
        'design write-back should patch meritOperands');

    // 6f. customize: creates env.operands copy with regenerated ids
    const updates3 = [];
    const h6 = renderHook(useEnvOperands, { design: designWithEnvOps, updateDesign: p => updates3.push(p), checkpoint: () => {}, envIndex: 1 });
    h6.customize();
    ok(updates3.length === 1, 'customize should call updateDesign once');
    const copied = updates3[0].meritEnvironments[1].operands;
    ok(Array.isArray(copied) && copied.length === designLevelOps.length,
        'customize should copy all design operands');
    const srcIds = new Set(designLevelOps.map(op => op.id));
    ok(copied.every(op => !srcIds.has(op.id)),
        'customize should regenerate every operand id');
    ok(new Set(copied.map(op => op.id)).size === copied.length,
        'customize should produce unique ids');
    ok(copied[0].type === designLevelOps[0].type && copied[0].target === designLevelOps[0].target,
        'customize should preserve operand fields');

    // 6g. customize on an env that already has operands → no-op
    const updates4 = [];
    const h7 = renderHook(useEnvOperands, { design: designWithEnvOps, updateDesign: p => updates4.push(p), checkpoint: () => {}, envIndex: 0 });
    h7.customize();
    ok(updates4.length === 0, 'customize on a customized env should be a no-op');

    // 6h. clear path checkpoints (undo/redo) — same pattern as useMeritOperands doClear
    let checkpointCalls = 0;
    const updates5 = [];
    const h8 = renderHook(useEnvOperands, {
        design: designWithEnvOps, updateDesign: p => updates5.push(p),
        checkpoint: () => checkpointCalls++, envIndex: 0,
        setInputDialog: d => { if (d) d.onConfirm(); },
    });
    h8.handleClear();
    ok(checkpointCalls === 1, 'handleClear should checkpoint before clearing');
    ok(updates5.length === 1 && updates5[0].meritEnvironments[0].operands.length === 0,
        'handleClear should write empty operands to the env');

    console.log('  useEnvOperands: 6a source, 6b fallback, 6c design, 6d env write-back, 6e design write-back, 6f customize ids, 6g no-op, 6h checkpoint PASS');
}

console.log('\n=== Test 7: cloneOperandsWithNewIds (P4b) ===');
{
    const { cloneOperandsWithNewIds } =
        await import('../src/components/windows/optimization/meritFunctionEditor/useEnvOperands.js');
    const src = [
        makeOperand({ type: 'R', lambdaStart: 550, lambdaEnd: 550,
            aoi: 0, pol: 'avg', target: 0, weight: 1.0 }),
        makeOperand({ type: 'RGT', lambdaStart: 400, lambdaEnd: 700,
            aoi: 0, pol: 'avg', target: 0.02, weight: 1.0 }),
    ];
    const clone = cloneOperandsWithNewIds(src);
    ok(clone.length === src.length, 'clone should keep the same length');
    ok(clone.every((op, i) => op.id !== src[i].id),
        'every cloned id should differ from the source id');
    ok(new Set(clone.map(op => op.id)).size === clone.length,
        'cloned ids should be unique');
    ok(clone.every((op, i) => op.type === src[i].type && op.target === src[i].target && op.weight === src[i].weight),
        'clone should preserve operand fields');
    ok(clone[0] !== src[0], 'clone should be new objects');
    console.log('  cloneOperandsWithNewIds: ids regenerated, unique, fields preserved PASS');
}

console.log('\n=== Summary ===');
console.log(`multi_env_per_env_operands: ${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}`);
process.exit(fails ? 1 : 0);