/**
 * Math rows give the optimizer exact slopes, by the chain rule through the
 * rows they read, instead of putting the whole merit on finite differences.
 *
 * A math row reads the value of another row, not its residual: the Jacobian
 * row has to carry neither that row's weight (Generate MF writes it at 0), nor
 * its unit scale, nor its own one-sided clipping.
 *
 *   1. Each math kind, on rows of every reading kind (T, TAV, TMN, MXWT, dB
 *      rows, a range target, a level-free curve block, PPEF, Ψ, GD, TT, MNT),
 *      against central differences of the residuals at 0.01 nm, without and
 *      with a cone, s, p and the polarization average. An inequality row is
 *      checked active and satisfied; a chain of math rows follows its
 *      references.
 *   2. The merit functions Generate MF writes for the BBAR_VIS and COLD_MIRROR
 *      presets take the analytic Jacobian, and gradMF matches central
 *      differences of the merit.
 *   3. A math row reading an EFMX row or a whole curve block still declines.
 *
 * Run: node tests/math_row_slopes.mjs
 */
import assert from 'node:assert/strict';
import {
    makeOperand, makeMeasuredCurveOperand, DLSOptimizer, evaluateOperands, buildEvalContext,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { applyPreset } from '../src/utils/synthesis/qualifierPresets.js';
import { qualifiersToMFOperands } from '../src/utils/synthesis/qualifiers.js';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();
const resolveMat = id => getMaterial(id);
const STEP_NM = 0.01;
const H = ['TiO2', 57], L = ['SiO2', 94];
const rep = (n, pair) => Array.from({ length: n }, () => pair).flat();
const design = (spec, extra = {}) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: spec.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false })),
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side', ...extra,
});
// A low-finesse Fabry-Perot: its resonance is broad enough that central
// differences at 0.01 nm resolve the band rows over it. A narrow one bends T on
// the band grid so sharply that their truncation error, not the analytic row,
// sets the gap.
const fabryPerot = [...rep(2, [H, L]), H, ['SiO2', 188], H, ...rep(2, [L, H])];
const CONE = { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15 };
const DESIGNS = [['no cone', design(fabryPerot)], ['7.5° cone', design(fabryPerot, { cone: CONE })]];

const row = (type, a, b, extra = {}) => makeOperand({ type, lambdaStart: a, lambdaEnd: b, target: 0, weight: 0, ...extra });
const one = (type, ref, extra = {}) => makeOperand({ type, refId: ref.id, target: 0, weight: 1, ...extra });
const two = (type, a, b, extra = {}) => makeOperand({ type, refId1: a.id, refId2: b.id, target: 0, weight: 1, ...extra });

