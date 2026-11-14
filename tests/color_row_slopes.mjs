/**
 * Colour rows (RCOL, TCOL) give the optimizer exact slopes for every quantity
 * of the Color list, and never put the merit on finite differences.
 *
 *   1. Every quantity's Jacobian row against central differences of the
 *      residuals at 0.01 nm: R and T, front, back and total, s, p and the
 *      polarization average, without and with a cone, on two dielectric stacks
 *      and an absorbing one. Each row misses its target, a hue row by 25°, so
 *      the chroma term of its ΔH* miss is checked too. A quantity the colour has
 *      no value for in a case (λd of a purple, λc of any other colour, CCT off
 *      the locus) is left out of that case; every quantity is checked in some.
 *      A column whose differences at 0.01 nm are off is checked again at
 *      0.0001 nm, where they settle: λd, λc and purity are read off the
 *      spectral locus drawn straight between its 5 nm table points, and Duv
 *      off the nearest blackbody of a 5 K search, so each turns a corner where
 *      the colour crosses a table point (λd can move a quarter of a nanometre
 *      for 0.01 nm of layer); and C* and h° bend sharply near the white, so a
 *      near-neutral colour bends them within 0.01 nm. The count of such
 *      columns per quantity is printed.
 *   2. Math rows read a colour row's value: OPVA of a hab row and DIFF of the x
 *      of two angles, against central differences.
 *   3. gradMF of a merit of colour and spectral rows against central
 *      differences of the merit.
 * The needle scan and the miss itself: color_row_residual.mjs.
 *
 * Run: node tests/color_row_slopes.mjs
 */
