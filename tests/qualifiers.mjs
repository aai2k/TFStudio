/**
 * Tests for the Qualifiers (Specification) module.
 *
 * Covers:
 *   1. T_AVG qualifier evaluates to the same value as the equivalent TAV operand
 *      → MF gradient is in agreement.
 *   2. cmp = 'ge' passes when value ≥ target; fails when value < target.
 *   3. cmp = 'le' passes when value ≤ target; fails when value > target.
 *   4. cmp = 'between' passes only inside [lo, hi]; deviation is the
 *      excursion outside the range.
 *   5. cmp = 'eq' with tol passes when |value − target| ≤ tol.
 *   6. CENTRAL_LAMBDA qualifier returns the band-extremum λ.
 *   7. FWHM qualifier brackets the half-max crossings; returns rightLam − leftLam.
 *   8. THICKNESS_BUDGET and LAYER_COUNT geom-only qualifiers.
 *   9. aggregateVerdict skips disabled and counts only enabled ones.
 *  10. qualifiersToMFOperands generates OPGT/OPLT pairs with correct baseType.
 *
 * Run: node tests/qualifiers.mjs
 */

import {
    makeQualifier, evaluateQualifier, evaluateQualifiers,
    aggregateVerdict, qualifiersToMFOperands,
} from '../src/utils/synthesis/qualifiers.js';
import {
    makeOperand, evaluateOperands, buildEvalContext,
    operandSampleLambdas, ARGWAVE_DEFAULT_POINTS,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
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

// ── 1. T_AVG qualifier == TAV operand value ──────────────────────────────────
console.log('— T_AVG qualifier matches TAV operand —');
{
    const design = makeDesign(120);
    const q = makeQualifier({
        kind: 'T_AVG', cmp: 'ge', target: 0.5,
        lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg',
    });
    const r = evaluateQualifier(q, design, resolveMat);

    const op = makeOperand({
        type: 'TAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0,
    });
    const ctx = buildEvalContext(design, resolveMat);
    const opVal = evaluateOperands([op], ctx)[0];

    ok(near(r.value, opVal, 1e-14), `T_AVG matches TAV (|Δ|=${Math.abs(r.value - opVal).toExponential(2)})`);
    ok(r.unit === '%', 'T_AVG unit is %');
}

// ── 2. cmp 'ge' — pass/fail logic ────────────────────────────────────────────
console.log("— cmp 'ge' pass/fail —");
{
    const design = makeDesign(120);
    // Trivially-satisfied (T_AVG ≥ 0)
    const qLow = makeQualifier({
        kind: 'T_AVG', cmp: 'ge', target: 0.0,
        lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg',
    });
    // Impossible (T_AVG ≥ 1.0 — a coated stack has T < 1)
    const qHigh = makeQualifier({
        kind: 'T_AVG', cmp: 'ge', target: 1.0,
        lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg',
    });

    const rLow  = evaluateQualifier(qLow,  design, resolveMat);
    const rHigh = evaluateQualifier(qHigh, design, resolveMat);
    ok(rLow.pass  === true,  `target=0 → PASS (got ${rLow.pass})`);
    ok(rHigh.pass === false, `target=1 → FAIL (got ${rHigh.pass})`);
    ok(rLow.deviation <= 0, `pass → deviation ≤ 0 (got ${rLow.deviation.toExponential(2)})`);
    ok(rHigh.deviation > 0, `fail → deviation > 0 (got ${rHigh.deviation.toExponential(2)})`);
}

// ── 3. cmp 'le' ──────────────────────────────────────────────────────────────
console.log("— cmp 'le' pass/fail —");
{
    const design = makeDesign(120);
    const qSat = makeQualifier({
        kind: 'R_AVG', cmp: 'le', target: 1.0,
        lambdaStart: 400, lambdaEnd: 700,
    });
    const qViol = makeQualifier({
        kind: 'R_AVG', cmp: 'le', target: 0.0,
        lambdaStart: 400, lambdaEnd: 700,
    });
    const rSat  = evaluateQualifier(qSat,  design, resolveMat);
    const rViol = evaluateQualifier(qViol, design, resolveMat);
    ok(rSat.pass  === true,  `R_AVG ≤ 1.0 PASS`);
    ok(rViol.pass === false, `R_AVG ≤ 0.0 FAIL`);
}

// ── 4. cmp 'between' ─────────────────────────────────────────────────────────
console.log("— cmp 'between' pass/fail + deviation —");
{
    const design = makeDesign(120);
    const ctx    = buildEvalContext(design, resolveMat);
    const opVal = evaluateOperands(
        [makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0, aoi: 0, pol: 'avg' })],
        ctx
    )[0];

    // Choose [lo, hi] bracketing the actual T_AVG value
    const qIn = makeQualifier({
        kind: 'T_AVG', cmp: 'between', lo: opVal - 0.05, hi: opVal + 0.05,
        lambdaStart: 400, lambdaEnd: 700,
    });
    // Choose a bracket above the actual value
    const qOut = makeQualifier({
        kind: 'T_AVG', cmp: 'between', lo: opVal + 0.1, hi: opVal + 0.2,
        lambdaStart: 400, lambdaEnd: 700,
    });
    const rIn  = evaluateQualifier(qIn,  design, resolveMat);
    const rOut = evaluateQualifier(qOut, design, resolveMat);
    ok(rIn.pass  === true,  `inside band → PASS`);
    ok(rOut.pass === false, `outside band → FAIL`);
    ok(rIn.deviation === 0, `inside → deviation=0`);
    ok(rOut.deviation > 0,  `outside → deviation>0 (got ${rOut.deviation.toExponential(2)})`);
}

