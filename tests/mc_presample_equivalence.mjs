/**
 * Parallel-path presample-contract test.
 *
 * Run: node tests/mc_presample_equivalence.mjs
 *
 * The worker pool uses a table-lookup `getNK` (Approach A). It can
 * only ever be bit-identical to the main-thread path if every λ value that
 * `runOneTrial*` will sample is in the pre-sampled table. This test asserts
 * exactly that: with a presampled material table built from
 * `requiredLambdasBBM` / `requiredLambdasMMS`, the per-trial output matches the
 * main-thread output to floating-point equality.
 *
 * If this test starts producing a `nearest-λ fallback used` warning it means
 * one of the simulators added a new λ sampling path that wasn't routed through
 * the central helper — re-route it through the helper, don't paper over with
 * widened tolerance.
 */

import {
    runOneTrialBBM,
    requiredLambdasBBM,
    displayLambdas,
    mulberry32,
    deriveSeed,
} from '../src/utils/monitoring/monitoringSim.js';
import {
    runOneTrialMMS,
    requiredLambdasMMS,
    defaultMonitorTable,
} from '../src/utils/monitoring/monoMonitoringSim.js';
import {
    collectDesignMaterialIds,
    buildPresampledTable,
    requiredLambdas as requiredOperandLambdas,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const resolveMatHost = (id) => getMaterial(id) || getMaterial('Air');

// Mirror of `makeResolveMat` in src/utils/mcWorker.js — table lookup with a
// nearest-λ fallback that warns. Duplicated here (not imported) because the
// worker file isn't directly importable in node without a worker host.
function makeResolveMatTable(materials) {
    const cache = new Map();
    let missed = null;
    function build(id) {
        const entry = materials[id] || materials['Air'] || null;
        const map = new Map();
        let sortedL = null, sortedNK = null;
        if (entry && entry.lambdas) {
            const { lambdas, n, k } = entry;
            for (let i = 0; i < lambdas.length; i++) {
                map.set(lambdas[i], [n[i], k[i]]);
            }
            const idx = lambdas.map((_, i) => i).sort((a, b) => lambdas[a] - lambdas[b]);
            sortedL  = idx.map(i => lambdas[i]);
            sortedNK = idx.map(i => [n[i], k[i]]);
        }
        return {
            getNK(lam) {
                const v = map.get(lam);
                if (v !== undefined) return v;
                if (!missed) missed = { id, lam };
                if (!sortedL || sortedL.length === 0) return [1, 0];
                let lo = 0, hi = sortedL.length - 1;
                while (hi - lo > 1) {
                    const mid = (lo + hi) >> 1;
                    if (sortedL[mid] < lam) lo = mid; else hi = mid;
                }
                return (Math.abs(sortedL[lo] - lam) <= Math.abs(sortedL[hi] - lam))
                    ? sortedNK[lo] : sortedNK[hi];
            },
        };
    }
    return {
        resolveMat(id) {
            const key = (id == null || id === '') ? 'Air' : id;
            let stub = cache.get(key);
            if (!stub) { stub = build(key); cache.set(key, stub); }
            return stub;
        },
        getMiss() { return missed; },
    };
}

// ── Designs ───────────────────────────────────────────────────────────────────

function bbarDesign() {
    return {
        id: 'bbar1', name: 'BBAR',
        referenceWavelength: 550,
        substrate: { material: 'BK7', thickness: 1.0 },
        incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [{ id: 'L1', material: 'MgF2', thickness: 94, locked: false }],
        backLayers: [],
        surfaceMode: 'front_only',
        meritOperands: [
            { type:'RAV', lambdaStart:400, lambdaEnd:700, aoi:0, pol:'avg',
              target:0, weight:1, enabled:true },
        ],
    };
}

function fourQWDesign() {
    return {
        id: '4QW', name: '4-QW',
        referenceWavelength: 550,
        substrate: { material: 'BK7', thickness: 1.0 },
        incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'L1', material: 'TiO2', thickness:  60 },
            { id: 'L2', material: 'SiO2', thickness: 100 },
            { id: 'L3', material: 'TiO2', thickness:  60 },
            { id: 'L4', material: 'SiO2', thickness: 100 },
        ],
        backLayers: [],
        surfaceMode: 'front_only',
        meritOperands: [
            { type:'RAV', lambdaStart:450, lambdaEnd:650, aoi:0, pol:'avg',
              target:0, weight:1, enabled:true },
        ],
    };
}

