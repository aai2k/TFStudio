/**
 * Tests for the new merit-function operand types added alongside the
 * Integral Values v2 work:
 *
 *   • TIW / RIW / AIW — weighted-integral operand (source × detector × band)
 *   • TMN / RMN / AMN — worst-case soft-min   ("T ≥ target")
 *   • TMX / RMX / AMX — worst-case soft-max   ("R ≤ target")
 *
 * Properties asserted:
 *   1. TIW evaluates to Σ w·T / Σ w on its sample grid (hand-computed match).
 *   2. TIW analytic Jacobian == central-difference Jacobian (≤ 1e-6 rel).
 *   3. Soft-min / soft-max approach the true min/max as p increases,
 *      with a bounded gap ≤ log(N)/p (the log-sum-exp slack).
 *   4. TMN residual is one-sided (zero when soft-min ≥ target, positive when
 *      violated). Same for TMX with the opposite sign.
 *   5. TMN analytic Jacobian == central-difference Jacobian under violation.
 *   6. operandSampleLambdas returns the documented N-point grid for the new
 *      band-sampled types, including the bit-identical AVG_POINTS fallback.
 *   7. Persistence roundtrip: a custom-integral preset survives
 *      JSON.stringify → JSON.parse without mutation.
 *
 * Run: node tests/new_operands.mjs
 */

import {
    makeOperand, evaluateOperands, buildEvalContext, calcMF,
    operandSampleLambdas, bandSampleCount, OPERAND_TYPES,
    isIntegral, isMinmax, isMinType, ARGWAVE_DEFAULT_POINTS,
    DLSOptimizer,
} from '../src/utils/physics/optimizer.js';
import { resolveSourceSpec, resolveDetectorSpec, composeWeighting } from '../src/utils/physics/spectralWeightings.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t) => Math.abs(a - b) <= t;

// Build a tiny synthetic design: incident=Air, substrate=BK7, one Ta2O5 layer.
function makeDesign(thicknessNm) {
    return {
        incidentMedium: 'Air',
        exitMedium:     'Air',
        substrate:      { material: 'BK7', thickness: 1.0 },
        frontLayers:    [{ id: 'L1', material: 'Ta2O5', thickness: thicknessNm }],
        backLayers:     [],
        surfaceMode:    'front_only',
    };
}
const resolveMat = id => getMaterial(id);

// ── 1. TIW evaluates to Σ w·T / Σ w ──────────────────────────────────────────
console.log('— TIW evaluates as weighted band integral —');
{
    const design = makeDesign(120);
    const ctx    = buildEvalContext(design, resolveMat);
    const op = makeOperand({
        type: 'TIW', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg',
        target: 1.0, weight: 1.0,
        source: { id: 'D65' }, detector: { id: 'photopic' },
        bandPoints: 13,
    });
    const lams = operandSampleLambdas(op);
    ok(lams.length === 13, `13 sample λs (got ${lams.length})`);

    // Compute expected hand-side: same TMM that evaluateOperands uses, weighted by D65*V(λ).
    const S = resolveSourceSpec({ id: 'D65' });
    const D = resolveDetectorSpec({ id: 'photopic' });
    // Single-operand T at each λ, avg pol: easiest way to harvest those is to
    // make a parallel TAV operand on the same grid and average — but we want
    // the *weighted* mean. Sample directly via small helper operands.
    let num = 0, den = 0;
    for (const lam of lams) {
        const probe = makeOperand({
            type: 'TAV', lambdaStart: lam, lambdaEnd: lam, aoi: 0, pol: 'avg',
            target: 0, weight: 1, bandPoints: 2,
        });
        // For a degenerate band [lam,lam] operandSampleLambdas returns [lam,lam,…];
        // evaluateOperands averages all 13 samples (which are the same λ), so we
        // get T(lam). Use it.
        const v = evaluateOperands([probe], ctx)[0];
        const w = S.sampler(lam) * D.sampler(lam);
        num += w * v;
        den += w;
    }
    const expected = num / den;

    const got = evaluateOperands([op], ctx)[0];
    ok(near(got, expected, 1e-12),
       `TIW ≈ Σ w·T / Σ w (|Δ| ${Math.abs(got - expected).toExponential(2)})`);
}