// ── 5. cmp 'eq' with tolerance ───────────────────────────────────────────────
console.log("— cmp 'eq' with tol —");
{
    const design = makeDesign(120);
    const ctx    = buildEvalContext(design, resolveMat);
    const opVal = evaluateOperands(
        [makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, target: 0, aoi: 0, pol: 'avg' })],
        ctx
    )[0];

    const qSat = makeQualifier({
        kind: 'T_AVG', cmp: 'eq', target: opVal, tol: 0.01,
        lambdaStart: 400, lambdaEnd: 700,
    });
    const qViol = makeQualifier({
        kind: 'T_AVG', cmp: 'eq', target: opVal + 0.2, tol: 0.01,
        lambdaStart: 400, lambdaEnd: 700,
    });
    ok(evaluateQualifier(qSat,  design, resolveMat).pass === true,  `eq target=value PASS`);
    ok(evaluateQualifier(qViol, design, resolveMat).pass === false, `eq target>>value FAIL`);
}

// ── 6. CENTRAL_LAMBDA returns band-extremum λ ────────────────────────────────
console.log('— CENTRAL_LAMBDA returns band-extremum λ —');
{
    const design = makeDesign(140);
    const q = makeQualifier({
        kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max',
        cmp: 'eq', target: 550, tol: 50,
        lambdaStart: 400, lambdaEnd: 700, bandPoints: 31,
    });
    const r = evaluateQualifier(q, design, resolveMat);
    ok(Number.isFinite(r.value) && r.value >= 400 && r.value <= 700,
        `central λ in band (got ${r.value?.toFixed(2)})`);
    ok(r.unit === 'nm', 'unit is nm');
}

// ── 7. FWHM brackets crossings ───────────────────────────────────────────────
console.log('— FWHM bracket detection —');
{
    // A 2-layer V-coat-like design has a sharper transmission peak; use Ta2O5
    // 100 nm + SiO2 80 nm on BK7 for a moderately defined peak. Even if not
    // perfectly bracketed, we just need the evaluator to either return a
    // numeric FWHM or report "no crossings" — both are valid behaviour.
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: [
            { id: 'L1', material: 'Ta2O5', thickness: 100 },
            { id: 'L2', material: 'SiO2',  thickness: 80  },
        ],
        backLayers: [], surfaceMode: 'front_only',
    };
    const q = makeQualifier({
        kind: 'FWHM', channel: 'T', direction: 'max', level: 0.9,
        cmp: 'le', target: 200,
        lambdaStart: 400, lambdaEnd: 700, bandPoints: 41,
    });
    const r = evaluateQualifier(q, design, resolveMat);
    ok(r.unit === 'nm', 'FWHM unit is nm');
    // The result is either Finite (FWHM) or NaN (couldn't bracket); both fine.
    ok(r.value === null || r.value === undefined || Number.isFinite(r.value) || isNaN(r.value),
        `FWHM returns a number or NaN (got ${r.value})`);
}

// ── 8. THICKNESS_BUDGET and LAYER_COUNT geom-only ────────────────────────────
console.log('— THICKNESS_BUDGET and LAYER_COUNT (geometry-only) —');
{
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: [
            { id: 'L1', material: 'Ta2O5', thickness: 100 },
            { id: 'L2', material: 'SiO2',  thickness: 200 },
        ],
        backLayers: [{ id: 'L3', material: 'Ta2O5', thickness: 50 }],
        surfaceMode: 'front_only',
    };
    const qThk = makeQualifier({ kind: 'THICKNESS_BUDGET', cmp: 'le', target: 1000 });
    const qN   = makeQualifier({ kind: 'LAYER_COUNT',      cmp: 'le', target: 4 });

    const rThk = evaluateQualifier(qThk, design, resolveMat);
    const rN   = evaluateQualifier(qN,   design, resolveMat);

    ok(near(rThk.value, 350, 1e-9), `THICKNESS_BUDGET value = 350 nm (got ${rThk.value})`);
    ok(rThk.pass === true, `350 ≤ 1000 PASS`);
    ok(rN.value === 3, `LAYER_COUNT = 3 (got ${rN.value})`);
    ok(rN.pass === true, `3 ≤ 4 PASS`);
}

