/**
 * A cone's rays computed together, one kernel call per pass at a wavelength,
 * give what the rays computed one at a time give, bit for bit.
 *
 * On the single-cavity 1550 nm filter (_coneFilter.mjs) with a dispersive,
 * absorbing high index and one 0 nm layer, in five surface setups: front
 * only, back only, front only scored on the total with a back coating,
 * symmetric, and both sides independent, all on an absorbing substrate so the
 * full system's bulk pass is not 1. Each setup under a 6° uniform cone about
 * the normal (its rays include normal incidence, where p is read as s) and
 * about a 12° axis; two under a 20° cone about a 15° axis, which contains the
 * normal, and a 75° axis, which reaches past grazing:
 *   1. The cone average of R, T and A in s, p and their mean (tmmProp) equals
 *      the weighted sum of tmmPropSingle over the same rays, at every sample
 *      of a band row, and the mean reads no ray one at a time.
 *   2. The mean at each count the doubling tries, each count adding its new
 *      rays to those already held, equals the weighted sum at that count.
 *   3. The Jacobian packages of a cone's rays computed together, for s and p
 *      and for p alone, equal those computed one ray at a time
 *      (jacobianAssembly/packageCache.js).
 *   4. So do the needle scan results (scanners/needleScanPasses.js), in the
 *      setups the analytic scan runs in.
 *
 * Run: node tests/cone_rays_batched.mjs
 */
import assert from 'node:assert/strict';
import { initWasmForTest, getTmmWasm } from './_wasmInit.mjs';
import { filterLayers } from './_coneFilter.mjs';

await initWasmForTest();
const { buildEvalContext, evaluateOperands, makeOperand, DLSOptimizer, operandSampleLambdas, effectiveBackLayers } =
    await import('../src/utils/physics/optimizer.js');
const { tmmProp, tmmPropSingle, coneNodesAt, inConeRow } = await import('../src/utils/physics/optimizer/evalCore/tmmEval.js');
const { coneAverage } = await import('../src/utils/physics/optimizer/evalCore/coneRays.js');
const { coneNodes } = await import('../src/utils/physics/optimizer/coneAngle.js');
const { _surfaceLayout } = await import('../src/utils/physics/optimizer/jacobianAssembly.js');
const { layerJacobianStacks } = await import('../src/utils/physics/optimizer/jacobianAssembly/layerJacobian.js');
const { makePackageCache } = await import('../src/utils/physics/optimizer/jacobianAssembly/packageCache.js');
const { _makeScanAt } = await import('../src/utils/physics/optimizer/scanners/needleScanPasses.js');

const mk = (id, n, k = 0) => ({ id, name: id, getNK: () => [n, k] });
const MATS = {
    H: { id: 'H', name: 'H', getNK: lam => [2.25 + 2.4e5 / (lam * lam), 1e-4] },
    L: mk('L', 1.46), Air: mk('Air', 1.0), Sub: mk('Sub', 1.52, 2e-7),
};
const resolveMat = id => MATS[id];
const NARROW = { enabled: true, halfAngleDeg: 6, distribution: 'uniform', gridPoints: 15 };
const WIDE = { ...NARROW, halfAngleDeg: 20 };

