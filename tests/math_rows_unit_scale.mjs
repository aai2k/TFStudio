/**
 * A math row scores a miss in the unit of the value it reads.
 *
 * Every residual is divided by its row's unit scale σ before it enters the
 * merit: 500 nm for MXW/MNW, 4.343 dB for the dB rows, 1 for T, R and A. With
 * σ = 1 on a math row, an OPLT on an MXWT row 10 nm over would score 10 where
 * the MXWT row itself scores the same miss as 0.02, and bury every optical row
 * beside it. OpticStudio, measured through its API, scores an OPVA or OPLT on a
 * row exactly as that row with the same target.
 *
 *   1. A row reading one other row scores like that row: OPVA on MXWT against
 *      an MXWT row with the same target, OPLT on MXWT, OPGT on a dB row, OPLT
 *      on a T row unchanged.
 *   2. DIFF and SUMM of two rows on the same σ take it; of two different σ,
 *      σ = 1. PROD takes σ₁·σ₂.
 *   3. A math row reading a math row follows it, and a long chain that reads
 *      each row twice is quick; a loop of references and a missing row give 1;
 *      an OPGT saved with `baseType` reads that type's σ.
 *   4. The share column and the optimizer's residuals use the same σ as the
 *      merit.
 *
 * Run: node tests/math_rows_unit_scale.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';

const {
    makeOperand, calcMF, operandContributions, residualScaleIn, evaluateOperands,
    buildEvalContext, DLSOptimizer,
} = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');

const near = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);

const SIGMA_DB = 10 / Math.LN10;
const mxwt = (target = 0, weight = 0) => makeOperand({ type: 'MXWT', lambdaStart: 500, lambdaEnd: 600, target, weight });
const tdbmn = () => makeOperand({ type: 'TDBMN', lambdaStart: 500, lambdaEnd: 600, target: 0, weight: 0 });
const tRow = () => makeOperand({ type: 'T', lambdaStart: 550, lambdaEnd: 550, target: 0, weight: 0 });
const math = (type, refs, target) => makeOperand({ type, ...refs, target, weight: 1 });

// ── 1. A row reading one other row ───────────────────────────────────────────
{
    const peak = mxwt();
    const direct = mxwt(550, 1);
    near(calcMF([peak, math('OPVA', { refId: peak.id }, 550)], [555, 555]), calcMF([direct], [555]),
        'OPVA on MXWT 5 nm off scores as the MXWT row with that target');
    near(calcMF([peak, math('OPLT', { refId: peak.id }, 550)], [560, 560]), 10 / 500, 'OPLT on MXWT 10 nm over scores 0.02');
    const db = tdbmn();
    near(calcMF([db, math('OPGT', { refId: db.id }, -10)], [-12, -12]), 2 / SIGMA_DB, 'OPGT on TDBMN 2 dB under scores 2/4.343');
    const t = tRow();
    near(calcMF([t, math('OPLT', { refId: t.id }, 0.01)], [0.02, 0.02]), 0.01, 'OPLT on T 1 % over still scores 0.01');
}

// ── 2. Two references ────────────────────────────────────────────────────────
{
    const a = mxwt(), b = mxwt(), t = tRow(), db = tdbmn();
    const scaleOf = rows => residualScaleIn(rows)(rows.at(-1));
    assert.equal(scaleOf([a, b, math('DIFF', { refId1: a.id, refId2: b.id }, 0)]), 500, 'DIFF of two MXWT rows: 500 nm');
    assert.equal(scaleOf([a, b, math('SUMM', { refId1: a.id, refId2: b.id }, 0)]), 500, 'SUMM of two MXWT rows: 500 nm');
    assert.equal(scaleOf([a, t, math('DIFF', { refId1: a.id, refId2: t.id }, 0)]), 1, 'DIFF of nm and a fraction: 1');
    assert.equal(scaleOf([a, db, math('SUMM', { refId1: a.id, refId2: db.id }, 0)]), 1, 'SUMM of nm and dB: 1');
    near(scaleOf([a, db, math('PROD', { refId1: a.id, refId2: db.id }, 0)]), 500 * SIGMA_DB, 'PROD of nm and dB: 500·4.343');
    assert.equal(scaleOf([t, t, math('PROD', { refId1: t.id, refId2: t.id }, 0)]), 1, 'PROD of two T rows: 1');
    const spacing = math('DIFF', { refId1: a.id, refId2: b.id }, 0.8);
    near(calcMF([a, b, spacing], [550, 549, 1]), 0.2 / 500, 'a channel spacing 0.2 nm off scores 0.2/500');
}

// ── 3. Chains, loops, missing rows, rows saved by type ───────────────────────
{
    const a = mxwt(), b = mxwt();
    const diff = math('DIFF', { refId1: a.id, refId2: b.id }, 0);
    const bound = math('OPGT', { refId: diff.id }, 1);
    assert.equal(residualScaleIn([a, b, diff, bound])(bound), 500, 'OPGT on a DIFF of two MXWT rows: 500 nm');
    const both = math('PROD', { refId1: diff.id, refId2: diff.id }, 0);
    assert.equal(residualScaleIn([a, b, diff, both])(both), 500 * 500, 'the same math row read twice counts twice');
    const first = math('OPVA', { refId: 'second' }, 0);
    const second = { ...math('OPVA', { refId: first.id }, 0), id: 'second' };
    assert.equal(residualScaleIn([first, second])(first), 1, 'a loop of references gives 1');
    const orphan = math('OPVA', { refId: 'gone' }, 0);
    assert.equal(residualScaleIn([orphan])(orphan), 1, 'a reference to a missing row gives 1');
    const legacy = { ...math('OPGT', {}, 0), refId: undefined, baseType: 'MXWT', lambdaStart: 500, lambdaEnd: 600 };
    assert.equal(residualScaleIn([legacy])(legacy), 500, 'an OPGT saved with baseType MXWT reads 500 nm');
    // 60 rows, each the SUMM of the row before it with itself: read naively
    // that is 2⁶⁰ visits to the first row.
    const chain = [mxwt()];
    for (let i = 0; i < 60; i++) chain.push(math('SUMM', { refId1: chain.at(-1).id, refId2: chain.at(-1).id }, 0));
    const started = performance.now();
    assert.equal(residualScaleIn(chain)(chain.at(-1)), 500, 'a chain of 60 SUMM rows on MXWT reads 500 nm');
    assert.ok(performance.now() - started < 1000, 'and reads each row once');
}

// ── 4. Share column and optimizer residuals ──────────────────────────────────
{
    const t = makeOperand({ type: 'T', lambdaStart: 550, lambdaEnd: 550, target: 0.95, weight: 1 });
    const peak = mxwt();
    const bound = math('OPLT', { refId: peak.id }, 550);
    const shares = operandContributions([t, peak, bound], [0.94, 555, 555]);
    near(shares[0], 0.5, 'a T row 1 % off holds half the merit');
    near(shares[2], 0.5, 'and an OPLT on MXWT 5 nm over the other half');

    const design = {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: [
            { id: 'L1', material: 'Ta2O5', thickness: 120, locked: false },
            { id: 'L2', material: 'SiO2', thickness: 180, locked: false },
            { id: 'L3', material: 'Ta2O5', thickness: 95, locked: false },
        ],
        backLayers: [], surfaceMode: 'front_only',
    };
    const rows = [
        makeOperand({ type: 'TAV', lambdaStart: 450, lambdaEnd: 650, target: 0.9, weight: 1 }),
        mxwt(),
    ];
    rows.push(math('OPGT', { refId: rows[1].id }, 700));
    const resolveMat = id => getMaterial(id);
    const comp = evaluateOperands(rows, buildEvalContext(design, resolveMat));
    const optimizer = new DLSOptimizer(rows, JSON.parse(JSON.stringify(design)), resolveMat);
    const residuals = optimizer._residuals(optimizer.thicknesses);
    const sumW = rows.reduce((sum, op) => sum + op.weight, 0);
    near(Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / sumW), calcMF(rows, comp),
        'the optimizer minimizes the merit it reports, with the math row at 500 nm');
}

console.log('math_rows_unit_scale: passed');