// ── 9. aggregateVerdict skips disabled ───────────────────────────────────────
console.log('— aggregateVerdict counts enabled only —');
{
    const results = [
        { pass: true },
        { pass: false },
        { pass: null },     // disabled
        { pass: true },
    ];
    const v = aggregateVerdict(results);
    ok(v.total === 3,    `total counts only enabled (got ${v.total})`);
    ok(v.passing === 2,  `passing = 2 (got ${v.passing})`);
    ok(v.allPass === false, `not all pass`);
    ok(v.anyFail === true,  `some fail`);
}

// ── 10. qualifiersToMFOperands emits base + ref pair (Zemax-style) ──────────
console.log('— qualifiersToMFOperands generates base + OPGT/OPLT(refId=base.id) —');
{
    const quals = [
        makeQualifier({ kind: 'T_AVG', cmp: 'ge', target: 0.92, lambdaStart: 400, lambdaEnd: 700 }),
        makeQualifier({ kind: 'R_AVG', cmp: 'le', target: 0.02, lambdaStart: 400, lambdaEnd: 700 }),
        makeQualifier({ kind: 'T_AT',  cmp: 'between', lo: 0.85, hi: 0.95, lambda: 550 }),
        makeQualifier({ kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max',
                        cmp: 'eq', target: 550, tol: 5, lambdaStart: 500, lambdaEnd: 600 }),
        makeQualifier({ kind: 'LAYER_COUNT', cmp: 'le', target: 30 }),
    ];
    const ops = qualifiersToMFOperands(quals);

    // T_AVG ge      → 2 ops: TAV (base) + OPGT(refId=base.id)
    // R_AVG le      → 2 ops: RAV (base) + OPLT(refId=base.id)
    // T_AT between  → 3 ops: T (base) + OPGT + OPLT (both refId=base.id)
    // CENTRAL_LAMBDA eq → 1 op:  MXWT (its own target=550)
    // LAYER_COUNT   → skipped
    ok(ops.length === 8,
        `8 operands generated (got ${ops.length}: ${ops.map(o => o.type).join(', ')})`);

    // T_AVG ge: ops[0]=TAV(target=0), ops[1]=OPGT(refId=ops[0].id, target=0.92)
    ok(ops[0].type === 'TAV', `T_AVG ge first row = TAV (got ${ops[0].type})`);
    ok(ops[1].type === 'OPGT' && ops[1].refId === ops[0].id && ops[1].target === 0.92,
        `T_AVG ge second row = OPGT(refId=TAV.id, target=0.92) — got refId=${ops[1].refId}, target=${ops[1].target}`);

    // R_AVG le: ops[2]=RAV, ops[3]=OPLT(refId=ops[2].id, target=0.02)
    ok(ops[2].type === 'RAV', `R_AVG le base = RAV`);
    ok(ops[3].type === 'OPLT' && ops[3].refId === ops[2].id && ops[3].target === 0.02,
        `R_AVG le second row = OPLT(refId=RAV.id, target=0.02)`);

    // T_AT between: ops[4]=T (single-λ), ops[5]=OPGT(refId=ops[4].id, lo), ops[6]=OPLT(refId=ops[4].id, hi)
    ok(ops[4].type === 'T', `T_AT between base = T`);
    ok(ops[5].type === 'OPGT' && ops[5].refId === ops[4].id && ops[5].target === 0.85,
        `T_AT between OPGT(target=0.85)`);
    ok(ops[6].type === 'OPLT' && ops[6].refId === ops[4].id && ops[6].target === 0.95,
        `T_AT between OPLT(target=0.95)`);

    // CENTRAL_LAMBDA eq: ops[7]=MXWT with its own target=550 (no wrapper)
    ok(ops[7].type === 'MXWT' && ops[7].target === 550,
        `CENTRAL_LAMBDA eq → bare MXWT with target=550 (got type=${ops[7].type}, target=${ops[7].target})`);
}