const front = [...filterLayers().slice(0, 5), { id: 'zero', material: 'H', thickness: 0, locked: false }, ...filterLayers().slice(5)];
const backCoating = ['H', 'L', 'H'].map((material, i) => ({ id: `b${i}`, material, thickness: 100 + 20 * i, locked: false }));
const base = { incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'Sub', thickness: 1 } };
const SETUPS = {
    'front only':          { ...base, surfaceMode: 'front_only', mfEvalMode: 'side', frontLayers: front, backLayers: [] },
    'back only':           { ...base, surfaceMode: 'back_only', mfEvalMode: 'side', frontLayers: [], backLayers: front },
    'front only on total': { ...base, surfaceMode: 'front_only', mfEvalMode: 'total', frontLayers: front, backLayers: backCoating },
    'symmetric':           { ...base, surfaceMode: 'symmetric', mfEvalMode: 'side', frontLayers: front, backLayers: [] },
    'both independent':    { ...base, surfaceMode: 'both_independent', mfEvalMode: 'side', frontLayers: front, backLayers: backCoating },
};
const CASES = [
    ...Object.keys(SETUPS).flatMap(name => [0, 12].map(axis => ({ name, cone: NARROW, axis }))),
    { name: 'front only', cone: WIDE, axis: 15 },
    { name: 'both independent', cone: WIDE, axis: 75 },
];
const CHANNELS = ['avg', 's', 'p'].flatMap(pol => ['R', 'T', 'A'].map(char => ({ pol, char })));

// Two results are the same when every number in them has the same bits.
function same(a, b, where) {
    if (typeof a === 'number') { assert.ok(Object.is(a, b), `${where}: ${a} computed together, ${b} one ray at a time`); return; }
    if (a === null || typeof a !== 'object') { assert.equal(a, b, where); return; }
    const keys = Object.keys(a);
    assert.deepEqual(keys, Object.keys(b), `${where}: keys`);
    for (const key of keys) same(a[key], b[key], `${where}.${key}`);
}

// What `fn` returns and how many times it called the kernel's `name`.
const kernel = getTmmWasm();
function counted(name, fn) {
    const real = kernel[name];
    let calls = 0;
    kernel[name] = function countedCall(...args) { calls++; return real.apply(this, args); };
    try { return { value: fn(), calls }; } finally { kernel[name] = real; }
}

const bandRow = axis => ({
    ...makeOperand({ type: 'TAV', lambdaStart: 1545, lambdaEnd: 1552, aoi: axis, pol: 'avg', target: 1, weight: 1 }),
    id: 'band', bandPoints: 8,
});
const perRay = (ctx, lam, nodes, { pol, char }) => nodes.reduce(
    (acc, node) => acc + node.weight * tmmPropSingle(lam, node.aoiDeg, pol, char, ctx, ctx.frontThicks, ctx.frontMats), 0);

// ── 1. the merit's cone average ──────────────────────────────────────────────
function checkMerit(label, ctx, op, lams) {
    const axis = op.aoi;
    inConeRow(ctx, op, () => lams.forEach(lam => {
        const nodes = coneNodesAt(ctx, axis, lam);
        assert.ok(nodes.length > 1, `${label}: ${lam} nm is under the cone`);
        assert.equal(nodes.some(node => node.aoiDeg === 0), axis < ctx.cone.halfAngleDeg,
            `${label}: normal incidence is a ray when the cone contains the normal`);
        for (const read of CHANNELS) {
            const average = counted('rta', () => tmmProp(lam, axis, read.pol, read.char, ctx, ctx.frontThicks, ctx.frontMats));
            if (read.pol === 'avg') assert.equal(average.calls, 0, `${label}: the mean at ${lam} nm reads no ray one at a time`);
            same(average.value, perRay(ctx, lam, nodes, read), `${label}, ${read.char} ${read.pol} at ${lam} nm`);
        }
    }));
}

// ── 2. every count the doubling tries ────────────────────────────────────────
function checkDoubling(label, design, axis, lams) {
    const ctx = buildEvalContext(design, resolveMat);
    evaluateOperands([], ctx);
    const read = { pol: 'avg', char: 'T', thicknesses: ctx.frontThicks, mats: ctx.frontMats };
    const steps = [lams[0], lams[lams.length - 1]].flatMap(lam => [15, 30, 60, 120, 240, 480].map(count => ({ lam, count })));
    for (const { lam, count } of steps) {
        const nodes = coneNodes(ctx.cone, axis, count);
        same(coneAverage(ctx, lam, nodes, read), perRay(ctx, lam, nodes, read), `${label}, T at ${lam} nm on ${count} intervals`);
    }
}