// Each case returns its rows, the math row under test last, and how far from
// the math row's value its target sits: an offset pushing an inequality past
// its target makes it active, one the other way leaves it satisfied.
const CASES = [
    ['OPGT on TAV, active', () => { const r = row('TAV', 480, 620); return [[r, one('OPGT', r)], +0.05]; }],
    ['OPGT on TAV, satisfied', () => { const r = row('TAV', 480, 620); return [[r, one('OPGT', r)], -0.05]; }],
    ['OPLT on T at 45°, p, active', () => { const r = row('T', 560, 560, { aoi: 45, pol: 'p' }); return [[r, one('OPLT', r)], -0.05]; }],
    ['OPLT on T at 45°, p, satisfied', () => { const r = row('T', 560, 560, { aoi: 45, pol: 'p' }); return [[r, one('OPLT', r)], +0.05]; }],
    // A reference with its own weight and a satisfied target of its own: the
    // math row reads the value, so neither may reach its slope.
    ['OPVA on TMN at 45°, avg', () => { const r = row('TMN', 450, 520, { aoi: 45, weight: 2, target: -1 }); return [[r, one('OPVA', r)], 0.01]; }],
    ['OPVA on MXWT', () => { const r = row('MXWT', 500, 600); return [[r, one('OPVA', r)], 3]; }],
    ['OPGT on TDBMN, active', () => { const r = row('TDBMN', 450, 520); return [[r, one('OPGT', r)], +1]; }],
    ['OPVA on TDB, s', () => { const r = row('TDB', 610, 610, { pol: 's' }); return [[r, one('OPVA', r)], 0.5]; }],
    ['OPLT on TGT, active', () => { const r = row('TGT', 470, 640, { target: 0.9, targetEnd: 0.7 }); return [[r, one('OPLT', r)], -0.05]; }],
    // A level-free block in dB: σ = 4.343 dB on both the block and the row.
    ['OPLT on a level-free dB curve block, active', () => {
        const block = makeMeasuredCurveOperand({
            quantity: 'TDB', levelFree: true, weight: 0,
            sampleLambdas: [460, 500, 540, 580, 620], sampleTargets: [-0.5, -1, -3, -1, -0.5],
        });
        return [[block, one('OPLT', block)], -0.2];
    }],
    ['OPLT on PPEF, active', () => {
        const block = makeMeasuredCurveOperand({
            quantity: 'T', weight: 0, sampleLambdas: [460, 500, 540, 580, 620], sampleTargets: [0.9, 0.8, 0.5, 0.8, 0.9],
        });
        const spread = makeOperand({ type: 'PPEF', refId: block.id, target: 0, weight: 0 });
        return [[block, spread, one('OPLT', spread)], -0.1];
    }],
    ['OPVA on PSI at 60°', () => { const r = row('PSI', 550, 550, { aoi: 60 }); return [[r, one('OPVA', r)], 1]; }],
    ['OPVA on GD, s', () => { const r = row('GD', 550, 550, { pol: 's' }); return [[r, one('OPVA', r)], 1]; }],
    ['OPLT on TT, active', () => { const r = makeOperand({ type: 'TT', target: 0, weight: 0, cmp: 'eq' }); return [[r, one('OPLT', r)], -5]; }],
    // Layers 1 and 2 differ, so the thinnest is one layer and not a tie, where
    // the minimum has no derivative.
    ['OPGT on MNT, active', () => {
        const r = makeOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 2, target: 0, weight: 0 });
        return [[r, one('OPGT', r)], +5];
    }],
    ['DIFF of Tp and Ts at 45°', () => {
        const p = row('T', 600, 600, { aoi: 45, pol: 'p' }), s = row('T', 600, 600, { aoi: 45, pol: 's' });
        return [[p, s, two('DIFF', p, s)], 0.02];
    }],
    ['SUMM of TAV and RAV', () => { const t = row('TAV', 480, 620), r = row('RAV', 600, 700); return [[t, r, two('SUMM', t, r)], 0.1]; }],
    ['PROD of T and R at 45°, avg', () => {
        const t = row('T', 530, 530, { aoi: 45 }), r = row('R', 590, 590, { aoi: 45 });
        return [[t, r, two('PROD', t, r)], 0.01];
    }],
    ['PROD of a row with itself', () => { const t = row('TAV', 480, 620); return [[t, two('PROD', t, t)], 0.01]; }],
    // Ts − Tp is negative at 45°, so |x| takes its slope with the sign flipped.
    ['ABSO of DIFF', () => {
        const p = row('T', 600, 600, { aoi: 45, pol: 'p' }), s = row('T', 600, 600, { aoi: 45, pol: 's' });
        const d = two('DIFF', s, p, { weight: 0 });
        return [[p, s, d, one('ABSO', d)], 0.01];
    }],
    ['ABGT of DIFF, active', () => {
        const p = row('R', 470, 470, { aoi: 45, pol: 'p' }), s = row('R', 470, 470, { aoi: 45, pol: 's' });
        const d = two('DIFF', p, s, { weight: 0 });
        return [[p, s, d, one('ABGT', d)], +0.02];
    }],
    ['ABLT of DIFF, active', () => {
        const p = row('R', 470, 470, { aoi: 45, pol: 'p' }), s = row('R', 470, 470, { aoi: 45, pol: 's' });
        const d = two('DIFF', p, s, { weight: 0 });
        return [[p, s, d, one('ABLT', d)], -0.02];
    }],
    ['ABLT of DIFF, satisfied', () => {
        const p = row('R', 470, 470, { aoi: 45, pol: 'p' }), s = row('R', 470, 470, { aoi: 45, pol: 's' });
        const d = two('DIFF', p, s, { weight: 0 });
        return [[p, s, d, one('ABLT', d)], +0.02];
    }],
    ['OPGT on SUMM(DIFF(MXWT, TAV), PROD(T, TDB))', () => {
        const peak = row('MXWT', 500, 600), band = row('TAV', 480, 620), t = row('T', 530, 530), db = row('TDB', 610, 610);
        const diff = two('DIFF', peak, band, { weight: 0 }), prod = two('PROD', t, db, { weight: 0 });
        const sum = two('SUMM', diff, prod, { weight: 0 });
        return [[peak, band, t, db, diff, prod, sum, one('OPGT', sum)], +2];
    }],
];

// Central differences of every residual in every layer thickness.
function centralDifferences(engine, thk) {
    return thk.map((_, k) => {
        const plus = thk.slice(); plus[k] += STEP_NM;
        const minus = thk.slice(); minus[k] -= STEP_NM;
        const rPlus = engine._residuals(plus), rMinus = engine._residuals(minus);
        return rPlus.map((value, i) => (value - rMinus[i]) / (2 * STEP_NM));
    });
}