import assert from 'node:assert/strict';
import {
    makeOperand, DLSOptimizer, evaluateOperands, buildEvalContext,
} from '../src/utils/physics/optimizer.js';
import { COLOR_QUANTITIES } from '../src/utils/physics/colorimetry.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();
const resolveMat = id => getMaterial(id);
const STEP_NM = 0.01;
const layers = spec => spec.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false }));
const base = { incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 } };
const H = ['TiO2', 57], L = ['SiO2', 94];
const STACKS = {
    // A four-layer AR: R a deep blue, T near white.
    'dielectric AR': [['MgF2', 95], ['Ta2O5', 120], ['SiO2', 20], ['Ta2O5', 15]],
    // A quarter-wave reflector at 550 nm: T magenta, a purple.
    'dielectric green reflector': [H, L, H, L, H, L, H],
    // Silver between titania: absorbing, R and T strongly coloured.
    'absorbing TiO2/Ag/TiO2': [['TiO2', 25], ['Ag', 12], ['TiO2', 30]],
};
const SIDES = {
    front: spec => ({ ...base, frontLayers: layers(spec), backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side' }),
    back: spec => ({ ...base, frontLayers: [], backLayers: layers(spec), surfaceMode: 'back_only', mfEvalMode: 'side' }),
    total: spec => ({
        ...base, frontLayers: layers(spec), backLayers: layers([['MgF2', 100]]),
        surfaceMode: 'both_independent', mfEvalMode: 'total',
    }),
};
const CONE = { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15 };
const AOI = 30;

// A target the value misses by a few percent of itself, a hue by 25° and CCT
// by a tenth.
const MISS = { hab: v => v - 25, huv: v => v + 25, CCT: v => 0.9 * v };
const targetFor = (color, value) => (MISS[color] ?? (v => v + 0.05 * Math.abs(v) + 1e-3))(value);

// Integrated at 5 nm, the spacing of the CIE tables: a slope is exact on any
// grid, and this one is the lightest.
const colorRow = (type, color, extra = {}) => makeOperand({ type, color, aoi: AOI, target: 1, weight: 1, flag: -5, ...extra });

// Central differences of every residual in every layer thickness.
function centralDifferences(engine, thk) {
    return thk.map((_, k) => {
        const plus = thk.slice(); plus[k] += STEP_NM;
        const minus = thk.slice(); minus[k] -= STEP_NM;
        const rPlus = engine._residuals(plus), rMinus = engine._residuals(minus);
        return rPlus.map((value, i) => (value - rMinus[i]) / (2 * STEP_NM));
    });
}

// Largest gap between analytic row r and central differences, and the
// largest central difference in the row.
function rowGap(J, fd, r) {
    let worst = 0, scale = 0;
    fd.forEach((column, k) => {
        scale = Math.max(scale, Math.abs(column[r]));
        worst = Math.max(worst, Math.abs(J[r][k] - column[r]));
    });
    return { worst, scale };
}

const freeAll = engine => engine.thicknesses.map((_, k) => k);

// The rows of `rows` with a value on `d`, each given a target it misses.
function scoredRows(rows, d) {
    const values = evaluateOperands(rows, buildEvalContext(d, resolveMat));
    return rows.filter((op, i) => {
        if (values[i] == null) return false;
        op.target = targetFor(op.color, values[i]);
        return true;
    });
}

const FINE_STEP_NM = 1e-4;
const fineColumns = new Map();

// Central difference of residual r in thickness k at a step of h nm.
function columnDifference(engine, thk, k, r, h) {
    const plus = thk.slice(); plus[k] += h;
    const minus = thk.slice(); minus[k] -= h;
    return (engine._residuals(plus)[r] - engine._residuals(minus)[r]) / (2 * h);
}

// The analytic Jacobian of `rows` on `d`, its rows `checked` held against
// central differences (header, item 1). `name(op)` names a row.
function checkJacobian(tag, rows, d, checked, name) {
    const engine = new DLSOptimizer(rows, structuredClone(d), resolveMat, {});
    const thk = engine.thicknesses.slice();
    const J = engine._analyticJacobian(thk, freeAll(engine));
    assert.ok(J, `${tag}: the Jacobian is analytic`);
    const fd = centralDifferences(engine, thk);
    assert.equal(J.length, fd[0].length, `${tag}: one Jacobian row per residual`);
    for (const r of checked) {
        const { scale } = rowGap(J, fd, r);
        assert.ok(scale > 0, `${tag}, ${name(rows[r])}: the row moves`);
        fd.forEach((column, k) => {
            let gap = Math.abs(J[r][k] - column[r]);
            if (gap > 1e-5 * scale) {
                gap = Math.abs(J[r][k] - columnDifference(engine, thk, k, r, FINE_STEP_NM));
                fineColumns.set(name(rows[r]), (fineColumns.get(name(rows[r])) ?? 0) + 1);
            }
            assert.ok(gap <= 1e-5 * scale, `${tag}, ${name(rows[r])}, layer ${k + 1}: analytic against central differences ${(gap / scale).toExponential(2)}`);
        });
    }
}

// Check every row's Jacobian row on `d`; returns the colours checked.
function checkRows(tag, rows, d) {
    checkJacobian(tag, rows, d, rows.keys(), op => op.color);
    return rows.map(op => op.color);
}

// ── 1. Every quantity against central differences ────────────────────────────
const checked = new Map(COLOR_QUANTITIES.map(q => [q, 0]));
// Every combination of the lists, as arrays of one item of each.
const product = (...lists) => lists.reduce((combos, list) => combos.flatMap(combo => list.map(item => [...combo, item])), [[]]);
const CASES = product(Object.entries(STACKS), Object.entries(SIDES), [null, CONE], ['RCOL', 'TCOL'], ['s', 'p', 'avg']);
for (const [[stackName, spec], [sideName, sided], cone, type, pol] of CASES) {
    const d = { ...sided(spec), ...(cone ? { cone } : {}) };
    const rows = scoredRows(COLOR_QUANTITIES.map(color => colorRow(type, color, { pol })), d);
    const tag = `${type} ${pol}, ${stackName}, ${sideName}${cone ? ', cone' : ''}`;
    for (const color of checkRows(tag, rows, d)) checked.set(color, checked.get(color) + 1);
}
for (const [color, count] of checked) assert.ok(count > 0, `${color} is checked in some case`);
console.log(`[1] ${CASES.length} cases; checks per quantity: ${[...checked].map(([q, n]) => `${q} ${n}`).join(', ')}`);
console.log(`    columns checked at ${FINE_STEP_NM} nm: ${[...fineColumns].map(([q, n]) => `${q} ${n}`).join(', ') || 'none'}`);

// ── 2. Math rows reading a colour row ────────────────────────────────────────
{
    const d = SIDES.front(STACKS['absorbing TiO2/Ag/TiO2']);
    const hue = colorRow('RCOL', 'hab', { weight: 0 });
    const x0 = colorRow('TCOL', 'x', { aoi: 0, weight: 0 });
    const x60 = colorRow('TCOL', 'x', { aoi: 60, weight: 0 });
    const opva = makeOperand({ type: 'OPVA', refId: hue.id, target: 0, weight: 1 });
    const diff = makeOperand({ type: 'DIFF', refId1: x0.id, refId2: x60.id, target: 0, weight: 1 });
    const rows = [hue, x0, x60, opva, diff];
    const values = evaluateOperands(rows, buildEvalContext(d, resolveMat));
    opva.target = values[3] + 3;
    diff.target = values[4] + 0.01;
    checkJacobian('math rows on colour rows', rows, d, [3, 4], op => op.type);
}

// ── 3. gradMF of a mixed merit ───────────────────────────────────────────────
{
    const d = { ...SIDES.front(STACKS['dielectric AR']), cone: CONE };
    const rows = scoredRows(['Y', 'a*', 'b*', 'hab', 'CCT', 'dominant'].map(color => colorRow('RCOL', color)), d)
        .concat(scoredRows(['x', 'y', 'CCT'].map(color => colorRow('TCOL', color, { aoi: 0 })), d));
    rows.push(makeOperand({ type: 'RAV', lambdaStart: 420, lambdaEnd: 680, target: 0, weight: 1 }));
    const engine = new DLSOptimizer(rows, structuredClone(d), resolveMat, {});
    const thk = engine.thicknesses.slice();
    assert.ok(engine._analyticJacobian(thk, freeAll(engine)), 'mixed merit: the Jacobian is analytic');
    const g = engine.gradMF(thk);
    let worst = 0, scale = 0;
    thk.forEach((_, k) => {
        const plus = thk.slice(); plus[k] += STEP_NM;
        const minus = thk.slice(); minus[k] -= STEP_NM;
        const fd = (engine.mfAt(plus) - engine.mfAt(minus)) / (2 * STEP_NM);
        scale = Math.max(scale, Math.abs(fd));
        worst = Math.max(worst, Math.abs(g[k] - fd));
    });
    assert.ok(scale > 0 && worst <= 1e-5 * scale, `gradMF against central differences of the merit ${(worst / scale).toExponential(2)}`);
}

console.log('PASS color_row_slopes');
