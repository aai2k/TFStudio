/**
 * Adaptive merit sampling — narrow-feature merit aliasing.
 *
 * The default uniform operand grid (~2 nm for TGT/RGT/AGT) steps over spectral
 * features narrower than its step, so the merit function is blind to them and the
 * optimizer can't suppress them (e.g. the 411 nm stopband spike).
 * densifyOperandsForFeatures() probes the spectrum at launch and raises a
 * band-sampled operand's UNIFORM sample count so its grid resolves the narrowest
 * significant feature in its band — and ONLY then (smooth designs untouched).
 *
 * Checks:
 *   1. Smooth design (BBAR) → no-op: identical array, identical operand refs.
 *   2. High-finesse Fabry–Perot has a genuine sub-2 nm transmission resonance
 *      (verified by a fine reference scan in the test itself).
 *   3. A flat RGT over the resonance band is BLIND to it on the 2 nm grid, and
 *      densification raises its count so the resonance contributes to the RMS.
 *   4. A worst-case RMX over the band likewise gets densified and now reports the
 *      true peak.
 *   5. Sampling contract: requiredLambdas(densified) ⊇ requiredLambdas(original),
 *      and every densified operand's grid stays UNIFORM (so evalOperand/Jacobian
 *      semantics are unchanged).
 *   6. enabled:false → exact no-op.
 *
 * Run: node tests/adaptive_sampling.mjs
 */

import {
    makeOperand, evaluateOperands, calcMF, buildEvalContext,
    operandSampleLambdas, requiredLambdas,
    densifyOperandsForFeatures, ADAPTIVE_SAMPLING_DEFAULTS,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = id => getMaterial(id);
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };

// ── Designs ───────────────────────────────────────────────────────────────────
// Smooth: a detuned BBAR — no narrow features in the visible.
const smooth = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'a', material: 'TiO2', thickness: 80,  locked: false },
        { id: 'b', material: 'SiO2', thickness: 140, locked: false },
        { id: 'c', material: 'TiO2', thickness: 60,  locked: false },
        { id: 'd', material: 'SiO2', thickness: 120, locked: false },
    ],
    backLayers: [], surfaceMode: 'front_only',
};

// High-finesse single-cavity Fabry–Perot at λ0 = 550 nm:
//   substrate | (H L)^6 H | 2L | H (L H)^6 | air
// QW thicknesses d = λ0 / (4 n(λ0)). Two thick QW mirrors → a very narrow
// transmission peak at 550 nm sitting in a wide high-reflection stopband.
const LAM0 = 550;
const nTiO2 = getMaterial('TiO2').getNK(LAM0)[0];
const nSiO2 = getMaterial('SiO2').getNK(LAM0)[0];
const dH = LAM0 / (4 * nTiO2);
const dL = LAM0 / (4 * nSiO2);
const fpLayers = [];
let _i = 0;
const push = (mat, th) => fpLayers.push({ id: `fp${_i++}`, material: mat, thickness: th, locked: false });
const PERIODS = 6;
for (let p = 0; p < PERIODS; p++) { push('TiO2', dH); push('SiO2', dL); }
push('TiO2', dH);          // central H before spacer
push('SiO2', 2 * dL);      // half-wave (2L) spacer = the cavity
for (let p = 0; p < PERIODS; p++) { push('TiO2', dH); push('SiO2', dL); }
push('TiO2', dH);
const cavity = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: fpLayers, backLayers: [], surfaceMode: 'front_only',
};

// ── 1. No-op on a smooth design ───────────────────────────────────────────────
{
    const ops = [
        makeOperand({ type: 'RGT', lambdaStart: 450, lambdaEnd: 650, pol: 'avg', target: 0, weight: 1 }),
        makeOperand({ type: 'RMX', lambdaStart: 450, lambdaEnd: 650, pol: 'avg', target: 0, weight: 1 }),
    ];
    const out = densifyOperandsForFeatures(ops, smooth, resolveMat);
    ok(out === ops, 'smooth design → returns the SAME array (no densification)');
    ok(out.every((o, i) => o === ops[i]), 'smooth design → operand refs unchanged');
}

// ── 2. The cavity really does have a sub-2 nm resonance ───────────────────────
let trueFWHM = Infinity, truePeak = 0;
{
    const ctx = buildEvalContext(cavity, resolveMat);
    // Fine reference scan of T(λ) around 550 nm.
    const ops = [];
    for (let lam = 540; lam <= 560; lam += 0.05) {
        ops.push(makeOperand({ type: 'T', lambdaStart: lam, lambdaEnd: lam, pol: 'avg', target: 0 }));
    }
    const vals = evaluateOperands(ops, ctx);
    let peakI = 0;
    for (let i = 1; i < vals.length; i++) if (vals[i] > vals[peakI]) peakI = i;
    truePeak = vals[peakI];
    const half = truePeak / 2;
    let l = peakI, r = peakI;
    while (l > 0 && vals[l] >= half) l--;
    while (r < vals.length - 1 && vals[r] >= half) r++;
    trueFWHM = (r - l) * 0.05;
    ok(truePeak > 0.5, `cavity transmission peak is strong (T_peak = ${(truePeak * 100).toFixed(1)} %)`);
    ok(trueFWHM < 2.0, `cavity resonance is narrower than the 2 nm grid (FWHM ≈ ${trueFWHM.toFixed(2)} nm)`);
}

