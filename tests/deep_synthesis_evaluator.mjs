/**
 * Deep Synthesis design, trace and evaluator (design.js, trace.js and
 * evaluator.js, ports of design.c, methods.c and refine.c).
 *
 *   1. design.js on hand-built stacks: insertion, removal and split geometry,
 *      normalize dropping and merging as the C does, removeThin, withoutLayer,
 *      the sameDesign tolerances, sameBits, mergedCount.
 *   2. trace.js: the stop rule (the target, 15 layers and 10%), the keeper's
 *      cap and strict improvement, record and appendPoints.
 *   3. The evaluator: ev.mf is calcMF on ev.designOf, ev.grad matches central
 *      differences, in every surface mode, with the other side fixed through
 *      refinement; the empty design; refine lowers the merit and keeps the
 *      floor; a refinement in two parts (27 then 60) ends on the design of one
 *      when the part carries the trust radius, and not when it drops it; the
 *      engine cache gives the same merit after an eviction. lamRef is the
 *      grid wavelength nearest the design's reference wavelength (550 nm by
 *      default), also on a span as wide as the lab's ar-3band.
 *   4. The medium whose index sets the angle in the active stack: the exit
 *      medium only for a back_only stack scored on its own. At 50 degrees a
 *      half-wave layer sized with that medium's index leaves the merit as it
 *      is, in back_only and front_only, side and total.
 *
 * Run: node tests/deep_synthesis_evaluator.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const T = await import('../src/utils/synthesis/deepSynthesis/trace.js');
const D = await import('../src/utils/synthesis/deepSynthesis/design.js');
const { calcMF, evaluateOperands, buildEvalContext } = await import('../src/utils/physics/optimizer/evalCore.js');
const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { presampleSynthesisMaterials } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');
const { makeEngine } = await import('../src/utils/optimizers/index.js');
const { DLSOptimizer, makeOperand } = await import('../src/utils/physics/optimizer.js');
const { makeEvaluator, newPart } = await import('../src/utils/synthesis/deepSynthesis/evaluator.js');

const base = { surfaceMode: 'front_only', mfEvalMode: 'side', incidentMedium: 'Air', exitMedium: 'Air',
               substrate: { material: 'BK7', thickness: 1 } };
const pool = ['TiO2', 'SiO2'];
function evaluatorFor(operands, over = {}) {
    const design = { ...(over.base ?? base), frontLayers: [], backLayers: [] };
    const materials = presampleSynthesisMaterials(design, operands, pool.map(id => ({ id, mat: getMaterial(id) })));
    const spec = { operands, base, side: 'front', otherLayers: [], pool, dMin: 20, dMax: Infinity, maxLayers: 8,
                   engine: ENGINE, refine: { maxIter: 60, plateau: 6, plateauGain: 1e-4 }, targetMf: 1e-4, ...over };
    return makeEvaluator(spec, { materials });
}
const fixture = (caseId, over) => evaluatorFor(caseById(caseId).ops.map(op => ({ ...op, enabled: true })), over);
const probe = makeEngine('trust-region', caseById('bbar').ops, caseById('bbar').thin(), getMaterial, {});
assert.notEqual(probe.constructor, DLSOptimizer, "makeEngine('trust-region') is registered");
const ENGINE = 'trust-region';

const L = (material, thickness) => ({ material, thickness });

// ── 1. design.js ──────────────────────────────────────────────────────────────
{
    const S = [L('H', 10), L('L', 100), L('H', 30)];
    assert.deepEqual(D.insertLayer(S, 0, 'M', 5), [L('M', 5), ...S], 'insert at the incident end');
    assert.deepEqual(D.insertLayer(S, 3, 'M', 5), [...S, L('M', 5)], 'insert at the substrate end');
    assert.deepEqual(D.removeLayer(S, 1), [L('H', 10), L('H', 30)], 'remove leaves the neighbours apart');
    assert.deepEqual(D.splitLayer(S, 1, { frac: 0.3, material: 'M', thickness: 7 }),
        [L('H', 10), L('L', 30), L('M', 7), L('L', 70), L('H', 30)], 'split: frac * d on the index-0 side');
    assert.deepEqual(S, [L('H', 10), L('L', 100), L('H', 30)], 'inputs are not changed');

    assert.deepEqual(D.normalize([L('H', 10), L('L', 0), L('H', 30), L('L', -2), L('L', 5)]), [L('H', 40), L('L', 5)],
        'normalize drops non-positive layers and merges the neighbours they separated');
    assert.deepEqual(D.normalize([L('H', 100), L('H', -5)]), [L('H', 100)], 'a negative layer is dropped, not merged');
    assert.deepEqual(D.normalize([L('H', 0.1), L('H', 0.2), L('H', 0.3)]), [L('H', 0.1 + 0.2 + 0.3)],
        'merged thicknesses add left to right');
    assert.deepEqual(D.normalize([L('H', 0), L('L', NaN)]), [], 'nothing left');

    assert.deepEqual(D.removeThin([L('H', 50), L('L', 0.5), L('H', 20), L('L', 3)], 1), [L('H', 70), L('L', 3)],
        'removeThin deletes the thin layer and merges its neighbours');
    assert.deepEqual(D.removeThin([L('H', 50), L('H', 20)], 1), [L('H', 50), L('H', 20)],
        'with nothing thin the design is left as it is (remove_thin normalizes only after a deletion)');
    assert.deepEqual(D.withoutLayer(S, 1), [L('H', 40)], 'withoutLayer merges the neighbours');
    assert.deepEqual(D.withoutLayer(S, 0), [L('L', 100), L('H', 30)]);

    const nRef = id => ({ H: 2, L: 1.5 }[id]);
    assert.equal(D.opticalThickness(nRef, S), 2 * 10 + 1.5 * 100 + 2 * 30);
    const held = mf => ({ layers: S, mf });
    const scaled = f => ({ layers: S.map(l => L(l.material, l.thickness * f)), mf: 0.1 });
    assert.ok(D.sameDesign(nRef, held(0.1 * (1 + 0.5e-9)), held(0.1)), 'merits within SAME_MF are the same');
    assert.ok(!D.sameDesign(nRef, held(0.1 * (1 + 2e-9)), held(0.1)), 'beyond SAME_MF they differ');
    assert.ok(D.sameDesign(nRef, scaled(1 + 0.5e-6), held(0.1)), 'optical thickness within SAME_OPT');
    assert.ok(!D.sameDesign(nRef, scaled(1 + 2e-6), held(0.1)), 'beyond SAME_OPT');
    assert.ok(!D.sameDesign(nRef, { layers: S.slice(0, 2), mf: 0.1 }, held(0.1)), 'another layer count');
    assert.ok(!D.sameDesign(nRef, held(Infinity), held(Infinity)), 'no move is never the same design');

    assert.ok(D.sameBits(S, S.map(l => ({ ...l }))), 'sameBits on a copy');
    assert.ok(!D.sameBits(S, [L('H', 10), L('L', 100 + 1e-13), L('H', 30)]), 'one ulp apart');
    assert.ok(!D.sameBits(S, [L('H', 10), L('M', 100), L('H', 30)]), 'another material');
    assert.ok(!D.sameBits(S, S.slice(0, 2)), 'another length');
    assert.ok(!D.sameBits([L('H', 0)], [L('H', -0)]), '0 and -0 differ, as in memcmp');

    const T0 = [L('H', 10), L('H', 0), L('L', 5), L('L', 5), L('H', 0), L('H', 3), L('H', -1)];
    assert.equal(D.mergedCount(T0), 3);
    assert.equal(D.mergedCount(T0), D.normalize(T0).length, 'mergedCount is the normalized length');
    assert.equal(D.mergedCount([]), 0);
}

// ── 2. trace.js ───────────────────────────────────────────────────────────────
{
    const tr = (...pts) => ({ points: pts.map(([n, mf]) => ({ mf, n })) });
    assert.equal(T.enough(T.makeTrace(), 1), false, 'an empty trace is never enough');
    assert.equal(T.enough(tr([3, 0.5], [4, 1e-4]), 1e-4), true, 'the best merit at the target');
    assert.equal(T.enough(tr([3, 0.5], [4, 2e-4]), 1e-4), false);
    assert.equal(T.enough(tr([3, 1e-5]), undefined), true, 'the default target is 1e-4');
    // 15 layers added since the design of merit 0.1 (n = 1)
    assert.equal(T.enough(tr([1, 0.1], [10, 0.099], [16, 0.0905]), 1e-4), true, 'less than 10% in 15 layers');
    assert.equal(T.enough(tr([1, 0.1], [10, 0.099], [16, 0.089]), 1e-4), false, 'more than 10% in 15 layers');
    assert.equal(T.enough(tr([1, 0.1], [15, 0.0999]), 1e-4), false, 'fewer than 15 layers added: no verdict');
    assert.equal(T.enough(tr([1, 0.1], [5, 0.08], [20, 0.079]), 1e-4), true);
    assert.equal(T.enough(tr([1, 0.1], [5, 0.08], [20, 0.079], [10, 0.3]), 1e-4), false,
        'the window ends at the last point\'s layer count (10: no point 15 layers back)');
    assert.equal(T.enough(tr([1, 0.1], [2, 0.05], [17, 0.0455]), 1e-4), true, 'the best of the points 15 layers back');

    const keep = T.makeKeeper(2);
    T.offer(keep, 0.5, [L('H', 1), L('L', 2), L('H', 3)]);
    assert.deepEqual([keep.layers, keep.mf], [null, Infinity], 'over the cap is not kept');
    const two = [L('H', 1), L('L', 2)];
    T.offer(keep, 0.4, two);
    two[0].thickness = 99;
    assert.deepEqual([keep.layers, keep.mf], [[L('H', 1), L('L', 2)], 0.4], 'kept as a copy');
    T.offer(keep, 0.4, [L('H', 5)]);
    assert.equal(keep.layers.length, 2, 'an equal merit does not replace');
    T.offer(keep, 0.3, [L('H', 5)]);
    assert.deepEqual([keep.layers, keep.mf], [[L('H', 5)], 0.3], 'a lower merit within the cap does');
    T.offer(null, 0.1, [L('H', 5)]);

    const log = { trace: T.makeTrace(), keep: T.makeKeeper(1) };
    T.record(log, 0.2, [L('H', 5)]);
    T.record(log, 0.1, [L('H', 5), L('L', 6)]);
    assert.deepEqual(log.trace.points, [{ mf: 0.2, n: 1 }, { mf: 0.1, n: 2 }], 'record pushes merit and layer count');
    assert.equal(log.keep.mf, 0.2, 'and offers to the keeper');
    T.appendPoints(log.trace, [{ mf: 0.05, n: 3 }]);
    assert.deepEqual(log.trace.points.at(-1), { mf: 0.05, n: 3 }, 'appendPoints adds another run\'s points');
}

// ── 3. The evaluator ──────────────────────────────────────────────────────────
const ev = fixture('bbar');
{
    const S = [L('TiO2', 30), L('SiO2', 50), L('TiO2', 100)];
    const centralGrad = (e, layers, h = 1e-3) => layers.map((_, k) => {
        const at = dx => layers.map((l, i) => L(l.material, l.thickness + (i === k ? dx : 0)));
        return (e.mf(at(h)) - e.mf(at(-h))) / (2 * h);
    });
    const checkOptics = (e, what) => {
        const direct = calcMF(e.operands, evaluateOperands(e.operands, buildEvalContext(e.designOf(S), e.resolveMat)));
        assert.equal(e.mf(S), direct, `${what}: ev.mf is calcMF on ev.designOf`);
        const g = e.grad(S), fd = centralGrad(e, S);
        const scale = Math.max(...fd.map(Math.abs));
        g.forEach((x, k) => assert.ok(Math.abs(x - fd[k]) <= 1e-5 * scale, `${what}: dMF/dd of layer ${k} (${x} vs ${fd[k]})`));
        const R = e.refine(S);
        assert.ok(R.mf < e.mf(S), `${what}: refinement lowers the merit`);
        assert.equal(e.mf(R.layers), R.mf, `${what}: the other side stays where it was`);
    };
    checkOptics(ev, 'front_only');
    const other = [L('SiO2', 110), L('TiO2', 25)];
    const modes = [['both_independent', 'total', 'front'], ['symmetric', 'total', 'front'],
        ['back_only', 'side', 'back'], ['front_only', 'total', 'front']];
    for (const [surfaceMode, mfEvalMode, side] of modes) {
        const e = fixture('bbar', { base: { ...base, surfaceMode, mfEvalMode }, side, otherLayers: other });
        const d = e.designOf(S);
        const [act, oth] = side === 'back' ? [d.backLayers, d.frontLayers] : [d.frontLayers, d.backLayers];
        assert.deepEqual(act.map(l => [l.id, l.material, l.thickness, l.locked]),
            S.map((l, i) => ['L' + i, l.material, l.thickness, false]), `${surfaceMode}: the active side`);
        if (surfaceMode === 'symmetric') {
            assert.deepEqual(oth.map(l => l.material), S.map(l => l.material).reverse(), 'symmetric: the back mirrors the front');
        } else {
            assert.deepEqual(oth.map(l => [l.id, l.thickness, l.locked]),
                other.map((l, i) => ['O' + i, l.thickness, surfaceMode === 'both_independent']),
                `${surfaceMode}: the other side, locked only in both_independent`);
        }
        checkOptics(e, `${surfaceMode}/${mfEvalMode}`);
    }

    // The empty design: the bare substrate.
    const bare = calcMF(ev.operands, evaluateOperands(ev.operands, buildEvalContext(ev.designOf([]), ev.resolveMat)));
    assert.ok(Number.isFinite(bare) && ev.mf([]) === bare, 'the empty design evaluates');
    assert.deepEqual(ev.grad([]), []);
    assert.deepEqual(ev.refine([]), { layers: [], mf: bare, iters: 0 });

    // Grid and indices.
    assert.deepEqual([ev.lamMin, ev.lamMax], [ev.lambdas[0], ev.lambdas.at(-1)]);
    const nearest = (e, nm) => e.lambdas.every(l => Math.abs(l - nm) >= Math.abs(e.lamRef - nm));
    assert.ok(ev.lambdas.includes(ev.lamRef) && nearest(ev, 550), 'lamRef: the grid point nearest 550 nm by default');
    assert.equal(ev.nRef('TiO2'), ev.n('TiO2', ev.lamRef));
    // Three R = 0 bands from 400 to 4950 nm, as the lab's ar-3band: the
    // reference is the design's, not the middle of the span (about 2700 nm).
    const bands = [[400, 700], [900, 1700], [3500, 4950]].map(([a, b]) => makeOperand(
        { type: 'RGT', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 }));
    const wide = evaluatorFor(bands);
    assert.ok(nearest(wide, 550) && Math.abs(wide.lamRef - 550) < 5, `wide span: lamRef ${wide.lamRef} nm`);
    const set = evaluatorFor(bands, { referenceWavelength: 1300 });
    assert.ok(set.lambdas.includes(set.lamRef) && nearest(set, 1300), `the design's reference wavelength: ${set.lamRef} nm`);
    assert.equal(set.nRef('SiO2'), set.n('SiO2', set.lamRef));
    assert.equal(ev.incident, 'Air');
    assert.deepEqual(ev.candidateMats.map(c => c.id), pool);

    // Refinement at the floor, and in parts: bs without a floor runs to the
    // 60-iteration cap and thins a layer to zero, which the clean passes remove.
    // With the plateau off no restart of its window can change the path, so
    // the two parts end on the design of one refinement exactly when the part
    // carries the trust radius.
    const R = ev.refine(S);
    assert.ok(R.layers.every(l => l.thickness >= ev.floor), 'every layer at or above dMin');
    const bs0 = fixture('bs', { dMin: 0, refine: { maxIter: 60, plateau: 0, plateauGain: 1e-4 } });
    const S6 = [L('TiO2', 30), L('SiO2', 50), L('TiO2', 100), L('SiO2', 90), L('TiO2', 40), L('SiO2', 120)];
    const one = bs0.refine(S6);
    const first = bs0.refinePart({ layers: S6, prep: null, part: newPart() }, 27);
    assert.deepEqual([first.part.iters, first.part.done], [27, false], 'the first part stops at 27 iterations');
    assert.ok(first.part.state.delta > 0, 'and carries its trust radius');
    assert.equal(bs0.refinePart(first, 27), first, 'a part already at its cap comes back unchanged');
    const second = bs0.refinePart(first, 60);
    assert.ok(second.part.done && second.part.iters === 60, 'the second part ends the refinement');
    assert.equal(bs0.refinePart(second, 60), second, 'a finished part comes back unchanged');
    assert.ok(D.sameBits(second.layers, one.layers) && second.part.mf === one.mf,
        'a refinement in two parts ends on the same design as one when the radius is carried');
    const dropped = bs0.refinePart({ ...first, part: { ...first.part, state: {} } }, 60);
    assert.ok(!D.sameBits(dropped.layers, one.layers), 'a part resumed at the starting radius ends on another design');
    assert.ok(one.layers.length < S6.length && one.layers.every(l => l.thickness > 0), 'the clean passes drop the zero layer');
    assert.equal(bs0.mf(one.layers), one.mf);

    // More material sequences than the engine cache holds, then the first again.
    const before = ev.mf(S);
    for (let k = 0; k < 20; k++) ev.mf(Array.from({ length: k + 1 }, (_, i) => L(pool[i % 2], 40)));
    assert.equal(ev.mf(S), before, 'the same merit after the engine was evicted');
}

// ── 4. The medium that sets the angle in the active stack ─────────────────────
// A back_only stack scored on its own is lit from the exit medium; scored with
// the whole system it is lit through the substrate, where Snell's law carries
// the angle from the incident medium. A SiO2 layer a half wave thick at the
// angle it has when the light comes from ev.incident is an absentee layer.
{
    const op = makeOperand({ type: 'T', lambdaStart: 550, aoi: 50, pol: 'avg', target: 1, weight: 1 });
    const operands = [{ ...op, enabled: true }];
    const S = [L('TiO2', 80), L('SiO2', 100), L('TiO2', 60)];
    const halfWave = e => {
        const n = e.n('SiO2', 550), s = e.n(e.incident, 550) * Math.sin(50 * Math.PI / 180) / n;
        return 550 / (2 * n * Math.sqrt(1 - s * s));
    };
    const modes = [['back_only', 'side', 'SiO2'], ['back_only', 'total', 'Air'],
        ['front_only', 'side', 'Air'], ['front_only', 'total', 'Air']];
    for (const [surfaceMode, mfEvalMode, incident] of modes) {
        const e = evaluatorFor(operands, { base: { ...base, surfaceMode, mfEvalMode, exitMedium: 'SiO2' }, dMin: 0,
            side: surfaceMode === 'back_only' ? 'back' : 'front', otherLayers: [L('SiO2', 70), L('TiO2', 50)] });
        assert.equal(e.incident, incident, `${surfaceMode}/${mfEvalMode}: light enters from ${incident}`);
        const mf = e.mf(S);
        const absent = e.mf(D.splitLayer(S, 0, { frac: 0.5, material: 'SiO2', thickness: halfWave(e) }));
        assert.ok(Math.abs(absent - mf) <= 1e-9 * mf, `${surfaceMode}/${mfEvalMode}: the half-wave layer is absent (${absent} vs ${mf})`);
    }
}

console.log(`All Deep Synthesis design, trace and evaluator tests passed (engine ${ENGINE}).`);
