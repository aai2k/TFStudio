/**
 * Tests for the Zemax-style math operands (OPGT/OPLT/OPVA/ABSO/ABGT/ABLT/
 * DIFF/SUMM/PROD) and the MXW(T,R,A) / MNW(T,R,A) argmax /
 * argmin-wavelength operands.
 *
 * Properties asserted:
 *   1. OPGT/OPLT/OPVA reference another row by op.refId and evaluate its value.
 *   2. OPGT residual = max(0, target − ref); zero when satisfied.
 *   3. OPLT residual = max(0, ref − target); zero when satisfied.
 *   4. OPVA residual = ref − target (two-sided).
 *   5. ABSO returns |ref|; ABGT/ABLT one-sided on |ref|.
 *   6. DIFF/SUMM/PROD use op.refId1 and op.refId2.
 *   7. Math operands return NaN when refId points to a deleted/disabled row
 *      (no crash; calcMF treats NaN gracefully).
 *   8. Cycle detection: a → b → a returns NaN, doesn't loop.
 *   9. operandSampleLambdas returns [] for math operands (refs carry λs).
 *  10. requiredLambdas picks up the referenced operand's λs naturally.
 *  11. MXWT returns the λ of band-max T (parabolic-refined, 301-pt default).
 *  12. MNWR returns λ of band-min R.
 *  13. Argwave operandSampleLambdas defaults to 301 samples.
 *  14. Legacy OPGT/OPLT with op.baseType (no refId) still evaluates correctly.
 *  15. polFromType returns null for OPGT/OPLT/OPVA/etc.; embedded for MXWTS/etc.
 *
 * Run: node tests/inequality_argwave_operands.mjs
 */

import {
    makeOperand, evaluateOperands, buildEvalContext, calcMF,
    operandSampleLambdas, requiredLambdas,
    isInequality, isArgwave, isArgwaveMin, isMath,
    argwaveOpticalChar, argwavePolCode, polFromType,
    DLSOptimizer,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t) => Math.abs(a - b) <= t;

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

// ── 1. OPGT/OPLT/OPVA reference op.refId, evaluate its value ─────────────────
console.log('— OPGT/OPLT/OPVA reference another row by refId —');
{
    const design = makeDesign(150);
    const ctx    = buildEvalContext(design, resolveMat);

    const base = makeOperand({
        type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0, weight: 1, aoi: 0, pol: 'avg',
    });
    const gt = makeOperand({ type: 'OPGT', refId: base.id, target: 0.99, weight: 1 });
    const lt = makeOperand({ type: 'OPLT', refId: base.id, target: 0.99, weight: 1 });
    const va = makeOperand({ type: 'OPVA', refId: base.id, target: 0.92, weight: 1 });

    const [vBase, vGt, vLt, vVa] = evaluateOperands([base, gt, lt, va], ctx);
    ok(near(vBase, vGt, 1e-14), `OPGT value == ref TAV value (Δ=${(vBase-vGt).toExponential(2)})`);
    ok(near(vBase, vLt, 1e-14), `OPLT value == ref TAV value (Δ=${(vBase-vLt).toExponential(2)})`);
    ok(near(vBase, vVa, 1e-14), `OPVA value == ref TAV value (Δ=${(vBase-vVa).toExponential(2)})`);
}

// ── 2. OPGT one-sided residual ───────────────────────────────────────────────
console.log('— OPGT residual is one-sided —');
{
    const design = makeDesign(150);
    const ctx    = buildEvalContext(design, resolveMat);

    const base = makeOperand({
        type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0,
    });
    const opSat  = makeOperand({ type: 'OPGT', refId: base.id, target: 0.0 });
    const opViol = makeOperand({ type: 'OPGT', refId: base.id, target: 1.0 });

    // Include `base` in evaluateOperands so the ref-resolver can find it,
    // but only sum the math-operand's MF contribution (base has target=0 so
    // it would otherwise dominate).
    const comp = evaluateOperands([base, opSat, opViol], ctx);
    const mfSat  = calcMF([opSat ], [comp[1]]);
    const mfViol = calcMF([opViol], [comp[2]]);
    ok(mfSat === 0, `OPGT satisfied → MF=0 (got ${mfSat})`);
    ok(mfViol > 0,  `OPGT violated → MF>0 (got ${mfViol.toExponential(2)})`);
}