// Largest gap between the analytic row and central differences, over the
// largest central difference in the row, and that scale.
function rowGap(J, fd, rowIndex) {
    let worst = 0, scale = 0;
    fd.forEach((column, k) => {
        scale = Math.max(scale, Math.abs(column[rowIndex]));
        worst = Math.max(worst, Math.abs(J[rowIndex][k] - column[rowIndex]));
    });
    return { worst, scale };
}

const freeAll = engine => engine.thicknesses.map((_, k) => k);

// ── 1. Each math kind against central differences ────────────────────────────
for (const [designName, d] of DESIGNS) {
    for (const [name, build] of CASES) {
        const [rows, offset] = build();
        const math = rows.at(-1);
        const values = evaluateOperands(rows, buildEvalContext(d, resolveMat));
        math.target = values.at(-1) + offset;
        if (math.type === 'ABSO') assert.ok(values.at(-2) < 0, `${name}: the row it reads is negative`);
        const engine = new DLSOptimizer(rows, structuredClone(d), resolveMat, {});
        const thk = engine.thicknesses.slice();
        const J = engine._analyticJacobian(thk, freeAll(engine));
        const tag = `${name}, ${designName}`;
        assert.ok(J, `${tag}: the Jacobian is analytic`);
        const fd = centralDifferences(engine, thk);
        assert.equal(J.length, fd[0].length, `${tag}: one Jacobian row per residual`);
        const last = J.length - 1;
        const { worst, scale } = rowGap(J, fd, last);
        if (name.endsWith('satisfied')) {
            assert.equal(scale, 0, `${tag}: a satisfied row does not move`);
            assert.ok(J[last].every(v => v === 0), `${tag}: and its analytic row is zero`);
            continue;
        }
        assert.ok(scale > 0, `${tag}: the row moves`);
        assert.ok(worst <= 1e-5 * scale, `${tag}: analytic against central differences ${(worst / scale).toExponential(2)}`);
    }
}

// ── 2. Merit functions written by Generate MF ────────────────────────────────
// Starts that miss both specifications, so every inequality row pulls.
const SPEC_MERITS = [
    ['BBAR_VIS', design([['MgF2', 85], ['ZrO2', 140], ['Al2O3', 60], ['ZrO2', 20]])],
    ['COLD_MIRROR', design(rep(10, [H, L]))],
];
for (const [preset, d] of SPEC_MERITS) {
    const rows = qualifiersToMFOperands(applyPreset(preset));
    assert.ok(rows.some(op => op.type === 'OPGT' || op.type === 'OPLT'), `${preset}: the merit holds inequality rows`);
    const engine = new DLSOptimizer(rows, structuredClone(d), resolveMat, {});
    const thk = engine.thicknesses.slice();
    const J = engine._analyticJacobian(thk, freeAll(engine));
    assert.ok(J, `${preset}: no row is left on finite differences`);
    assert.equal(J.length, engine._residuals(thk).length, `${preset}: one Jacobian row per residual`);
    const g = engine.gradMF(thk);
    let worst = 0, scale = 0;
    thk.forEach((_, k) => {
        const plus = thk.slice(); plus[k] += STEP_NM;
        const minus = thk.slice(); minus[k] -= STEP_NM;
        const fd = (engine.mfAt(plus) - engine.mfAt(minus)) / (2 * STEP_NM);
        scale = Math.max(scale, Math.abs(fd));
        worst = Math.max(worst, Math.abs(g[k] - fd));
    });
    assert.ok(scale > 0, `${preset}: the merit moves`);
    assert.ok(worst <= 1e-5 * scale, `${preset}: gradMF against central differences of the merit ${(worst / scale).toExponential(2)}`);
}

// ── 3. Rows with no slope still decline ──────────────────────────────────────
{
    const d = design(fabryPerot);
    const field = row('EFMX', 550, 550, { pol: 's' });
    const block = makeMeasuredCurveOperand({ quantity: 'R', sampleLambdas: [450, 550, 650], sampleTargets: [0.04, 0.05, 0.04], weight: 1 });
    const legacy = makeOperand({ type: 'OPGT', baseType: 'TAV', lambdaStart: 480, lambdaEnd: 620, target: 0, weight: 1 });
    delete legacy.refId;
    for (const [name, rows] of [
        ['OPLT on EFMX', [field, one('OPLT', field, { target: 0 })]],
        ['OPGT on EFMX, satisfied', [field, one('OPGT', field, { target: 0 })]],
        ['OPLT on a whole curve block', [block, one('OPLT', block, { target: 0.001 })]],
        ['an OPGT saved by type', [legacy]],
    ]) {
        const engine = new DLSOptimizer(rows, structuredClone(d), resolveMat, {});
        assert.equal(engine._analyticJacobian(engine.thicknesses.slice(), freeAll(engine)), null, `${name}: the Jacobian declines`);
    }
}

console.log('PASS math_row_slopes');