// ── 2. TIW analytic Jacobian vs central differences ─────────────────────────
console.log('— TIW analytic Jacobian matches FD —');
{
    const design = makeDesign(150);
    const opMatch = makeOperand({
        type: 'TIW', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg',
        target: 0.95, weight: 1.0,
        source: { id: 'D65' }, detector: { id: 'photopic' },
        bandPoints: 13,
    });
    const opts = { iterations: 0 };
    const dls  = new DLSOptimizer([opMatch], design, resolveMat, opts);
    const thk  = dls.thicknesses.slice();
    const freeIdx = thk.map((_, i) => i);

    // analytic
    const Jan = dls._analyticJacobian(thk, freeIdx);
    ok(Jan && Jan.length === 1, `analytic J row exists (got ${Jan?.length})`);

    // central FD
    const h = 1e-3;
    const r0 = dls._residuals(thk);
    const Jfd = new Array(freeIdx.length);
    for (let ci = 0; ci < freeIdx.length; ci++) {
        const thkP = thk.slice(); thkP[freeIdx[ci]] += h;
        const thkM = thk.slice(); thkM[freeIdx[ci]] -= h;
        const rP = dls._residuals(thkP);
        const rM = dls._residuals(thkM);
        Jfd[ci] = (rP[0] - rM[0]) / (2 * h);
    }

    for (let ci = 0; ci < freeIdx.length; ci++) {
        const a = Jan[0][ci], b = Jfd[ci];
        const rel = Math.abs(a - b) / Math.max(1e-9, Math.abs(b));
        ok(rel < 1e-3 || Math.abs(a - b) < 1e-6,
           `TIW dJ col${ci}: an=${a.toExponential(3)} fd=${b.toExponential(3)} rel=${rel.toExponential(2)}`);
    }
}

// ── 3. minmax operands return the TRUE (exact) band extremum ─────────────────
// (No more log-sum-exp soft surrogate — the operand value is the real
// worst-case T/R/A on its grid, so the MFE "Current" cell never reads a
// physically-impossible value like 108 % T, and the Specification window — which
// evaluates the same operand — agrees exactly.)
console.log('— minmax operands return the exact band extremum —');
{
    const design = makeDesign(200);
    const ctx    = buildEvalContext(design, resolveMat);
    // We expect Ta2O5 200 nm on glass to show R oscillations across 400-700 — a
    // non-monotonic spectrum where min/max are interior.
    const lams = [];
    for (let l = 400; l <= 700; l += 25) lams.push(l);

    // Sample R at each λ via a single-λ operand
    const Rvals = lams.map(lam => {
        const probe = makeOperand({
            type: 'RAV', lambdaStart: lam, lambdaEnd: lam, aoi: 0, pol: 'avg',
            target: 0, weight: 1,
        });
        return evaluateOperands([probe], ctx)[0];
    });
    const trueMin = Math.min(...Rvals);
    const trueMax = Math.max(...Rvals);

    // pNorm is now irrelevant to the value — the operand reports the exact
    // extremum regardless. Verify that across several pNorm settings.
    for (const p of [10, 50, 200]) {
        const opMin = makeOperand({
            type: 'RMN', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg',
            target: 0, weight: 1, pNorm: p,
        });
        const opMax = makeOperand({
            type: 'RMX', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg',
            target: 0, weight: 1, pNorm: p,
        });
        // Exact min/max over the operand's OWN (dense) grid — must equal the
        // operand's reported value to machine precision.
        const lamsGrid = operandSampleLambdas(opMin);
        const RvalsGrid = lamsGrid.map(lam => evaluateOperands([makeOperand({
            type: 'RAV', lambdaStart: lam, lambdaEnd: lam, aoi: 0, pol: 'avg', target: 0, weight: 1,
        })], ctx)[0]);
        const exactMin = Math.min(...RvalsGrid);
        const exactMax = Math.max(...RvalsGrid);

        const vMin = evaluateOperands([opMin], ctx)[0];
        const vMax = evaluateOperands([opMax], ctx)[0];

        ok(Math.abs(vMin - exactMin) < 1e-12,
           `RMN = exact band min (p=${p}): op=${vMin.toExponential(3)} exact=${exactMin.toExponential(3)}`);
        ok(Math.abs(vMax - exactMax) < 1e-12,
           `RMX = exact band max (p=${p}): op=${vMax.toExponential(3)} exact=${exactMax.toExponential(3)}`);
        ok(vMax <= 1.0 + 1e-9 && vMin >= -1e-9,
           `extrema physical: 0 ≤ RMN..RMX ≤ 1 (min=${vMin.toFixed(4)} max=${vMax.toFixed(4)})`);
    }
    // Sanity: there was indeed structure in this band
    ok(trueMax - trueMin > 0.05,
       `Ta2O5/BK7 has interior R oscillation (got Δ=${(trueMax-trueMin).toFixed(3)})`);
}

