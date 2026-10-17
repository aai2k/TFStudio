/**
 * The analytic needle scan runs on every merit the synthesis scores, and its
 * P-values match the finite-difference scan's.
 *
 * Every merit the Specification window writes has an OPGT or OPLT row. The
 * analytic scan takes such a row's needle slope by the chain rule through the
 * row it reads, the one the analytic Jacobian uses, and differences a row with
 * no exact needle slope (EFMX here) on its own per candidate. Each case checks
 * that the analytic scan runs, that its merit and candidates are the FD
 * scan's, that its P-values lie within TOLERANCE of the FD scan's at a
 * δ = 0.001 nm needle, and that both pick the same insertion. Where no row is
 * differenced the analytic scan runs at a 0.5 nm needle, at which a
 * difference would depart from the FD scan's P-values by far more than
 * TOLERANCE, and its P-values must not change at 0.001 nm: so the slopes are
 * checked exact, not differenced at the FD scan's needle. Cases: the
 * BBAR_VIS spec merit, also with an MNT row (which the scan skips, with its
 * weight kept out of the normalization), under a cone and in symmetric mode;
 * worst-case and central-wavelength (MXWT) spec rows; an MXWT row scored
 * directly; DIFF of Tp and Ts; an EFMX row and an OPLT reading it, both
 * differenced on their own. In every case the rows under test miss their
 * targets, so their slopes are checked and not a zero.
 *
 * P-function: Sullivan & Dobrowolski, Appl. Opt. 35, 5484 (1996); Tikhonravov
 * et al., Appl. Opt. 35, 5493 (1996).
 *
 * Run: node tests/needle_scan_spec_merits.mjs
 */
import assert from 'node:assert/strict';
import {
    makeOperand, makeConstraintOperand, scanNeedlesAnalytic, scanNeedlesFD,
    evaluateOperands, buildEvalContext, _operandResidual,
} from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { applyPreset } from '../src/utils/synthesis/qualifierPresets.js';
import { makeQualifier, qualifiersToMFOperands } from '../src/utils/synthesis/qualifiers.js';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();
const resolveMat = id => getMaterial(id);
const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));

// Needle of the FD scan, nm, and the one the analytic scan differences EFMX
// with in the cases holding it. The analytic P-value of every other row is the
// d → 0 limit, from which the forward difference departs by about ½·(∂P/∂d)·δ.
const DELTA_NM = 0.001;
// Needle of the analytic scan in the cases with no differenced row, nm. An
// exact slope does not depend on it; a scan differencing every row at this
// needle departs from the FD scan by 2 % to 60 % of the largest |P| over those
// cases, about ten times the tolerance below or more.
const EXACT_DELTA_NM = 0.5;
// Largest gap allowed between the two scans, as a fraction of the largest
// |P|. Over these cases the gap is at most 0.02 % at δ = 0.001 nm and 0.2 % at
// 0.01 nm, falling with δ as that truncation does, so 0.2 % leaves it a
// tenfold margin. Each row a case names adds at least half of the largest |P|,
// so its slope off by a factor or a sign moves P far past the tolerance.
const TOLERANCE = 0.002;

const H = ['TiO2', 57], L = ['SiO2', 94];
const rep = (n, pair) => Array.from({ length: n }, () => pair).flat();
const design = (spec, extra = {}) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: spec.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false })),
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side', ...extra,
});
// Irregular stacks, so no two insertions tie by symmetry.
const irregular = (n, hi, lo, scale) => Array.from({ length: n }, (_, i) => [
    i % 2 ? 'SiO2' : 'TiO2', (i % 2 ? lo : hi) * (1 + scale * Math.sin(1.7 * i + 0.3)),
]);
const bbar = irregular(20, 25, 60, 0.4);
const fabryPerot = [...rep(2, [H, L]), H, ['SiO2', 188], H, ...rep(2, [L, H])];
const mirror = irregular(16, 57, 94, 0.1);
const CONE = { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15 };

const spec = (...kinds) => qualifiersToMFOperands(kinds.map(k => makeQualifier(k)));
const mnt = () => makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 200, target: 30, weight: 1 });
const band = (type, a, b, target, extra = {}) => makeOperand({ type, lambdaStart: a, lambdaEnd: b, target, weight: 1, ...extra });

const bbarSpec = () => qualifiersToMFOperands(applyPreset('BBAR_VIS'));