// ── BBM presample equivalence ─────────────────────────────────────────────────

function test_bbm_presample_equivalence() {
    const design = bbarDesign();
    const cfg = {
        rates: new Map([['MgF2', { mean: 0.5, sigma: 0.05 }]]),
        sigmaReN: 0.002, sigmaImN: 0, perMaterial: true,
        mon: { char: 'T', theta: 0, polarization: 'avg',
               lambdaStart: 400, lambdaEnd: 800, nPoints: 21,
               scanIntervalSec: 0.4, confirmScans: 2 },
        sig: { randomPct: 0.3, driftPctPer1000s: 0 },
        nRuns: 1,
        spectrumParams: { lambdaStart:400, lambdaEnd:700, lambdaStep:25, theta:0, polarization:'avg' },
    };

    const operands = design.meritOperands;
    const lambdas  = requiredLambdasBBM({ ...cfg, operands });
    const ids      = collectDesignMaterialIds(design);
    const pairs    = ids.map(id => ({ id, mat: resolveMatHost(id) }));
    const table    = buildPresampledTable(lambdas, pairs);
    const { resolveMat: resolveMatTbl, getMiss } = makeResolveMatTable(table);

    const dispLam = displayLambdas(cfg.spectrumParams);
    const displayCtx = {
        lambdas: Float64Array.from(dispLam),
        theta:   cfg.spectrumParams.theta,
        pol:     cfg.spectrumParams.polarization,
        char:    cfg.mon.char,
    };

    const rng1 = mulberry32(deriveSeed(0xBBADCAFE, 0));
    const trialHost = runOneTrialBBM(design, resolveMatHost, cfg, rng1, displayCtx, operands);

    const rng2 = mulberry32(deriveSeed(0xBBADCAFE, 0));
    const trialTbl  = runOneTrialBBM(design, resolveMatTbl,  cfg, rng2, displayCtx, operands);

    ok(getMiss() === null,
        `BBM presample covers every λ (no nearest fallback triggered)`);

    let maxAbs = 0;
    for (let i = 0; i < trialHost.asBuiltFront.length; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(trialHost.asBuiltFront[i] - trialTbl.asBuiltFront[i]));
    }
    ok(maxAbs === 0,
        `BBM as-built thicknesses bit-identical: max |Δ|=${maxAbs}`);
    let maxSpec = 0;
    for (let i = 0; i < trialHost.spectrum.length; i++) {
        maxSpec = Math.max(maxSpec, Math.abs(trialHost.spectrum[i] - trialTbl.spectrum[i]));
    }
    ok(maxSpec === 0,
        `BBM display spectrum bit-identical: max |Δ|=${maxSpec}`);
    ok((trialHost.mf == null && trialTbl.mf == null) || trialHost.mf === trialTbl.mf,
        `BBM MF bit-identical: ${trialHost.mf} vs ${trialTbl.mf}`);
}

// ── MMS presample equivalence ─────────────────────────────────────────────────