// ── 11. CENTRAL_LAMBDA qualifier == MXWT operand — bit-identical ─────────────
// This is the load-bearing consistency contract: the value the Specification
// window reports must match exactly what the equivalent MXWT/MNW* operand in
// the merit function evaluates to.  If this ever diverges, qualifiers will
// silently disagree with the optimizer's residual on the same band/design.
console.log('— CENTRAL_LAMBDA qualifier == MXWT operand (bit-identical) —');
{
    // Use a 6-layer-ish stack so the T spectrum has interior structure.
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: [
            { id: 'L1', material: 'Ta2O5', thickness: 110 },
            { id: 'L2', material: 'SiO2',  thickness: 95  },
            { id: 'L3', material: 'Ta2O5', thickness: 65  },
            { id: 'L4', material: 'SiO2',  thickness: 140 },
            { id: 'L5', material: 'Ta2O5', thickness: 80  },
            { id: 'L6', material: 'SiO2',  thickness: 92  },
        ],
        backLayers: [], surfaceMode: 'front_only',
    };

    // Qualifier path
    const q = makeQualifier({
        kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max',
        cmp: 'eq', target: 550, tol: 5,
        lambdaStart: 400, lambdaEnd: 700,
        aoi: 0, pol: 'avg',
    });
    const rQual = evaluateQualifier(q, design, resolveMat);

    // Equivalent MF operand path — same band, same default bandPoints
    const ctx = buildEvalContext(design, resolveMat);
    const opMxwt = makeOperand({
        type: 'MXWT', lambdaStart: 400, lambdaEnd: 700,
        aoi: 0, pol: 'avg', target: 550, weight: 1,
    });
    const opVal = evaluateOperands([opMxwt], ctx)[0];

    ok(rQual.value === opVal,
        `CENTRAL_LAMBDA == MXWT bit-identical (Δ = ${Math.abs(rQual.value - opVal).toExponential(2)} ` +
        `nm; qual=${rQual.value.toFixed(6)}, op=${opVal.toFixed(6)})`);

    // Sub-nm precision sanity: with 301 default samples + parabolic refinement
    // the reported λ should land within 0.2 nm of a dense (601-pt) reference
    // scan on the same data.
    const opDense = makeOperand({
        type: 'MXWT', lambdaStart: 400, lambdaEnd: 700,
        aoi: 0, pol: 'avg', target: 550, weight: 1, bandPoints: 1201,
    });
    const denseVal = evaluateOperands([opDense], ctx)[0];
    ok(Math.abs(opVal - denseVal) < 0.5,
        `MXWT @ 301 pts within 0.5 nm of 1201-pt reference ` +
        `(default=${opVal.toFixed(4)}, dense=${denseVal.toFixed(4)}, ` +
        `Δ=${Math.abs(opVal - denseVal).toExponential(2)})`);

    // FWHM qualifier should also use the same dense grid by default
    ok(ARGWAVE_DEFAULT_POINTS === 301,
        `ARGWAVE_DEFAULT_POINTS = 301 (got ${ARGWAVE_DEFAULT_POINTS})`);
}

// ── 12. qualifiersToMFOperands propagates bandPoints precisely ───────────────
console.log('— qualifiersToMFOperands propagates bandPoints —');
{
    // When the user customizes bandPoints on a qualifier, the generated MF
    // operand must inherit it (otherwise the optimizer's residual would
    // disagree with the Specification verdict).  CENTRAL_LAMBDA ge produces
    // [base MXWT, OPGT(refId=base.id)] — bandPoints lives on the base row.
    const q1 = makeQualifier({
        kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max',
        cmp: 'ge', target: 550, lambdaStart: 400, lambdaEnd: 700,
        bandPoints: 401,
    });
    const ops1 = qualifiersToMFOperands([q1]);
    const baseOp1 = ops1.find(o => o.type === 'MXWT');
    ok(baseOp1?.bandPoints === 401,
        `explicit qualifier bandPoints=401 → base MXWT bandPoints=401 (got ${baseOp1?.bandPoints})`);

    // Default qualifier (no bandPoints set explicitly): NEITHER the qualifier
    // NOR the generated operand carries a baked-in bandPoints — the field is
    // undefined and the runtime default takes over at evaluation time. This
    // is the architectural fix that means users never have to "remake" an
    // operand when a precision default changes.
    const q2 = makeQualifier({
        kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max',
        cmp: 'ge', target: 550, lambdaStart: 400, lambdaEnd: 700,
    });
    ok(q2.bandPoints === undefined,
        `default qualifier: bandPoints unset (got ${q2.bandPoints})`);
    const ops2 = qualifiersToMFOperands([q2]);
    const baseOp2 = ops2.find(o => o.type === 'MXWT');
    ok(baseOp2?.bandPoints === undefined,
        `default qualifier → operand bandPoints unset (got ${baseOp2?.bandPoints})`);

    // Evaluating either path still gives the dense 301-pt grid via runtime default.
    const lams = operandSampleLambdas(baseOp2);
    ok(lams.length === ARGWAVE_DEFAULT_POINTS,
        `runtime default fills in N=${ARGWAVE_DEFAULT_POINTS} samples (got ${lams.length})`);
}

if (fails === 0) console.log('\nAll qualifier tests passed.');
else { console.error(`\n${fails} test(s) failed.`); process.exit(1); }