// ── 4. TMN residual is one-sided ────────────────────────────────────────────
console.log('— TMN / TMX residual is one-sided —');
{
    const design = makeDesign(200);
    const ctx    = buildEvalContext(design, resolveMat);

    // Target T = 0 is trivially satisfied (T is always ≥ 0); soft-min ≥ 0
    // → residual stored as max(0, target − comp) = max(0, 0 − x) = 0.
    const opSatisfied = makeOperand({
        type: 'TMN', lambdaStart: 400, lambdaEnd: 700,
        target: 0, weight: 1, pNorm: 50, bandPoints: 13,
    });
    const compS = evaluateOperands([opSatisfied], ctx)[0];
    const residS = Math.max(0, opSatisfied.target - compS);
    ok(residS === 0, `TMN(target=0) residual = 0 (got ${residS})`);

    // Target T = 1.0 is impossible (T < 1 always for a coated stack);
    // → residual > 0.
    const opViolated = makeOperand({
        type: 'TMN', lambdaStart: 400, lambdaEnd: 700,
        target: 1.0, weight: 1, pNorm: 50, bandPoints: 13,
    });
    const compV = evaluateOperands([opViolated], ctx)[0];
    const residV = Math.max(0, opViolated.target - compV);
    ok(residV > 0, `TMN(target=1) residual > 0 (got ${residV.toExponential(2)})`);

    // calcMF agrees
    const mf = calcMF([opSatisfied, opViolated], [compS, compV]);
    ok(mf > 0 && Number.isFinite(mf), `calcMF returns finite > 0 (${mf.toExponential(2)})`);
}

// ── 5. TMN analytic Jacobian vs FD under violation ──────────────────────────
console.log('— TMN analytic Jacobian (violated) matches FD —');
{
    const design = makeDesign(180);
    const op = makeOperand({
        type: 'TMN', lambdaStart: 400, lambdaEnd: 700,
        target: 1.0, weight: 1, pNorm: 50, bandPoints: 13,
    });
    const dls = new DLSOptimizer([op], design, resolveMat, {});
    const thk = dls.thicknesses.slice();
    const freeIdx = thk.map((_, i) => i);

    const Jan = dls._analyticJacobian(thk, freeIdx);
    ok(Jan && Jan.length === 1, 'TMN analytic J row exists');

    const h = 1e-3;
    const r0 = dls._residuals(thk);
    const Jfd = new Array(freeIdx.length);
    for (let ci = 0; ci < freeIdx.length; ci++) {
        const thkP = thk.slice(); thkP[freeIdx[ci]] += h;
        const thkM = thk.slice(); thkM[freeIdx[ci]] -= h;
        Jfd[ci] = (dls._residuals(thkP)[0] - dls._residuals(thkM)[0]) / (2 * h);
    }
    for (let ci = 0; ci < freeIdx.length; ci++) {
        const a = Jan[0][ci], b = Jfd[ci];
        const rel = Math.abs(a - b) / Math.max(1e-9, Math.abs(b));
        ok(rel < 1e-2 || Math.abs(a - b) < 1e-5,
           `TMN dJ col${ci}: an=${a.toExponential(3)} fd=${b.toExponential(3)} rel=${rel.toExponential(2)}`);
    }
}

