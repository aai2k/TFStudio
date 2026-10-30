/**
 * Band-extremum rows (MXW and MNW, TMN..AMX and the dB and density forms) report
 * the true extremum of the band, checked against a brute-force scan at
 * 0.002 nm refined by golden section. The cases are the ones the old 301-point
 * grid read wrong: a Fabry-Perot resonance a few samples wide, a 0.05 nm leak
 * inside a blocking band, its density reading, and a pair of coupled-cavity
 * peaks closer than the default step, which the row's flag resolves. Also: a
 * smooth AR minimum, a lossless design's absorptance, a band end, and the step
 * the flag sets.
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import {
    buildEvalContext, evaluateOperands, makeOperand, operandSampleLambdas, operandExtremumLambdas,
    tmmProp, extremumStepNm, EXTREMUM_FLAG_MAX,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { extremumRowSpec } from '../src/utils/physics/optimizer/extremumGrid.js';

const resolveMat = id => getMaterial(id);
const H = ['TiO2', 57], L = ['SiO2', 94];
const rep = (n, pair) => Array.from({ length: n }, () => pair).flat();
const design = spec => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: spec.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false })),
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});
const twice = layer => [layer[0], 2 * layer[1]];
// air | (HL)^5 H LL H (LH)^5 | BK7: resonance at 557.53 nm, FWHM 0.36 nm.
const fabryPerot = design([...rep(5, [H, L]), H, twice(L), H, ...rep(5, [L, H])]);
// air | (HL)^6 H 2L (HL)^11 H | BK7: a leak of T 0.0265, 0.05 nm wide, in the stop band.
const leak = design([...rep(6, [H, L]), H, twice(L), ...rep(11, [H, L]), H]);
// Two coupled cavities whose peaks sit 1.9 nm apart, 0.98 and 0.75 high.
const coupled = design([
    ...rep(5, [H, L]), H, twice(L), H, ...rep(3, [L, H]), L,
    ...rep(3, [H, L]), H, ['SiO2', 2 * 94 * 1.003], H, ...rep(5, [L, H]),
]);
const ar = design([['MgF2', 99.6], ['ZrO2', 127.3], ['Al2O3', 77.7]]);

// Brute-force band extremum of the row's linear quantity C.
function reference(op, d) {
    const ctx = buildEvalContext(d, resolveMat);
    const { char, pol, maxC } = extremumRowSpec(op);
    const C = lam => tmmProp(lam, op.aoi, pol, char, ctx, ctx.frontThicks, ctx.frontMats);
    const better = (a, b) => (maxC ? a > b : a < b);
    const a = op.lambdaStart, b = op.lambdaEnd, step = 0.002;
    const n = Math.round((b - a) / step) + 1;
    let best = { lam: a, v: C(a) };
    for (let i = 1; i < n; i++) {
        const lam = a + ((b - a) * i) / (n - 1);
        const v = C(lam);
        if (better(v, best.v)) best = { lam, v };
    }
    let lo = Math.max(a, best.lam - step), hi = Math.min(b, best.lam + step);
    for (let k = 0; k < 80; k++) {
        const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
        if (better(C(m1), C(m2))) hi = m2; else lo = m1;
    }
    const lam = 0.5 * (lo + hi);
    const v = C(lam);
    return better(v, best.v) ? { lam, v } : best;
}

function finder(op, d) {
    const ctx = buildEvalContext(d, resolveMat);
    const out = evaluateOperands([op], ctx);
    return { value: out[0], lambda: operandExtremumLambdas(out)[0] };
}

const row = (type, a, b, extra = {}) => makeOperand({ type, lambdaStart: a, lambdaEnd: b, target: 0, weight: 1, ...extra });

// ── Worst-case rows read the true extremum ───────────────────────────────────
for (const [name, op, d] of [
    ['TMX over a resonance', row('TMX', 540, 580), fabryPerot],
    ['RMN over a resonance', row('RMN', 540, 580), fabryPerot],
    ['TMX over a 0.05 nm leak', row('TMX', 500, 600), leak],
    ['AMN on a smooth AR', row('AMN', 420, 680), ar],
]) {
    const ref = reference(op, d);
    const got = finder(op, d);
    assert.ok(Math.abs(got.value - ref.v) <= 1e-6 * Math.max(Math.abs(ref.v), 1e-6),
        `${name}: ${got.value} against the true ${ref.v}`);
}

// The old 301-point grid read this leak at T 9e-4; the true one is 0.0265.
{
    const got = finder(row('TMX', 500, 600), leak);
    assert.ok(got.value > 0.026 && got.value < 0.027, `the leak reads ${got.value}`);
    assert.ok(Math.abs(got.lambda - 557.536) < 2e-3, `at ${got.lambda} nm`);
    const od = finder(row('ODMN', 500, 600), leak);
    assert.ok(Math.abs(od.value - (-Math.log10(got.value))) < 1e-9, 'the density row reads the same leak');
}

// ── MXW/MNW report the true wavelength ───────────────────────────────────────
for (const [name, op, d] of [
    ['MXWT of a resonance', row('MXWT', 500, 600), fabryPerot],
    ['MNWR of a resonance', row('MNWR', 540, 580), fabryPerot],
    ['MNWR of an AR', row('MNWR', 420, 680), ar],
]) {
    const ref = reference(op, d);
    const got = finder(op, d);
    assert.ok(Math.abs(got.value - ref.lam) < 1e-4, `${name}: ${got.value} nm against the true ${ref.lam} nm`);
}

// ── The flag sets the step; a finer step separates close peaks ───────────────
assert.equal(extremumStepNm(row('TMX', 500, 600)), 1, 'a row without a flag searches at 1 nm');
assert.equal(extremumStepNm(row('TMX', 500, 600, { flag: 3 })), 0.01, 'flag 3 is 0.01 nm');
assert.equal(extremumStepNm(row('TMX', 500, 600, { flag: EXTREMUM_FLAG_MAX + 1 })), 1, 'a flag out of range reads as 1');
assert.equal(operandSampleLambdas(row('TMX', 500, 600, { flag: 2 })).length, 1001, 'flag 2 grids 100 nm in 1001 samples');
assert.equal(operandSampleLambdas(row('TMN', 500, 600, { flag: 3 })).length, 13,
    'a row that looks for a dip starts from 13 samples whatever its flag');
{
    const op = row('TMX', 530.188, 590.188);
    const ref = reference(op, coupled);
    const fine = finder({ ...op, flag: 3 }, coupled);
    assert.ok(Math.abs(fine.value - ref.v) <= 1e-6, `flag 3 finds the higher of two peaks 1.9 nm apart: ${fine.value} against ${ref.v}`);
}

// ── Lossless absorptance, band ends ──────────────────────────────────────────
{
    const got = finder(row('AMX', 450, 650), fabryPerot);
    assert.equal(got.value, 0, 'nothing absorbs, so A is zero');
    assert.equal(got.lambda, 450, 'and the row reports the band start');
}
{
    // The resonance sits below this band, so T is highest at its start.
    const op = row('TMX', 558.5, 580);
    const got = finder(op, fabryPerot);
    assert.equal(got.lambda, 558.5, 'a band end is the extremum when T falls into the band');
}

// ── A band entered high to low is the same band ──────────────────────────────
for (const [type, a, b, d] of [['TMX', 450, 700, coupled], ['TMX', 580, 558.5, fabryPerot], ['MXWT', 600, 500, fabryPerot]]) {
    const down = finder(row(type, a, b), d);
    const up = finder(row(type, b, a), d);
    assert.equal(down.value, up.value, `${type} ${a}-${b} reads as ${b}-${a}`);
    assert.equal(down.lambda, up.lambda);
}

// ── Under a cone every wavelength the search reads gets its settled rays ─────
{
    const coned = { ...fabryPerot, cone: { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15 } };
    const got = finder(row('TMX', 540, 580), coned);
    const T = lam => evaluateOperands([row('T', lam, lam)], buildEvalContext(coned, resolveMat))[0];
    let scanMax = 0;
    for (let i = 0; i <= 200; i++) scanMax = Math.max(scanMax, T(556 + i * 0.01));
    assert.ok(Math.abs(got.value - T(got.lambda)) < 1e-4,
        `the row reads ${got.value} at ${got.lambda} nm, a T row there ${T(got.lambda)}`);
    assert.ok(got.value > scanMax - 1e-4, `the row reads ${got.value}, a settled 0.01 nm scan ${scanMax}`);
}

console.log('PASS band_extremum_true_peak');