// For s and p together and for p alone, every result a cache made by `make`
// holds after fill() equals the one a fresh cache computes at that ray, and
// reading it calls the kernel's one-ray `call` no more.
function checkFilled(label, call, make, lam, rays) {
    for (const pols of [['s', 'p'], ['p']]) {
        const together = make();
        const oneByOne = make();
        together.fill(lam, pols, rays);
        const reads = pols.flatMap(pol => rays.map(ray => ({ pol, aoi: ray.aoiDeg })));
        for (const { pol, aoi } of reads) {
            const held = counted(call, () => together.at(lam, pol, aoi));
            assert.equal(held.calls, 0, `${label}: ${call} ${pol} at ${aoi}° was computed with the other rays`);
            same(held.value, oneByOne.at(lam, pol, aoi), `${label}, ${call} ${pol} at ${lam} nm, ${aoi}°`);
        }
    }
}

// ── 3. the Jacobian packages ─────────────────────────────────────────────────
function checkJacobian(label, design, op, lams) {
    const engine = new DLSOptimizer([op], design, resolveMat);
    const thk = engine.thicknesses;
    const ctx = engine._ctxFor(thk);
    evaluateOperands([op], ctx);
    const { mode } = _surfaceLayout(engine.surfaceMode || 'front_only', !!engine.evalFullSystem);
    const jacCfg = {
        mode, n0mat: engine.n0mat, nsmat: engine.nsmat, neMat: engine.neMat, mats: engine.mats,
        thk, N: thk.length, ctx, subThickMm: engine.substrateThicknessMm,
    };
    const cfg = { ...jacCfg, stacks: layerJacobianStacks(jacCfg) };
    for (const lam of [lams[0], lams[4]]) {
        const rays = inConeRow(ctx, op, () => coneNodesAt(ctx, op.aoi, lam));
        checkFilled(label, 'jacobian', () => makePackageCache(cfg), lam, rays);
    }
}

// ── 4. the needle scan ───────────────────────────────────────────────────────
function checkNeedle(label, design, rays, lam) {
    const frontLayers = design.frontLayers;
    const back = effectiveBackLayers(design);
    const single = design.surfaceMode === 'front_only' || design.surfaceMode === 'back_only';
    const cfg = {
        surfaceMode: design.surfaceMode, side: design.surfaceMode === 'back_only' ? 'back' : 'front', isFull: !single,
        front: frontLayers, back, Nf: frontLayers.length, Nb: back.length, nIntra: 2,
        frontMats: frontLayers.map(l => resolveMat(l.material)), backMats: back.map(l => resolveMat(l.material)),
        n0mat: MATS.Air, nsmat: MATS.Sub, neMat: MATS.Air,
        candidateMats: [{ id: 'H', mat: MATS.H }, { id: 'L', mat: MATS.L }], fracs: [1 / 3, 2 / 3],
        subThickMm: design.substrate.thickness, coneActive: true,
    };
    checkFilled(label, 'needleScan', () => _makeScanAt(cfg), lam, rays);
}

for (const { name, cone, axis } of CASES) {
    const label = `${name}, ${cone.halfAngleDeg}° cone, axis ${axis}°`;
    const design = { ...SETUPS[name], cone };
    const op = bandRow(axis);
    const lams = operandSampleLambdas(op);
    const ctx = buildEvalContext(design, resolveMat);
    evaluateOperands([op], ctx);
    checkMerit(label, ctx, op, lams);
    checkDoubling(label, design, axis, lams);
    checkJacobian(label, design, op, lams);
    // A total merit on one side declines the analytic needle scan.
    if (name !== 'front only on total') {
        checkNeedle(label, design, inConeRow(ctx, op, () => coneNodesAt(ctx, axis, lams[2])), lams[2]);
    }
}

console.log('PASS: cone_rays_batched');