// Each case: name, design, merit rows, the row types that must miss their
// target on that design, so the case checks their slope and not a zero, and
// whether the analytic scan differences one of its rows.
const CASES = [
    ['BBAR_VIS spec', design(bbar), bbarSpec, ['OPGT', 'OPLT']],
    ['BBAR_VIS spec with an MNT row', design(bbar), () => [...bbarSpec(), mnt()], ['OPGT', 'OPLT', 'MNT']],
    ['BBAR_VIS spec, 7.5° cone', design(bbar, { cone: CONE }), bbarSpec, ['OPGT', 'OPLT']],
    ['BBAR_VIS spec, symmetric', design(bbar.slice(0, 10), { surfaceMode: 'symmetric' }), bbarSpec, ['OPGT', 'OPLT']],
    ['worst-case spec: T min over the pass band, R max over the stop band', design(mirror), () => spec(
        { kind: 'MIN_MAX', channel: 'T', direction: 'min', cmp: 'ge', target: 0.95, lambdaStart: 750, lambdaEnd: 900 },
        { kind: 'MIN_MAX', channel: 'R', direction: 'max', cmp: 'le', target: 0.2, lambdaStart: 400, lambdaEnd: 440 },
    ), ['OPGT', 'OPLT']],
    // The peak sits at 557 nm: the OPLT row pulls it down and the OPGT row holds.
    ['central wavelength spec between 552 and 556 nm', design(fabryPerot), () => spec(
        { kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max', cmp: 'between', lo: 552, hi: 556, lambdaStart: 500, lambdaEnd: 600 },
    ), ['OPLT']],
    ['MXWT scored directly', design(fabryPerot), () => [band('MXWT', 500, 600, 540)], ['MXWT']],
    ['DIFF of Tp and Ts at 45°', design(mirror), () => {
        const p = band('T', 600, 600, 0, { aoi: 45, pol: 'p', weight: 0 });
        const s = band('T', 600, 600, 0, { aoi: 45, pol: 's', weight: 0 });
        return [band('RAV', 520, 580, 1), p, s, makeOperand({ type: 'DIFF', refId1: p.id, refId2: s.id, target: 0, weight: 1 })];
    }, ['DIFF']],
    ['EFMX, differenced on its own', design(mirror), () => [band('RAV', 520, 580, 1), band('EFMX', 550, 550, 0.2, { pol: 's' })], ['EFMX'], true],
    ['OPLT on EFMX, differenced on its own', design(mirror), () => {
        const field = band('EFMX', 550, 550, 0, { pol: 's', weight: 0 });
        return [band('RAV', 520, 580, 1), field, makeOperand({ type: 'OPLT', refId: field.id, target: 0.2, weight: 1 })];
    }, ['OPLT'], true],
];

// The types of the weighted rows that miss their target on design `d`.
function missing(operands, d) {
    const values = evaluateOperands(operands, buildEvalContext(d, resolveMat));
    return new Set(operands.filter((op, i) => op.weight > 0 && _operandResidual(op, values[i]) !== 0).map(op => op.type));
}

// Two candidates are one insertion when they share material and position, or
// when both are gaps bordering the same layer of the needle's own material:
// either one thickens that layer, and to first order in d both change the
// merit by the same amount.
function sameInsertion(a, b, layers) {
    if (a.materialId !== b.materialId || !!a.intra !== !!b.intra) return false;
    if (a.pos === b.pos) return true;
    if (a.intra || Math.abs(a.pos - b.pos) !== 1) return false;
    return layers[Math.min(a.pos, b.pos)]?.material === a.materialId;
}
const best = cands => cands.reduce((b, c) => (c.grad < b.grad ? c : b));
const label = c => `${c.materialId} ${c.intra ? `in layer ${c.layerK} at ${c.frac.toFixed(2)}` : `at gap ${c.pos}`}`;

for (const [name, d, opsOf, pulls, differenced = false] of CASES) {
    const operands = opsOf();
    const missed = missing(operands, d);
    for (const type of pulls) assert.ok(missed.has(type), `${name}: the ${type} row misses its target`);
    const args = { operands, design: d, resolveMat, candidateMats: POOL, deltaNm: DELTA_NM, side: 'front' };
    const analytic = scanNeedlesAnalytic(differenced ? args : { ...args, deltaNm: EXACT_DELTA_NM });
    assert.ok(analytic, `${name}: the analytic scan runs`);
    if (!differenced) {
        const fine = scanNeedlesAnalytic(args).candidates;
        assert.ok(analytic.candidates.every((c, i) => c.grad === fine[i].grad),
            `${name}: P is the same at a ${EXACT_DELTA_NM} nm and a ${DELTA_NM} nm needle`);
    }
    const fd = scanNeedlesFD(args);
    assert.equal(analytic.mf0, fd.mf0, `${name}: the same merit`);
    assert.equal(analytic.candidates.length, fd.candidates.length, `${name}: the same candidates`);
    let largest = 0, gap = 0;
    fd.candidates.forEach((c, i) => {
        const a = analytic.candidates[i];
        assert.ok(a.materialId === c.materialId && a.pos === c.pos, `${name}: candidate ${i} is the same insertion`);
        largest = Math.max(largest, Math.abs(c.grad));
        gap = Math.max(gap, Math.abs(a.grad - c.grad));
    });
    assert.ok(largest > 0, `${name}: the needle function is not flat`);
    const ba = best(analytic.candidates), bf = best(fd.candidates);
    console.log(`[${name}] gap ${(100 * gap / largest).toFixed(3)} % of the largest |P|; best ${label(ba)} (FD ${label(bf)})`);
    assert.ok(gap <= TOLERANCE * largest, `${name}: P-values within ${TOLERANCE * 100} % of the largest`);
    assert.ok(sameInsertion(ba, bf, d.frontLayers), `${name}: the same best insertion`);
}

console.log('PASS needle_scan_spec_merits');