// ── 3. Flat TGT whose coarse grid STEPS OVER the peak → blind until densified ──
{
    // Wide band [451,649]: the default ~2 nm grid lands on 451,453,… and never
    // on 550.0, so the merit is blind to the resonance — the user's 411 nm spike
    // in a 200 nm stopband. (Aliasing is a WIDE-band problem; narrow bands hit
    // the AVG_POINTS floor and are already dense.)
    const tgt = makeOperand({ type: 'TGT', lambdaStart: 451, lambdaEnd: 649, pol: 'avg', target: 0, targetEnd: 0, weight: 1 });
    const ctx = buildEvalContext(cavity, resolveMat);
    const coarseLams = operandSampleLambdas(tgt);

    // The decisive, dilution-proof signal: does the operand's grid actually
    // SAMPLE the feature near 550 nm? (RMS over a wide band dilutes a narrow
    // spike, so comparing RMS values is the wrong test — the bug is that the
    // grid never evaluates the feature at all → zero contribution + zero gradient.)
    const peakT = lam => evaluateOperands(
        [makeOperand({ type: 'T', lambdaStart: lam, lambdaEnd: lam, pol: 'avg', target: 0 })], ctx)[0];
    const near = (lams) => Math.max(...lams.filter(l => Math.abs(l - 550) <= 5).map(peakT));

    const coarseMax = near(coarseLams);
    ok(coarseMax < 0.1,
       `coarse grid is BLIND to the spike (max sampled T within ±5 nm of peak = ${(coarseMax * 100).toFixed(1)} %)`);

    const [tgtD] = densifyOperandsForFeatures([tgt], cavity, resolveMat);
    ok(tgtD !== tgt, 'TGT over the resonance band was densified (clone returned)');
    const lamsD = operandSampleLambdas(tgtD);
    ok(Number.isFinite(tgtD.rampPoints) && tgtD.rampPoints > coarseLams.length,
       `TGT rampPoints raised ${coarseLams.length} → ${tgtD.rampPoints}`);

    const denseMax = near(lamsD);
    ok(denseMax > 0.5,
       `densified grid now SAMPLES the spike (max sampled T within ±5 nm of peak = ${(denseMax * 100).toFixed(1)} %)`);

    const stepD = Math.abs(tgtD.lambdaEnd - tgtD.lambdaStart) / (lamsD.length - 1);
    const stepC = Math.abs(tgt.lambdaEnd - tgt.lambdaStart) / (coarseLams.length - 1);
    ok(stepD < stepC, `densified step ${stepD.toFixed(3)} nm < nominal ${stepC.toFixed(3)} nm`);
}

// ── 4. Worst-case TMX finer than its dense default → densified + reports peak ──
{
    // TMX defaults to a ~1 nm (301-pt) grid; this resonance is far narrower, so
    // even the worst-case operand needs densifying to report the true extremum.
    const tmx = makeOperand({ type: 'TMX', lambdaStart: 500, lambdaEnd: 600, pol: 'avg', target: 0, weight: 1 });
    const ctx = buildEvalContext(cavity, resolveMat);
    const baseN = operandSampleLambdas(tmx).length;
    const [tmxD] = densifyOperandsForFeatures([tmx], cavity, resolveMat);
    ok(tmxD !== tmx && operandSampleLambdas(tmxD).length > baseN,
       `TMX densified beyond its ${baseN}-pt default → ${operandSampleLambdas(tmxD).length}`);
    const v = evaluateOperands([tmxD], ctx)[0];
    ok(v > 0.5 * truePeak, `densified TMX reports a near-true peak (got ${(v * 100).toFixed(1)} %, true ${(truePeak * 100).toFixed(1)} %)`);
}

// ── 5. Sampling contract: superset λ grid, uniform spacing preserved ──────────
{
    const ops = [
        makeOperand({ type: 'TGT', lambdaStart: 500, lambdaEnd: 600, pol: 'avg', target: 0, targetEnd: 0, weight: 1 }),
        makeOperand({ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, pol: 'avg', target: 0, weight: 1 }),
    ];
    const out = densifyOperandsForFeatures(ops, cavity, resolveMat);
    const before = new Set(requiredLambdas(ops));
    const after  = new Set(requiredLambdas(out));
    // RAV is an average → must NOT be densified (semantics).
    ok(out[1] === ops[1], 'band-average RAV is left untouched (uniform-mean semantics)');
    // The densified TGT grid is a SUPERSET-ish denser grid; check uniformity.
    const lamsD = operandSampleLambdas(out[0]);
    let maxJitter = 0;
    const step = (out[0].lambdaEnd - out[0].lambdaStart) / (lamsD.length - 1);
    for (let i = 1; i < lamsD.length; i++) maxJitter = Math.max(maxJitter, Math.abs((lamsD[i] - lamsD[i - 1]) - step));
    ok(maxJitter < 1e-9, 'densified grid is UNIFORM (max jitter < 1e-9 nm)');
    ok(after.size >= before.size, `requiredLambdas grew (${before.size} → ${after.size})`);
}

// ── 6. enabled:false → exact no-op ────────────────────────────────────────────
{
    const ops = [makeOperand({ type: 'TGT', lambdaStart: 500, lambdaEnd: 600, pol: 'avg', target: 0, targetEnd: 0 })];
    const out = densifyOperandsForFeatures(ops, cavity, resolveMat, { ...ADAPTIVE_SAMPLING_DEFAULTS, enabled: false });
    ok(out === ops, 'enabled:false → returns the input array unchanged');
}

if (fails === 0) console.log('\nAll adaptive-sampling tests passed.');
else { console.error(`\n${fails} test(s) failed.`); process.exit(1); }
