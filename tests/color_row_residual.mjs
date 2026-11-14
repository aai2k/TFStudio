/**
 * How a colour row (RCOL, TCOL) misses its target, and that the needle scan
 * takes its slope exactly.
 *
 *   1. The residual: σ by quantity, chosen so a just-noticeable miss scores
 *      like a 1 % miss in R; a hue misses by ΔH* = 2C·sin(Δh/2) at the
 *      coating's chroma, taken the short way round 0°/360°; CCT misses in
 *      mired; a CCT target of 0 K has no mired and is refused with a reason.
 *   2. The analytic needle scan runs on colour rows without differencing any
 *      of them, its P-values do not change from a 0.5 nm to a 0.001 nm needle,
 *      and they match the finite-difference scan's within 0.2 % of the largest,
 *      without and with a cone.
 *
 * P-function: Sullivan & Dobrowolski, Appl. Opt. 35, 5484 (1996); Tikhonravov
 * et al., Appl. Opt. 35, 5493 (1996).
 *
 * Run: node tests/color_row_residual.mjs
 */
import assert from 'node:assert/strict';
import {
    makeOperand, evaluateOperands, buildEvalContext, operandResidualScale, operandColorChromas,
    operandEvaluationErrors, calcMF, scanNeedlesAnalytic, scanNeedlesFD, scanDifferencesRows,
} from '../src/utils/physics/optimizer.js';
import { COLOR_QUANTITIES } from '../src/utils/physics/colorimetry.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();
const resolveMat = id => getMaterial(id);
const layers = spec => spec.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false }));
const front = spec => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: layers(spec), backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});
const AR = front([['MgF2', 95], ['Ta2O5', 120], ['SiO2', 20], ['Ta2O5', 15]]);
const SILVER = front([['TiO2', 25], ['Ag', 12], ['TiO2', 30]]);
const CONE = { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15 };
const colorRow = (type, color, extra = {}) => makeOperand({ type, color, aoi: 30, target: 1, weight: 1, flag: -5, ...extra });
const evaluate = (rows, d) => evaluateOperands(rows, buildEvalContext(d, resolveMat));

// ── 1. The residual ──────────────────────────────────────────────────────────
const SIGMA = {
    X: 100, Y: 100, Z: 100, 'L*': 100, 'a*': 100, 'b*': 100, 'C*ab': 100, hab: 100, 'u*': 100, 'v*': 100,
    'C*uv': 100, huv: 100, 'Hunter L': 100, 'Hunter a': 100, 'Hunter b': 100,
    x: 0.4, y: 0.4, "u'": 0.4, "v'": 0.4, u: 0.4, v: 0.4, Duv: 0.4, suv: 5.2, CCT: 500,
    dominant: 500, complementary: 500, purity: 1,
};
assert.deepEqual(Object.keys(SIGMA).sort(), [...COLOR_QUANTITIES].sort(), 'a σ for every quantity');
for (const color of COLOR_QUANTITIES) assert.equal(operandResidualScale(colorRow('TCOL', color)), SIGMA[color], `σ of ${color}`);

// A hue 10° off either way, and across 0°/360° the short way round: ΔH* is
// 2C·sin(5°) at the coating's chroma C each time.
const [hue0, chroma] = evaluate([colorRow('RCOL', 'hab'), colorRow('RCOL', 'C*ab')], SILVER);
for (const off of [10, -10, 350, -350]) {
    const hue = colorRow('RCOL', 'hab', { target: hue0 - off });
    const computed = evaluate([hue], SILVER);
    assert.ok(Math.abs(operandColorChromas(computed)[0] - chroma) <= 1e-9 * chroma, 'the hue row keeps its chroma');
    const missed = 2 * chroma * Math.sin(5 * Math.PI / 180) / 100;
    assert.ok(Math.abs(calcMF([hue], computed) - missed) < 1e-12, `hue ${off}° off: ΔH* at the coating's chroma, over σ`);
}

const [cct0] = evaluate([colorRow('TCOL', 'CCT', { aoi: 0 })], AR);
assert.ok(cct0 > 1000, 'the AR transmits a colour with a CCT');
const cct = colorRow('TCOL', 'CCT', { aoi: 0, target: cct0 + 200 });
assert.ok(Math.abs(calcMF([cct], evaluate([cct], AR)) - Math.abs(1e6 / (cct0 + 200) - 1e6 / cct0) / 500) < 1e-12, 'CCT misses in mired');
const refused = evaluate([colorRow('TCOL', 'CCT', { aoi: 0, target: 0 })], AR);
assert.equal(refused[0], null, 'a CCT target of 0 K leaves the row without a value');
assert.match(operandEvaluationErrors(refused)[0], /above 0 K/, 'and the row says why');

// ── 2. The analytic needle scan ──────────────────────────────────────────────
const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const irregular = Array.from({ length: 8 }, (_, i) => [i % 2 ? 'SiO2' : 'TiO2', (i % 2 ? 90 : 50) * (1 + 0.3 * Math.sin(1.7 * i + 0.3))]);
// Rows with a value on `d`, each 5 % or 25° off it, CCT by a tenth.
function missingRows(rows, d) {
    const values = evaluate(rows, d);
    const miss = { hab: v => v - 25, CCT: v => 0.9 * v };
    return rows.filter((op, i) => {
        op.target = (miss[op.color] ?? (v => 1.05 * v + 1e-3))(values[i]);
        return values[i] != null;
    });
}
for (const cone of [null, CONE]) {
    const d = { ...front(irregular), ...(cone ? { cone } : {}) };
    const operands = missingRows(['x', 'y', 'Y', 'hab', 'CCT', 'purity'].map(color => colorRow('RCOL', color)), d)
        .concat(missingRows(['a*', 'b*', 'Duv'].map(color => colorRow('TCOL', color)), d));
    const tag = `needle scan${cone ? ', cone' : ''}`;
    assert.ok(!scanDifferencesRows(operands), `${tag}: no colour row is differenced`);
    const args = { operands, design: d, resolveMat, candidateMats: POOL, deltaNm: 0.001, side: 'front' };
    const coarse = scanNeedlesAnalytic({ ...args, deltaNm: 0.5 });
    assert.ok(coarse, `${tag}: the analytic scan runs`);
    const fine = scanNeedlesAnalytic(args).candidates;
    assert.ok(coarse.candidates.every((c, i) => c.grad === fine[i].grad), `${tag}: P is the same at 0.5 nm and 0.001 nm needles`);
    const fd = scanNeedlesFD(args).candidates;
    const largest = Math.max(...fd.map(c => Math.abs(c.grad)));
    const gap = Math.max(...fd.map((c, i) => Math.abs(fine[i].grad - c.grad)));
    assert.ok(largest > 0 && gap <= 0.002 * largest, `${tag}: P within 0.2 % of the FD scan's, ${(100 * gap / largest).toFixed(4)} %`);
}

console.log('PASS color_row_residual');