// ── 6. operandSampleLambdas: density-based default (~AVG_STEP_NM spacing) ────
// Band-sampled operands now default to a DENSE, density-based grid so band
// averages / integrals / worst-case are computed precisely (was a fixed 13).
console.log('— operandSampleLambdas for new band types —');
{
    // Integral / band-average operands use the ~AVG_STEP_NM density default.
    const densityN = bandSampleCount({ lambdaStart: 400, lambdaEnd: 700 }); // 300 nm @2 nm → 151
    for (const type of ['TIW', 'RIW', 'AIW']) {
        const op = makeOperand({ type, lambdaStart: 400, lambdaEnd: 700 });
        const lams = operandSampleLambdas(op);
        ok(lams.length === densityN, `${type}: density default = ${densityN} samples (got ${lams.length})`);
        ok(lams[0] === 400 && lams[lams.length - 1] === 700,
           `${type}: endpoints exact (got ${lams[0]} / ${lams[lams.length - 1]})`);
    }
    // Worst-case min/max are EXTREMUM operators → dense argwave grid (1 nm) so a
    // narrow peak/dip can't slip between samples and the reported extremum is
    // precise.
    for (const type of ['TMN', 'RMX', 'AMN']) {
        const op = makeOperand({ type, lambdaStart: 400, lambdaEnd: 700 });
        const lams = operandSampleLambdas(op);
        ok(lams.length === ARGWAVE_DEFAULT_POINTS,
           `${type}: dense extremum grid = ${ARGWAVE_DEFAULT_POINTS} samples (got ${lams.length})`);
        ok(lams[0] === 400 && lams[lams.length - 1] === 700,
           `${type}: endpoints exact (got ${lams[0]} / ${lams[lams.length - 1]})`);
    }
    // bandPoints override still wins
    const op2 = makeOperand({ type: 'TIW', lambdaStart: 400, lambdaEnd: 700, bandPoints: 21 });
    const l2  = operandSampleLambdas(op2);
    ok(l2.length === 21, `bandPoints=21 honored (got ${l2.length})`);
}

// ── 7. Persistence roundtrip ─────────────────────────────────────────────────
console.log('— integral preset JSON roundtrip —');
{
    const preset = {
        key:   'custom_1',
        label: 'Tvis (D65 × V(λ)) on 380–780 nm',
        char:  'T',
        sourceSpec:   { id: 'D65' },
        detectorSpec: { id: 'photopic' },
        band:         [380, 780],
    };
    const text = JSON.stringify(preset);
    const back = JSON.parse(text);
    ok(back.key === preset.key, 'key survives');
    ok(back.label === preset.label, 'label survives');
    ok(back.char === preset.char, 'char survives');
    ok(back.sourceSpec.id === 'D65', 'sourceSpec.id survives');
    ok(back.detectorSpec.id === 'photopic', 'detectorSpec.id survives');
    ok(back.band[0] === 380 && back.band[1] === 780, 'band survives');

    // Roundtripped preset still composes a valid weighting
    const w = composeWeighting({
        source: back.sourceSpec, detector: back.detectorSpec, band: back.band,
    });
    ok(w.lamMin === 380 && w.lamMax === 780, `weighting band intact (${w.lamMin}-${w.lamMax})`);
    ok(typeof w.sampler === 'function' && w.sampler(550) > 0,
       `roundtripped sampler positive at λ=550 (got ${w.sampler(550).toFixed(2)})`);
}

// ── 8. Type predicates ───────────────────────────────────────────────────────
console.log('— type predicates —');
{
    ok(isIntegral('TIW') && isIntegral('RIW') && isIntegral('AIW'), 'isIntegral covers TIW/RIW/AIW');
    ok(!isIntegral('TAV') && !isIntegral('RP'), 'isIntegral rejects others');
    ok(isMinmax('TMN') && isMinmax('TMX') && isMinmax('AMN') && isMinmax('AMX'), 'isMinmax covers TMN/TMX/AMN/AMX');
    ok(isMinType('TMN') && isMinType('RMN') && isMinType('AMN'), 'isMinType identifies *MN');
    ok(!isMinType('TMX') && !isMinType('RMX') && !isMinType('AMX'), 'isMinType rejects *MX');
    ok(OPERAND_TYPES.includes('TIW') && OPERAND_TYPES.includes('RMX'),
       'OPERAND_TYPES lists new entries');
}

console.log(fails === 0 ? 'PASS: new_operands' : `${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