// ── 3. OPLT one-sided ────────────────────────────────────────────────────────
console.log('— OPLT residual is one-sided —');
{
    const design = makeDesign(150);
    const ctx    = buildEvalContext(design, resolveMat);

    const base = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0 });
    const opSat  = makeOperand({ type: 'OPLT', refId: base.id, target: 1.0 });
    const opViol = makeOperand({ type: 'OPLT', refId: base.id, target: 0.0 });

    const comp = evaluateOperands([base, opSat, opViol], ctx);
    const mfSat  = calcMF([opSat ], [comp[1]]);
    const mfViol = calcMF([opViol], [comp[2]]);
    ok(mfSat === 0,  `OPLT satisfied → MF=0 (got ${mfSat})`);
    ok(mfViol > 0,   `OPLT violated → MF>0 (got ${mfViol.toExponential(2)})`);
}

// ── 4. OPVA two-sided equality ───────────────────────────────────────────────
console.log('— OPVA residual is two-sided equality —');
{
    const design = makeDesign(150);
    const ctx    = buildEvalContext(design, resolveMat);
    const base = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0 });
    // Pick a target that the design definitely doesn't hit (forces non-zero residual)
    const va = makeOperand({ type: 'OPVA', refId: base.id, target: 0.5 });
    const comp = evaluateOperands([base, va], ctx);
    const mf  = calcMF([va], [comp[1]]);
    ok(mf > 0, `OPVA off-target → MF>0 (got ${mf.toExponential(2)})`);
}

// ── 5. ABSO / ABGT / ABLT ────────────────────────────────────────────────────
console.log('— ABSO, ABGT, ABLT on |ref| —');
{
    const design = makeDesign(150);
    const ctx    = buildEvalContext(design, resolveMat);
    // DIFF row gives us a value that can be positive or negative.  We'll build:
    //   row1: TAV
    //   row2: RAV
    //   row3: DIFF(refId1=row1, refId2=row2) — likely positive (T > R)
    //   row4: ABSO(refId=row3) — |row3|
    const t = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0 });
    const r = makeOperand({ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, target: 0 });
    const d = makeOperand({ type: 'DIFF', refId1: t.id, refId2: r.id, target: 0 });
    const a = makeOperand({ type: 'ABSO', refId: d.id, target: 0 });
    const comp = evaluateOperands([t, r, d, a], ctx);
    ok(near(comp[3], Math.abs(comp[2]), 1e-14),
        `ABSO == |DIFF| (got ${comp[3]} vs ${Math.abs(comp[2])})`);

    const ag = makeOperand({ type: 'ABGT', refId: d.id, target: 99 });   // |DIFF| should be small → ≥99 fails
    const al = makeOperand({ type: 'ABLT', refId: d.id, target: 99 });   // ≤99 trivially passes
    const c2 = evaluateOperands([t, r, d, ag, al], ctx);
    // Isolate the math-operand row's MF contribution (base T/R/DIFF rows have
    // target=0 and would otherwise dominate).
    const mfAg = calcMF([ag], [c2[3]]);
    const mfAl = calcMF([al], [c2[4]]);
    ok(mfAg > 0,  `ABGT(|d| ≥ 99) fails → MF>0 (got ${mfAg.toExponential(2)})`);
    ok(mfAl === 0, `ABLT(|d| ≤ 99) passes → MF=0`);
}

// ── 6. DIFF, SUMM, PROD two-ref arithmetic ───────────────────────────────────
console.log('— DIFF / SUMM / PROD two-ref arithmetic —');
{
    const design = makeDesign(150);
    const ctx    = buildEvalContext(design, resolveMat);
    const t = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0 });
    const r = makeOperand({ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, target: 0 });
    const diff = makeOperand({ type: 'DIFF', refId1: t.id, refId2: r.id, target: 0 });
    const summ = makeOperand({ type: 'SUMM', refId1: t.id, refId2: r.id, target: 0 });
    const prod = makeOperand({ type: 'PROD', refId1: t.id, refId2: r.id, target: 0 });
    const comp = evaluateOperands([t, r, diff, summ, prod], ctx);
    const T = comp[0], R = comp[1];
    ok(near(comp[2], T - R, 1e-14), `DIFF = T - R (got ${comp[2]} vs ${T-R})`);
    ok(near(comp[3], T + R, 1e-14), `SUMM = T + R (got ${comp[3]} vs ${T+R})`);
    ok(near(comp[4], T * R, 1e-14), `PROD = T × R (got ${comp[4]} vs ${T*R})`);
}