function test_mms_presample_equivalence() {
    const design = fourQWDesign();
    const monTable = defaultMonitorTable(design, resolveMatHost);
    // Force a mix of strategies on different layers + a non-ref-wavelength λ_mon
    monTable[0].strategy = 'turning'; monTable[0].lambda = 550;
    monTable[1].strategy = 'level';   monTable[1].lambda = 600;
    monTable[2].strategy = 'time';    monTable[2].sigmaRelPct = 1.0;
    monTable[3].strategy = 'turning'; monTable[3].lambda = 700;
    const cfg = {
        rates: new Map([
            ['TiO2', { mean: 0.3, sigma: 0.03 }],
            ['SiO2', { mean: 0.5, sigma: 0.05 }],
        ]),
        sigmaReN: 0.002, sigmaImN: 0, perMaterial: true,
        monTable,
        common: { thetaDeg: 0, pol: 'avg', char: 'T', scanIntervalSec: 0.5, confirmScans: 2 },
        shutter: { meanMs: 50, sigmaMs: 10 },
        sig: { randomPct: 0.5, driftPctPer1000s: 0 },
        nRuns: 1,
        spectrumParams: { lambdaStart:450, lambdaEnd:650, lambdaStep:25, theta:0, polarization:'avg' },
    };

    const operands = design.meritOperands;
    const lambdas  = requiredLambdasMMS({ ...cfg, operands });
    const ids      = collectDesignMaterialIds(design);
    const pairs    = ids.map(id => ({ id, mat: resolveMatHost(id) }));
    const table    = buildPresampledTable(lambdas, pairs);
    const { resolveMat: resolveMatTbl, getMiss } = makeResolveMatTable(table);

    const dispLam = displayLambdas(cfg.spectrumParams);
    const displayCtx = {
        lambdas: Float64Array.from(dispLam),
        theta:   cfg.spectrumParams.theta,
        pol:     cfg.spectrumParams.polarization,
        char:    cfg.common.char,
    };

    const rng1 = mulberry32(deriveSeed(0xC0FFEE, 0));
    const trialHost = runOneTrialMMS(design, resolveMatHost, cfg, rng1, displayCtx, operands);

    const rng2 = mulberry32(deriveSeed(0xC0FFEE, 0));
    const trialTbl  = runOneTrialMMS(design, resolveMatTbl,  cfg, rng2, displayCtx, operands);

    if (getMiss() !== null) {
        const m = getMiss();
        console.error(`  MMS missed λ=${m.lam} for "${m.id}"`);
    }
    ok(getMiss() === null,
        `MMS presample covers every λ (no nearest fallback triggered)`);

    let maxAbs = 0;
    for (let i = 0; i < trialHost.asBuiltFront.length; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(trialHost.asBuiltFront[i] - trialTbl.asBuiltFront[i]));
    }
    ok(maxAbs === 0,
        `MMS as-built thicknesses bit-identical: max |Δ|=${maxAbs}`);
    let maxSpec = 0;
    for (let i = 0; i < trialHost.spectrum.length; i++) {
        maxSpec = Math.max(maxSpec, Math.abs(trialHost.spectrum[i] - trialTbl.spectrum[i]));
    }
    ok(maxSpec === 0,
        `MMS display spectrum bit-identical: max |Δ|=${maxSpec}`);
    ok((trialHost.mf == null && trialTbl.mf == null) || trialHost.mf === trialTbl.mf,
        `MMS MF bit-identical: ${trialHost.mf} vs ${trialTbl.mf}`);
}

// ── λ-grid contract sanity ──────────────────────────────────────────────────

function test_required_lambdas_includes_everything() {
    const design = bbarDesign();
    const operands = design.meritOperands;
    const cfg = {
        operands,
        mon: { lambdaStart: 400, lambdaEnd: 800, nPoints: 21 },
        spectrumParams: { lambdaStart: 400, lambdaEnd: 700, lambdaStep: 25 },
    };
    const lambdas = requiredLambdasBBM(cfg);
    const set = new Set(lambdas);

    // Display λ must all be present
    for (const l of displayLambdas(cfg.spectrumParams)) {
        if (!set.has(l)) { ok(false, `display λ ${l} missing from union`); break; }
    }
    // Scan λ must all be present
    const lamA = cfg.mon.lambdaStart, lamB = cfg.mon.lambdaEnd, n = cfg.mon.nPoints;
    for (let i = 0; i < n; i++) {
        const lam = lamA + i * ((lamB - lamA) / (n - 1));
        if (!set.has(lam)) { ok(false, `scan λ ${lam} missing from union`); break; }
    }
    // Operand λ must all be present
    for (const l of requiredOperandLambdas(operands)) {
        if (!set.has(l)) { ok(false, `operand λ ${l} missing from union`); break; }
    }
    ok(true, `requiredLambdasBBM union contains all three sources`);
}

// ── Run all ───────────────────────────────────────────────────────────────────

console.log('Running MC presample-equivalence tests...\n');
test_bbm_presample_equivalence();
test_mms_presample_equivalence();
test_required_lambdas_includes_everything();

if (fails === 0) {
    console.log('\n✓ All presample-equivalence tests passed');
    process.exit(0);
} else {
    console.error(`\n✗ ${fails} presample-equivalence test(s) failed`);
    process.exit(1);
}
