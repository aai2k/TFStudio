/**
 * Per-operand share of the merit function.
 *
 * The merit table's contribution column replaced a Δ column that meant a
 * different thing on almost every row type. The number behind it has to hold up
 * to the claims made for it: that it is a share, that it sums to 100%, and that
 * it is a share of the same sum calcMF takes the root of, not an independent
 * calculation that can drift away from the merit it describes.
 *
 *   node tests/operand_contribution.mjs
 */

import assert from 'node:assert/strict';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import {
    buildEvalContext, calcMF, evaluateOperands, makeConstraintOperand, makeOperand,
    mfWeightDenominator,
    operandContributions,
} from '../src/utils/physics/optimizer.js';

const design = {
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { material: 'TiO2', thickness: 91.25 },
        { material: 'SiO2', thickness: 127.5 },
        { material: 'Ta2O5', thickness: 63.5 },
        { material: 'SiO2', thickness: 210.0 },
    ],
    backLayers: [],
    surfaceMode: 'front_only',
};

const ctx = buildEvalContext(design, designMaterialLookup(design));
const evaluate = operands => evaluateOperands(operands, ctx);
const close = (actual, expected, tolerance, message) => assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: got ${actual}, expected ${expected}`,
);

// A mixed table: optical rows, a band average, phase-dispersion rows in fs and
// fs², a flatness row whose value is already an RMS, and both kinds of
// manufacturability constraint.
const operands = [
    makeOperand({ type: 'RAV', lambdaStart: 500, lambdaEnd: 600, target: 1.0, weight: 1 }),
    makeOperand({ type: 'T', lambdaStart: 550, target: 0.995, weight: 2 }),
    // 500-825 nm is where every material in the stack carries third-order
    // derivatives; TiO2's table stops at 825 and Ta2O5's starts at 500.
    makeOperand({ type: 'GDD', lambdaStart: 700, target: -40, weight: 1 }),
    makeOperand({ type: 'GDDFLAT', lambdaStart: 600, lambdaEnd: 800, target: -40, weight: 1 }),
    makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 1, target: 10, weight: 1 }),
    makeOperand({ type: 'TT', target: 400, cmp: 'le', weight: 1 }),
];

// Guard against the constructors quietly falling back to their defaults, which
// would leave every assertion below testing a table of identical TAV rows.
assert.deepEqual(operands.map(op => op.type),
    ['RAV', 'T', 'GDD', 'GDDFLAT', 'MNT', 'TT'], 'the table is the one described above');

// ── It is a share ────────────────────────────────────────────────────────────
{
    const computed = evaluate(operands);
    const shares = operandContributions(operands, computed);
    assert.equal(shares.length, operands.length, 'one entry per row');
    const contributing = shares.filter(share => share != null);
    assert.ok(contributing.length > 0, 'something contributed');
    for (const share of contributing) {
        assert.ok(share >= 0 && share <= 1, `a share is within [0,1]: ${share}`);
    }
    close(contributing.reduce((sum, share) => sum + share, 0), 1, 1e-12,
        'shares sum to 100% across contributing rows');
}

// ── It is a share of the SAME sum calcMF takes the root of ───────────────────
// share_i x MF^2 x denom must reproduce the row's own weighted squared residual,
// which is the whole claim the column makes.
{
    const computed = evaluate(operands);
    const shares = operandContributions(operands, computed);
    const mf = calcMF(operands, computed);
    const denom = mfWeightDenominator(operands);
    const total = mf * mf * denom;

    // Rebuild each term the only other way available: remove the row and see how
    // much the weighted sum of squares drops.
    for (let i = 0; i < operands.length; i++) {
        if (shares[i] == null) continue;
        const without = operands.map((op, index) => (index === i ? { ...op, enabled: false } : op));
        const withoutComputed = evaluate(without);
        const withoutTotal = calcMF(without, withoutComputed) ** 2
            * mfWeightDenominator(without);
        const term = total - withoutTotal;
        close(shares[i], term / total, 1e-9,
            `row ${i} (${operands[i].type}) share matches what removing it removes`);
    }
}

// ── An operand exactly on target contributes nothing ─────────────────────────
{
    const computed = evaluate(operands);
    const onTarget = operands.map((op, index) => (
        index === 2 ? { ...op, target: computed[2] } : op
    ));
    const shares = operandContributions(onTarget, evaluate(onTarget));
    assert.equal(shares[2], 0, 'a row sitting on its target holds none of the merit');
    close(shares.filter(Boolean).reduce((sum, share) => sum + share, 0), 1, 1e-12,
        'the remaining rows still sum to 100%');
}

// ── The biggest share is the row worth fixing first ──────────────────────────
// Meeting a row's target drops its term from the numerator while its weight
// stays in the denominator, so MF must fall, and it falls furthest for the row
// holding the biggest share. That is the whole point of the column.
//
// This is about MEETING a row, not deleting it. Deleting takes the weight out of
// the denominator as well, so MF' < MF only when the row's share of the
// numerator exceeds its share of the weight; delete a big contributor that
// carries an even bigger weight and MF goes UP. The column ranks what to fix,
// not what to throw away.
{
    const computed = evaluate(operands);
    const shares = operandContributions(operands, computed);
    const before = calcMF(operands, computed);
    // Rows whose residual is simply current - target, so meeting them zeroes it.
    const plain = [0, 1, 2];
    const meet = (i) => {
        const fixed = operands.map((op, index) => (
            index === i ? { ...op, target: computed[i] } : op
        ));
        return calcMF(fixed, evaluate(fixed));
    };
    const drops = plain.map(i => before - meet(i));
    for (let k = 0; k < plain.length; k++) {
        assert.ok(drops[k] > 0,
            `meeting row ${plain[k]} (${operands[plain[k]].type}) lowers MF`);
    }
    const biggestShare = plain.reduce((best, i) => (shares[i] > shares[best] ? i : best), plain[0]);
    const biggestDrop = plain[drops.indexOf(Math.max(...drops))];
    assert.equal(biggestShare, biggestDrop,
        'the row holding the biggest share is the one whose fix moves MF most');
}

// ── Rows that cannot contribute report null, not zero ────────────────────────
{
    const withDisabled = [
        ...operands,
        { ...makeOperand({ type: 'R', lambdaStart: 550 }), enabled: false },
    ];
    const shares = operandContributions(withDisabled, evaluate(withDisabled));
    assert.equal(shares[shares.length - 1], null, 'a disabled row has no share');

    const zeroWeight = operands.map(op => ({ ...op, weight: 0 }));
    const zeroShares = operandContributions(zeroWeight, evaluate(zeroWeight));
    for (const share of zeroShares) {
        assert.ok(share === 0 || share === null, 'all-zero weights give no share, not NaN');
    }
}

// ── Constraints sit in the same 100% ─────────────────────────────────────────
// Their weight is kept out of calcMF's denominator, but the denominator is
// common to every row and cancels in a ratio, so a violated constraint has to
// show a share like anything else.
{
    // MNT with a target above the thinnest layer is violated by construction.
    const violated = operands.map(op => (op.type === 'MNT' ? { ...op, target: 500 } : op));
    const shares = operandContributions(violated, evaluate(violated));
    const index = violated.findIndex(op => op.type === 'MNT');
    assert.ok(shares[index] > 0, 'a violated constraint holds part of the merit');
    close(shares.filter(share => share != null).reduce((sum, share) => sum + share, 0), 1, 1e-12,
        'constraints included, shares still sum to 100%');

    // skipConstraints drops them entirely, matching calcOMF.
    const optical = operandContributions(violated, evaluate(violated), { skipConstraints: true });
    assert.equal(optical[index], null, 'skipConstraints drops the constraint row');
    close(optical.filter(share => share != null).reduce((sum, share) => sum + share, 0), 1, 1e-12,
        'the optical rows alone still sum to 100%');
}

// ── Weight is legible through it ─────────────────────────────────────────────
// Doubling one row's weight doubles its term, which is the thing the old table
// could not show at all.
{
    const computed = evaluate(operands);
    const before = operandContributions(operands, computed);
    const heavier = operands.map((op, index) => (index === 0 ? { ...op, weight: 2 } : op));
    const after = operandContributions(heavier, evaluate(heavier));
    const ratioBefore = before[0] / (1 - before[0]);
    const ratioAfter = after[0] / (1 - after[0]);
    close(ratioAfter / ratioBefore, 2, 1e-9,
        'doubling a weight doubles that row"s share relative to the rest');
}

// ── An unevaluable row voids the whole column ────────────────────────────────
// calcMF is Infinity when any operand failed to evaluate, so there is no total
// to take a share of. Reporting the surviving rows as a tidy 100% would claim a
// complete table while one row is missing.
{
    const outOfRange = [
        ...operands,
        // TiO2's table stops at 825 nm, so this row cannot be evaluated at all.
        makeOperand({ type: 'GDD', lambdaStart: 1000, target: -40, weight: 1 }),
    ];
    const computed = evaluate(outOfRange);
    assert.equal(calcMF(outOfRange, computed), Infinity, 'the merit is undefined here');
    const shares = operandContributions(outOfRange, computed);
    assert.ok(shares.every(share => share === null),
        'no row claims a share of an undefined merit function');
}

// ── An empty or unevaluated table does not throw ─────────────────────────────
{
    assert.deepEqual(operandContributions([], []), [], 'no operands, no shares');
    assert.deepEqual(operandContributions(operands, null), new Array(operands.length).fill(null),
        'no computed values, every share null');
    const partial = evaluate(operands).slice();
    partial[1] = null;
    assert.equal(operandContributions(operands, partial)[1], null,
        'an unevaluated row has no share');
}

console.log('PASS: operand_contribution');