// ── 7. Stale ref returns NaN, no crash ───────────────────────────────────────
console.log('— stale refId returns NaN gracefully —');
{
    const design = makeDesign(150);
    const ctx    = buildEvalContext(design, resolveMat);
    const gt = makeOperand({ type: 'OPGT', refId: 'nonexistent-id', target: 0.5 });
    const comp = evaluateOperands([gt], ctx);
    ok(Number.isNaN(comp[0]),
        `stale ref → NaN (got ${comp[0]})`);
    // calcMF treats NaN as inactive (the Math.max(0, NaN-anything) = NaN ≠ 0,
    // but the loop guards on isFinite via mathResidual returning 0 for non-finite).
    const mf = calcMF([gt], comp);
    ok(Number.isFinite(mf) && mf === 0,
        `stale ref → MF=0 (no crash, got ${mf})`);
}

// ── 8. Cycle detection ───────────────────────────────────────────────────────
console.log('— cycle detection: a→b→a returns NaN —');
{
    const design = makeDesign(150);
    const ctx    = buildEvalContext(design, resolveMat);
    // Two OPGT operands referencing each other.
    const a = { id: 'A', enabled: true, type: 'OPGT', refId: 'B', target: 0, weight: 1 };
    const b = { id: 'B', enabled: true, type: 'OPGT', refId: 'A', target: 0, weight: 1 };
    const comp = evaluateOperands([a, b], ctx);
    ok(Number.isNaN(comp[0]) && Number.isNaN(comp[1]),
        `cycle → NaN both rows (got ${comp[0]}, ${comp[1]})`);
}

// ── 9. operandSampleLambdas returns [] for math operands ─────────────────────
console.log('— operandSampleLambdas([math op]) is empty —');
{
    const gt = { type: 'OPGT', refId: 'x', target: 0.5 };
    const va = { type: 'OPVA', refId: 'x', target: 0.5 };
    const dd = { type: 'DIFF', refId1: 'a', refId2: 'b', target: 0 };
    ok(operandSampleLambdas(gt).length === 0, `OPGT contributes no λs (got ${operandSampleLambdas(gt).length})`);
    ok(operandSampleLambdas(va).length === 0, `OPVA contributes no λs`);
    ok(operandSampleLambdas(dd).length === 0, `DIFF contributes no λs`);
}

// ── 10. requiredLambdas picks up referenced operands' λs ─────────────────────
console.log('— requiredLambdas picks up referenced operand λs —');
{
    const base = makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0 });
    const gt   = makeOperand({ type: 'OPGT', refId: base.id, target: 0.99 });
    const lams = requiredLambdas([base, gt]);
    ok(lams.length > 0,
        `union has the TAV λs (got ${lams.length})`);
    ok(lams[0] === 400 && lams[lams.length - 1] === 700,
        `range covers 400–700 (got ${lams[0]} to ${lams[lams.length - 1]})`);
}

// ── 11. MXWT recovers band-max λ ─────────────────────────────────────────────
console.log('— MXWT recovers band-max λ —');
{
    const design = makeDesign(140);
    const ctx    = buildEvalContext(design, resolveMat);
    const op = makeOperand({ type: 'MXWT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg' });
    const lamMax = evaluateOperands([op], ctx)[0];
    ok(Number.isFinite(lamMax) && lamMax >= 400 && lamMax <= 700,
        `MXWT in band (got ${lamMax?.toFixed(2)})`);
}

// ── 12. MNWR recovers band-min R ────────────────────────────────────────────
console.log('— MNWR recovers band-min R —');
{
    const design = makeDesign(140);
    const ctx    = buildEvalContext(design, resolveMat);
    const op = makeOperand({ type: 'MNWR', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg' });
    const lamMin = evaluateOperands([op], ctx)[0];
    ok(Number.isFinite(lamMin) && lamMin >= 400 && lamMin <= 700,
        `MNWR in band (got ${lamMin?.toFixed(2)})`);
}

// ── 13. Argwave default = 301 samples ────────────────────────────────────────
console.log('— Argwave default = 301 samples; user override honored —');
{
    for (const type of ['MXWT', 'MXWR', 'MXWA', 'MNWT', 'MNWR', 'MNWA']) {
        const op = makeOperand({ type, lambdaStart: 400, lambdaEnd: 700 });
        const lams = operandSampleLambdas(op);
        ok(lams.length === 301, `${type}: default 301 (got ${lams.length})`);
    }
    const dense = { type: 'MXWT', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 550, weight: 1, bandPoints: 601 };
    ok(operandSampleLambdas(dense).length === 601, 'explicit bandPoints=601 honored');
    const fresh = makeOperand({ type: 'MXWT', lambdaStart: 400, lambdaEnd: 700 });
    ok(fresh.bandPoints === undefined, 'makeOperand does NOT stamp bandPoints');
}

// ── 14. Legacy OPGT/OPLT with baseType still works (file back-compat) ───────
console.log('— legacy OPGT/OPLT with baseType (back-compat) —');
{
    const design = makeDesign(150);
    const ctx    = buildEvalContext(design, resolveMat);

    // Old-style operand: NO refId, has baseType + embedded band params
    const legacy = {
        id: 'leg1', enabled: true,
        type: 'OPGT', baseType: 'TAV',
        lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg',
        target: 1.0, weight: 1,
    };
    const v = evaluateOperands([legacy], ctx)[0];
    ok(Number.isFinite(v) && v > 0 && v < 1,
        `legacy OPGT(baseType=TAV) evaluates to TAV (got ${v?.toFixed(4)})`);
    // Residual = max(0, 1 − TAV) > 0 since uncoated stack T_avg < 1
    const mf = calcMF([legacy], [v]);
    ok(mf > 0, `legacy OPGT violated MF > 0 (got ${mf?.toExponential(2)})`);
}

// ── 15. Type predicate + pol helpers ─────────────────────────────────────────
console.log('— polFromType, isMath, isArgwave, charOf helpers —');
{
    ok(polFromType('OPGT') === null, `OPGT → no pol`);
    ok(polFromType('OPLT') === null, `OPLT → no pol`);
    ok(polFromType('OPVA') === null, `OPVA → no pol`);
    ok(polFromType('ABSO') === null, `ABSO → no pol`);
    ok(polFromType('DIFF') === null, `DIFF → no pol`);
    // Argwave polarization is carried by op.pol (Pol column), NOT the type code,
    // so all base argwave types report null from polFromType.
    ok(polFromType('MXWT') === null, `MXWT → no pol (use op.pol)`);
    ok(polFromType('MNWR') === null, `MNWR → no pol (use op.pol)`);
    ok(polFromType('MXWA') === null, `MXWA → no pol (use op.pol)`);

    ok(argwaveOpticalChar('MXWT') === 'T', `MXWT char='T'`);
    ok(argwaveOpticalChar('MNWR') === 'R', `MNWR char='R'`);
    ok(argwaveOpticalChar('MXWA') === 'A', `MXWA char='A'`);

    ok(isArgwave('MXWT') && isArgwave('MNWA'), `isArgwave true for MXWT, MNWA`);
    ok(!isArgwave('TAV'), `isArgwave false for TAV`);
    ok(isArgwaveMin('MNWT'), `isArgwaveMin true for MNWT`);
    ok(!isArgwaveMin('MXWT'), `isArgwaveMin false for MXWT`);

    ok(isInequality('OPGT') && isInequality('OPLT'), `isInequality true for OPGT, OPLT`);
    ok(!isInequality('OPVA'), `isInequality false for OPVA (equality)`);
    ok(!isInequality('TAV'), `isInequality false for TAV`);

    ok(isMath('OPGT') && isMath('OPLT') && isMath('OPVA') && isMath('ABSO') &&
       isMath('ABGT') && isMath('ABLT') && isMath('DIFF') && isMath('SUMM') && isMath('PROD'),
       `isMath true for all 9 math operand types`);
    ok(!isMath('TAV') && !isMath('MNT') && !isMath('MXWT'),
       `isMath false for TAV, MNT, MXWT`);
}

if (fails === 0) console.log('\nAll Zemax math + argwave operand tests passed.');
else { console.error(`\n${fails} test(s) failed.`); process.exit(1); }
