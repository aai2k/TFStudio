/**
 * Deep Synthesis search (moves.js, search.js, start.js, capabilities.js,
 * jobs.js, runner.js and index.js, a port of giga4.c) and its two worker jobs.
 *
 *   1. roulette: disallowed operators are never drawn; one draw each call.
 *   2. drawMove: the draws in the C's order with a counting generator, the
 *      point draw skipped without pass points, the melt material bump, the
 *      drop placement and the copy window shortened when its ends match.
 *   3. destroy: melt keeps the optical thickness, drop and half change one
 *      layer by a half wave, floor deletes the held layers, copy doubles the
 *      window.
 *   4. memo keys and lookups.
 *   5. The acceptance rule on a synthetic round sequence: scores, the stale
 *      rule, the return to the record, the gone list, new bests.
 *   6. capabilities on bbar, bandpass, bs, with a cone, two-sided scoring and
 *      an operand without exact curvature, agreeing with
 *      LSQEngine._fullNewtonSupported; blockedReason.
 *   7. Repairs: runChild's refine, carve and pair children, and the pair
 *      child with no room.
 *   8. runSearch lowers the merit from a refined start, within the cap and
 *      the floor, stops on Stop, and goes on after a regrid; runStart trims a
 *      start above the cap.
 *   9. The worker path: rung and child jobs through dispatchSynthesisJob with
 *      makeResolveMat give what the serial runner gives.
 *  10. One against N workers: runDeepSynthesis on bbar (from no design at a
 *      cap of 8, and from two layers at 6) with the serial runner and with a
 *      pool of 3 that runs its jobs backwards and settles them in reverse
 *      order; the same design, merit, trace, statistics and events. A
 *      rejected job ends the run on the best design so far, and so does a
 *      Stop the serial runner sees in the middle of a batch: at or below
 *      every design within the cap the run recorded, gradual evolution's and
 *      the comb's kept designs included. opts.race reaches the races.
 *  11. The run from two layers on real synthesis workers (WorkerPool over
 *      node:worker_threads) at 1 and 3 threads, against the serial run.
 *
 * Run: node tests/deep_synthesis_search.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest, TMMCORE_WASM_PATH } from './_wasmInit.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { presampleSynthesisMaterials } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');
const { makeEngine } = await import('../src/utils/optimizers/index.js');
const { DLSOptimizer, LSQEngine, makeOperand } = await import('../src/utils/physics/optimizer.js');
const { makeEvaluator, newPart } = await import('../src/utils/synthesis/deepSynthesis/evaluator.js');
const { makeTrace } = await import('../src/utils/synthesis/deepSynthesis/trace.js');
const { opticalThickness, sameBits } = await import('../src/utils/synthesis/deepSynthesis/design.js');
const { SPACERS } = await import('../src/utils/synthesis/deepSynthesis/needleHelpers.js');
const { targetPoints, passIndices, halfWave } = await import('../src/utils/synthesis/deepSynthesis/points.js');
const M = await import('../src/utils/synthesis/deepSynthesis/moves.js');
const { memoKey, memoFind, searchState, judgeRound, runSearch } = await import('../src/utils/synthesis/deepSynthesis/search.js');
const { runStart } = await import('../src/utils/synthesis/deepSynthesis/start.js');
const { deepSynthesisParts, statusParts, blockedReason } = await import('../src/utils/synthesis/deepSynthesis/capabilities.js');
const { runDeepSynthesisJob } = await import('../src/utils/synthesis/deepSynthesis/jobs.js');
const { makeSerialRunner, makePoolRunner, RunnerFailure } = await import('../src/utils/synthesis/deepSynthesis/runner.js');
const { RACE } = await import('../src/utils/synthesis/deepSynthesis/race.js');
const { runDeepSynthesis, DEEP_SYNTHESIS_DEFAULTS } = await import('../src/utils/synthesis/deepSynthesis/index.js');
const { makeRng } = await import('../src/utils/synthesis/structuralOptimizer.js');
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');
const { WorkerPool } = await import('../src/utils/workers/workerPool.js');
const { SYNTHESIS_WORKER_URL } = await import('../src/workerUrls.js');
const { initTmmWasmMainThread, getTmmWasmBytesForWorker } = await import('../src/tmmcore.js');

// Step 1's engine is required: no fallback to another engine here.
const probe = makeEngine('trust-region', caseById('bbar').ops, caseById('bbar').thin(), getMaterial, {});
assert.notEqual(probe.constructor, DLSOptimizer, "makeEngine('trust-region') is registered");
const ENGINE = 'trust-region';

const base = { surfaceMode: 'front_only', mfEvalMode: 'side', incidentMedium: 'Air', exitMedium: 'Air',
               substrate: { material: 'BK7', thickness: 1 } };
const pool = ['TiO2', 'SiO2'];
// extra: { ops } added to the case's operands, { base } over the media.
function fixture(caseId, over = {}, extra = {}) {
    const operands = [...caseById(caseId).ops.map(op => ({ ...op, enabled: true })), ...(extra.ops ?? [])];
    const media = { ...base, ...extra.base };
    const design = { ...media, frontLayers: [], backLayers: [] };
    const materials = presampleSynthesisMaterials(design, operands, pool.map(id => ({ id, mat: getMaterial(id) })));
    const spec = { operands, base: media, side: 'front', otherLayers: [], pool, dMin: 20, dMax: Infinity, maxLayers: 8,
                   engine: ENGINE, refine: { maxIter: 60, plateau: 6, plateauGain: 1e-4 }, targetMf: 1e-4, ...over };
    return makeEvaluator(spec, { materials });
}

const L = (material, thickness) => ({ material, thickness });
const near = (a, b, rel = 1e-12) => Math.abs(a - b) <= rel * Math.abs(b);
const noop = () => {};

// A generator that returns `values` in turn and counts its draws.
function counting(values) {
    const rng = () => values[rng.calls++ % values.length];
    rng.calls = 0;
    return rng;
}

const ev = fixture('bbar');
const { points } = targetPoints(ev);
const pass = passIndices(points);

// ── 1. roulette ───────────────────────────────────────────────────────────────
{
    const w = [1, 2, 3], ok = [true, false, true];
    const at = u => M.roulette(counting([u]), w, ok);
    assert.deepEqual([0, 0.24, 0.25, 0.99].map(at), [0, 0, 2, 2], 'weight 1 then 3 over a sum of 4; 1 is never drawn');
    const none = counting([0.5]);
    assert.equal(M.roulette(none, w, [false, false, false]), -1, 'nothing allowed');
    assert.equal(none.calls, 1, 'one draw even so');
    assert.equal(M.roulette(counting([0.999]), [1, 1], [true, true]), 1, 'the last allowed at the top end');
    console.log('ok 1  roulette');
}

// ── 2. drawMove ───────────────────────────────────────────────────────────────
{
    const stub = { pool, maxLayers: 8, floor: 20 };
    const four = [L('TiO2', 50), L('SiO2', 80), L('TiO2', 60), L('SiO2', 90)];
    const weights = { destroy: [1, 1, 1, 1, 1], repair: [1, 1, 1] };
    const ctx = { ev: stub, layers: four, bound: [0, 2], thick: [], points: [], pass: [], weights,
                  okRepair: [true, true, true] };
    // Allowed: melt, floor, copy (wmax 2, wcopy 2). Draws: destroy, repair, w, k0, mat, count, layer, spacer.
    const rng = counting([0.0, 0.5, 0.6, 0.5, 0.1, 0.7, 0.9, 0.4]);
    assert.deepEqual(M.drawMove(rng, ctx),
        { destroy: 0, repair: 1, w: 2, k0: 1, mat: 0, count: 2, layer: 2, point: -1, spacer: 1.5 },
        'every field from its draw, in the order of giga4.c 698-707');
    assert.equal(rng.calls, 8, 'no point draw without pass points');

    const withPass = counting([0.0, 0.5, 0.6, 0.5, 0.1, 0.7, 0.9, 0.6, 0.4]);
    const m = M.drawMove(withPass, { ...ctx, pass: [3, 7] });
    assert.deepEqual([m.point, m.spacer, withPass.calls], [7, 1.5, 9], 'the point drawn between the layer and the spacer');

    const bump = M.drawMove(counting([0.0, 0.0, 0.1, 0.3, 0.9, 0, 0, 0]), ctx);
    assert.deepEqual([bump.w, bump.k0, bump.mat], [1, 1, 0], 'a one-layer melt does not keep the layer\'s material');

    const copy = counting([0.9, 0.0, 0.6, 0.5, 0.1, 0.7, 0.9, 0.4, 0.5, 0.99]);
    const c = M.drawMove(copy, ctx);
    assert.deepEqual([c.destroy, c.w, c.k0, copy.calls], [4, 2, 2, 10], 'copy: w in 2..wcopy, then k0');
    const seven = [...four, L('TiO2', 70), L('SiO2', 40), L('TiO2', 30)];
    const short = M.drawMove(counting([0.9, 0, 0, 0, 0, 0, 0, 0, 0.9, 0.0]),
        { ...ctx, ev: { ...stub, maxLayers: 12 }, layers: seven });
    assert.deepEqual([short.destroy, short.w, short.k0], [4, 2, 0], 'a copy window whose ends match is one shorter');

    const empty = counting([0.5]);
    assert.equal(M.drawMove(empty, { ...ctx, layers: [], bound: [] }), null, 'no destroy on an empty design');
    assert.equal(empty.calls, 8, 'the draws are made even so');

    // Drop on real optics: SiO2 300 nm can lose a half wave anywhere in 420-680
    // nm, SiO2 250 nm only at the shorter wavelengths, TiO2 50 nm nowhere.
    const three = [L('SiO2', 300), L('TiO2', 50), L('SiO2', 250)];
    const thick = M.dropLayers(ev, three, points, pass);
    assert.deepEqual(thick, [0, 2], 'the layers that can drop a half wave');
    const dctx = { ev, layers: three, bound: [], thick, points, pass, weights, okRepair: [true, true, true] };
    const draws = [0.5, 0.2, 0.3, 0.9, 0.1, 0.5, 0.5, 0.5, 0.2, 0.99, 0.6, 0.3];
    const drng = counting(draws);
    const d = M.drawMove(drng, dctx);
    const can = pass.filter(i => M.canDrop(ev, three, 2, points[i]));
    assert.deepEqual([d.destroy, d.layer, d.point, d.k0, d.w, drng.calls],
        [1, 2, can[Math.floor(0.6 * can.length)], 2, 1, 12], 'drop: the layer, the q-th pass point where it can, the window');
    assert.ok(can.length > 0 && can.length < pass.length, 'some pass points only');
    console.log('ok 2  drawMove');
}

// ── 3. destroy ────────────────────────────────────────────────────────────────
{
    const D = [L('SiO2', 100), L('TiO2', 50), L('SiO2', 80), L('TiO2', 60), L('SiO2', 90)];
    const frozen = JSON.stringify(D);
    const opt = layers => opticalThickness(ev.nRef, layers);
    const move = over => ({ destroy: 0, repair: 0, k0: 1, w: 2, mat: 0, count: 1, layer: 1, point: -1, spacer: 1, ...over });
    const run = (over, bound = []) => M.destroy(ev, D, move(over), { bound, points });

    const melt = run({ destroy: 0, k0: 1, w: 2, mat: pool.indexOf('TiO2') });
    assert.deepEqual(melt.layers.map(l => l.material), ['SiO2', 'TiO2', 'SiO2'], 'melt: one TiO2 layer, merged with the next');
    assert.ok(near(opt(melt.layers), opt(D), 1e-12), 'melt keeps the optical thickness at the reference wavelength');
    assert.deepEqual([melt.k0, melt.k1], [1, 2], 'the window is the new layer');
    const up = run({ destroy: 0, k0: 1, w: 1, mat: pool.indexOf('SiO2') });
    assert.deepEqual([up.layers.length, up.k0, up.k1], [3, 0, 1], 'a melt into its upper neighbour\'s material');
    const thin = M.destroy(ev, [L('SiO2', 100), L('TiO2', 1)], move({ k0: 1, w: 1, mat: 1 }), { bound: [], points });
    assert.deepEqual(thin.layers, [L('SiO2', 120)], 'the melted layer is at least the floor');

    const hw = halfWave(ev, 'SiO2', points[pass[0]]);
    const drop = M.destroy(ev, [L('SiO2', 300), ...D.slice(1)], move({ destroy: 1, layer: 0, point: pass[0], k0: 0, w: 2 }),
        { bound: [], points });
    assert.equal(drop.layers[0].thickness, 300 - hw, 'drop: minus a half wave at the pass point');
    assert.deepEqual([drop.layers.slice(1), drop.k0, drop.k1], [D.slice(1), 0, 2], 'the rest kept, the drawn window');
    const half = run({ destroy: 3, layer: 2, point: pass[0], k0: 1, w: 3 });
    assert.equal(half.layers[2].thickness, 80 + hw, 'half: plus a half wave');
    assert.deepEqual([half.k0, half.k1], [1, 4]);

    const one = run({ destroy: 2, count: 1 }, [1, 3]);
    assert.deepEqual(one, { layers: [L('SiO2', 180), L('TiO2', 60), L('SiO2', 90)], k0: 0, k1: 3 },
        'floor: the first held layer deleted, its neighbours merged, the window the whole design');
    const two = run({ destroy: 2, count: 2 }, [3, 1]);
    assert.deepEqual(two.layers, [L('SiO2', 270)], 'two held layers deleted');

    const copy = run({ destroy: 4, k0: 1, w: 2 });
    assert.deepEqual(copy.layers, [D[0], D[1], D[2], D[1], D[2], D[3], D[4]], 'copy: the window after itself');
    assert.deepEqual([copy.k0, copy.k1], [1, 5], 'the window and its copy');
    assert.equal(JSON.stringify(D), frozen, 'the incumbent is not changed');
    console.log('ok 3  destroy');
}

// ── 4. memo keys ──────────────────────────────────────────────────────────────
{
    const carve = { repair: 0, spacer: 2 }, pair = { repair: 1, spacer: 1.5 }, refine = { repair: 2, spacer: 2 };
    assert.deepEqual(memoKey(carve, 1, 3), { repair: 0, k0: 1, k1: 3, spacer: 0 }, 'carve: the window, no spacer');
    assert.deepEqual(memoKey(pair, 1, 3), { repair: 1, k0: 1, k1: 3, spacer: 1.5 }, 'pair: the window and the spacer');
    assert.deepEqual(memoKey(refine, 1, 3), { repair: 2, k0: 0, k1: 0, spacer: 0 }, 'refine: the design only');
    const dst = [L('SiO2', 100), L('TiO2', 50)];
    const memo = [
        { dst, key: memoKey(pair, 0, 2), out: { layers: dst, mf: 1 } },
        { dst, key: memoKey(refine, 0, 2), out: { layers: dst, mf: 2 } },
    ];
    assert.equal(memoFind(memo, [L('SiO2', 100), L('TiO2', 50)], memoKey(refine, 1, 1)), 1, 'refine found by design');
    assert.equal(memoFind(memo, dst, memoKey({ repair: 1, spacer: 2 }, 0, 2)), -1, 'another spacer is another child');
    assert.equal(memoFind(memo, dst, memoKey(pair, 0, 1)), -1, 'another window is another child');
    const ulp = [L('SiO2', 100 + 1.4210854715202004e-14), L('TiO2', 50)];
    assert.equal(memoFind(memo, ulp, memoKey(pair, 0, 2)), -1, 'designs match bit for bit only');
    assert.ok(sameBits(dst, [L('SiO2', 100), L('TiO2', 50)]));
    console.log('ok 4  memo keys');
}

// ── 5. Acceptance on a synthetic round sequence ───────────────────────────────
{
    // Designs told apart by optical thickness (nRef = 1); rounds = 11, so the
    // falling deviation is 0.1 (1 - r / 10).
    const stubEv = { operands: [], nRef: () => 1, targetMf: 0 };
    const D = (mf, t) => ({ layers: [L('A', t)], mf });
    const kid = (mf, t, destroy = 0, repair = 0) => ({ move: { destroy, repair }, ...D(mf, t) });
    const s = searchState(stubEv, { x: D(1, 100), comb: null, growComb: false }, { rounds: 11 });
    const round = (r, kids) => { s.round = r; return judgeRound(s, kids); };

    assert.deepEqual(round(0, [kid(1.2, 101)]), { best: 0, newBest: false }, 'r0: above the level');
    assert.deepEqual([s.stay, s.rrec, s.accepted, s.inc.mf], [1, 1, 0, 1], 'at the record: stay and rrec count');
    round(1, [kid(1.2, 101)]);
    assert.deepEqual([s.stay, s.accepted], [2, 0], 'r1: level 1.09, nothing accepted');
    round(2, [kid(1.095, 102)]);
    assert.deepEqual([s.accepted, s.restarted, s.inc.mf, s.atRec, s.stay], [1, 1, 1.095, false, 0],
        'r2: stale, so accepted by rrt (level 1.1), above the falling level 1.08');
    round(3, [kid(1.5, 103)]);
    assert.deepEqual([s.returned, s.inc.mf, s.atRec, s.stay, s.gone.map(g => g.mf)], [1, 1, true, 3, [1.095]],
        'r3: nothing accepted away from the record, back to it with its round count');
    const r4 = round(4, [kid(1.095, 102, 1, 1), kid(1.09, 104, 2, 2)]);
    assert.equal(r4.best, 1, 'r4: a design gone back from is no move');
    assert.deepEqual([s.accepted, s.restarted, s.inc.mf], [2, 2, 1.09], 'back at a stale record, accepted by rrt at once');
    assert.deepEqual([s.score.destroy[1], s.score.destroy[2], s.uses.destroy[1]], [0, 13, 1],
        'the gone child is used but scores nothing, the accepted one 13');
    const r5 = round(5, [kid(1.3, 105, 3, 0), kid(0.9, 106, 4, 1), kid(1.08, 107, 0, 2)]);
    assert.deepEqual(r5, { best: 1, newBest: true }, 'r5: below the record and the best');
    assert.deepEqual([s.rec.mf, s.best.mf, s.inc.mf, s.atRec, s.stay, s.rrec, s.since, s.rb],
        [0.9, 0.9, 0.9, true, 0, 0, 0, 5], 'the new record is the incumbent, at the record');
    assert.deepEqual([s.newBests.destroy[4], s.newBests.repair[1]], [1, 1], 'the new best\'s operators counted');
    assert.deepEqual([s.score.destroy[4], s.score.destroy[0], s.score.destroy[3]], [33, 13 + 9, 0],
        'scores: 33 below the record, 9 below the incumbent (1.08 < 1.09), none above the level');
    round(6, [kid(Infinity, 108), kid(0.9, 106 + 1e-7)]);
    assert.deepEqual([s.since, s.accepted], [1, 3], 'r6: an infinite child and the incumbent again are no moves');
    console.log('ok 5  acceptance: stale rule, return to the record, gone list, scores');
}

// ── 6. capabilities ───────────────────────────────────────────────────────────
{
    const agrees = e => {
        const sm = e.surfaceMode;
        const eng = new LSQEngine(e.operands, e.designOf([L('SiO2', 100)]), e.resolveMat, {});
        return eng._fullNewtonSupported(sm, sm === 'back_only') === (deepSynthesisParts(e).refine.model === 'newton');
    };
    const bbar = deepSynthesisParts(ev);
    assert.deepEqual(bbar.refine, { engine: ENGINE, model: 'newton', why: null }, 'bbar: full Newton');
    assert.deepEqual([bbar.halfWave.on, bbar.halfWave.passPoints > 0], [true, true], 'bbar: pass points');
    assert.deepEqual(bbar.comb, { on: false, why: 'passRuns', passRuns: 1 }, 'bbar: one pass run, no comb');
    assert.deepEqual(bbar.pairs, { on: true, why: null });
    assert.deepEqual(statusParts(bbar), ['newton', 'halfWave', 'pairs'], 'the status line\'s parts');

    const band = deepSynthesisParts(fixture('bandpass'));
    assert.deepEqual([band.comb.on, band.comb.passRuns], [true, 3], 'bandpass: the comb');
    assert.deepEqual(statusParts(band), ['newton', 'halfWave', 'comb', 'pairs']);
    const bs = deepSynthesisParts(fixture('bs', { dMin: 0 }));
    assert.deepEqual(bs.halfWave, { on: false, why: 'noPassPoints', passPoints: 0 }, 'bs: R = 0.5 has no pass point');
    assert.deepEqual([bs.comb.why, bs.pairs.why], ['notPassStop', 'noFloor'], 'bs: no comb; no floor, no pairs');
    assert.deepEqual(statusParts(bs), ['newton']);

    const psi = makeOperand({ type: 'PSI', lambdaStart: 550, aoi: 70, target: 30, weight: 1 });
    const fallbacks = [
        ['cone', fixture('bbar', {}, { base: { cone: { enabled: true, halfAngleDeg: 10 } } })],
        ['surface', fixture('bbar', {}, { base: { mfEvalMode: 'total' } })],
        ['surface', fixture('bbar', {}, { base: { surfaceMode: 'symmetric' } })],
        ['surface', fixture('bbar', { otherLayers: [L('SiO2', 90)] }, { base: { surfaceMode: 'both_independent' } })],
        ['operands', fixture('bbar', {}, { ops: [psi] })],
    ];
    for (const [why, e] of fallbacks) {
        assert.deepEqual(deepSynthesisParts(e).refine, { engine: ENGINE, model: 'gaussNewton', why }, `Gauss-Newton: ${why}`);
        assert.ok(agrees(e), `${why}: the rule of LSQEngine._fullNewtonSupported`);
    }
    const back = fixture('bbar', { side: 'back' }, { base: { surfaceMode: 'back_only' } });
    assert.equal(deepSynthesisParts(back).refine.model, 'newton', 'back_only scored on its own side');
    assert.ok([ev, back].every(agrees), 'full Newton where LSQEngine assembles it');
    assert.equal(deepSynthesisParts(fallbacks[4][1]).comb.why, 'notPassStop', 'a PSI row: no comb either');

    const lay = (locked, extra = {}) => ({ surfaceMode: 'front_only', frontLayers: [{ material: 'SiO2', thickness: 50, locked }],
                                           backLayers: [], ...extra });
    const ops = caseById('bbar').ops.map(op => ({ ...op, enabled: true }));
    const blocked = (design, o = {}) => blockedReason(design, { pool, operands: ops, ...o });
    assert.equal(blocked(lay(false)), null, 'nothing blocks');
    assert.equal(blocked(lay(true)), 'locked', 'a locked layer on the active side');
    assert.equal(blocked(lay(true, { surfaceMode: 'symmetric' })), 'locked', 'symmetric works on the front');
    const lockedBack = { surfaceMode: 'front_only', frontLayers: [], backLayers: [{ material: 'SiO2', thickness: 5, locked: true }] };
    assert.equal(blocked(lockedBack), null, 'a lock on the other side does not');
    assert.equal(blocked({ ...lockedBack, surfaceMode: 'back_only' }), 'locked', 'back_only works on the back');
    assert.equal(blocked(lay(false), { pool: [] }), 'noPool');
    const rows = types => types.map(type => makeOperand({ type, lambdaStart: 550, target: 1, weight: 1 }));
    assert.equal(blocked(lay(false), { operands: rows(['TT']) }), 'noOperands', 'a thickness row is not optical');
    assert.equal(blocked(lay(false), { operands: ops.map(op => ({ ...op, weight: 0 })) }), 'noOperands', 'weight 0');
    assert.equal(blocked(lay(false), { operands: ops.map(op => ({ ...op, enabled: false })) }), 'noOperands', 'disabled');
    console.log('ok 6  capabilities and blockedReason');
}

// ── 7. Repairs ────────────────────────────────────────────────────────────────
{
    const e6 = fixture('bbar', { maxLayers: 6 });
    const dst = [L('TiO2', 30), L('SiO2', 100)];
    const item = over => ({ kind: 'refine', dst, k0: 0, k1: 2, spacer: 1, pre: null, fit: true, ...over });
    const refined = e6.refine(dst);

    const r = M.runChild(e6, item());
    assert.deepEqual(r, { layers: refined.layers, mf: refined.mf, ref: { layers: refined.layers, mf: refined.mf } },
        'refine: the destroyed design refined, which is also its ref');
    const pre = { layers: refined.layers, mf: refined.mf };
    const carved = M.runChild(e6, item({ kind: 'carve', pre }));
    assert.equal(carved.ref, null, 'a child that starts from pre does not refine its design');
    assert.ok(carved.mf < pre.mf && carved.layers.length <= 6, 'carve gains within the cap');
    assert.ok(carved.layers.every(l => l.thickness >= 20 - 1e-9), 'at or above the floor');
    const paired = M.runChild(e6, item({ kind: 'pair', pre }));
    assert.ok(paired.layers.length <= 6 && paired.layers.length > 2, 'a pair within the cap');

    const full = [L('TiO2', 30), L('SiO2', 100), L('TiO2', 30), L('SiO2', 100)];
    const none = M.runChild(e6, item({ kind: 'pair', dst: full, k1: 4 }));
    assert.deepEqual(none, { layers: full, mf: Infinity, ref: null }, 'a pair with no room is no move, unrefined');
    const cap = M.pair(fixture('bbar', { maxLayers: 4 }), refined.layers, { k0: 0, k1: 2, spacer: 2, fit: false });
    assert.equal(cap.mf, Infinity, 'without fit, a pair over the cap is no move');
    assert.ok(M.carve(e6, refined.layers, refined.mf, { k0: 0, k1: 2, fit: true }).layers.length <= 6, 'carve with fit');
    console.log('ok 7  repairs and runChild');
}

// ── 8. runSearch and runStart on real optics ──────────────────────────────────
const searchRun = over => ({ runner: makeSerialRunner(), log: { trace: makeTrace(), keep: null },
                             shouldStop: () => false, onEvent: noop, rng: makeRng(7), best: null, ...over });
{
    const e6 = fixture('bbar', { maxLayers: 6 });
    const start = e6.refine([L('TiO2', 30), L('SiO2', 100)]);
    const x = { layers: start.layers, mf: start.mf };
    const events = [];
    const run = searchRun({ onEvent: e => events.push(e) });
    const res = await runSearch(e6, { x, comb: null, growComb: false }, { rounds: 3, children: 4 }, run);
    assert.ok(res.best.mf < 0.5 * x.mf, `the search lowers the merit (${x.mf.toExponential(3)} -> ${res.best.mf.toExponential(3)})`);
    assert.ok(res.best.layers.length <= 6, 'within the cap');
    assert.ok(res.best.layers.every(l => l.thickness >= 20 - 1e-9), 'at or above the floor');
    assert.ok(run.log.trace.points.every(p => p.n <= 6 && Number.isFinite(p.mf)), 'every child on the trace within the cap');
    assert.deepEqual(run.best, res.best, 'run.best follows the best');
    assert.equal(events.filter(e => e.type === 'round').length, 3, 'one round event per round');
    const bests = events.filter(e => e.type === 'best');
    assert.ok(bests.length > 0 && bests.every(b => M.DESTROYS.includes(b.destroy) && M.REPAIRS.includes(b.repair)),
        'new bests name their moves');
    assert.equal(res.stats.rounds, 3);

    // A regrid at the second round, to an evaluator on the same grid: the
    // search goes on with it, the memo emptied, and ends where it did.
    const grids = [];
    const other = fixture('bbar', { maxLayers: 6 });
    const regrid = layers => { grids.push(layers.length); return grids.length === 2 ? other : null; };
    const rg = await runSearch(e6, { x, comb: null, growComb: false }, { rounds: 3, children: 4 }, searchRun({ regrid }));
    assert.equal(grids.length, 3, 'regrid asked at the top of every round');
    assert.equal(rg.ev, other, 'the search ends on the new evaluator');
    assert.ok(sameBits(rg.best.layers, res.best.layers) && rg.best.mf === res.best.mf, 'the same search');

    let rounds = 0;
    const stopped = searchRun({ onEvent: e => { if (e.type === 'round') rounds++; }, shouldStop: () => rounds >= 1 });
    const s = await runSearch(e6, { x, comb: null, growComb: false }, { rounds: 3, children: 4 }, stopped);
    assert.deepEqual([s.stats.rounds, rounds], [1, 1], 'Stop ends the search at the next round');

    const stall = await runSearch(e6, { x, comb: null, growComb: false }, { rounds: 5, children: 1, stall: 1 },
        searchRun({ rng: makeRng(3) }));
    assert.deepEqual([stall.stats.stalled, stall.stats.since, stall.stats.rounds < 5], [true, 1, true],
        'stall 1: the search stops after its first round without a new best');

    // A start above the cap is trimmed one deletion at a time.
    const e3 = fixture('bbar', { maxLayers: 3, refine: { maxIter: 20, plateau: 6, plateauGain: 1e-4 } });
    const phases = [];
    const tr = searchRun({ onEvent: e => phases.push(e.phase) });
    const five = [L('SiO2', 100), L('TiO2', 30), L('SiO2', 40), L('TiO2', 60), L('SiO2', 90)];
    const st = await runStart(e3, five, { comb: true, ge: {} }, tr);
    assert.deepEqual(phases, ['refine', 'trim'], 'bbar has no comb: refine, then trim');
    assert.equal(st.x.layers.length <= 3 && st.trimmedFrom === 5, true, 'trimmed from 5 layers to the cap');
    assert.deepEqual(tr.best, st.x, 'run.best holds the start');
    assert.deepEqual(tr.log.trace.points.map(p => p.n), [5, 5, 4, 3], 'the start, its refinement and each deletion');
    console.log('ok 8  runSearch and runStart');
}

// ── 9. The worker path ────────────────────────────────────────────────────────
// What a synthesis worker does with a job: rebuild resolveMat from the job's
// tables and dispatch it; messages cross the boundary as structured clones.
function dispatchOne(job) {
    const msg = structuredClone(job);
    let out = null;
    dispatchSynthesisJob(msg, makeResolveMat(msg.materials, 'fakePool', noop), m => { out = m; });
    return structuredClone(out);
}
{
    const e4 = fixture('bbar', { maxLayers: 4, refine: { maxIter: 20, plateau: 6, plateauGain: 1e-4 } });
    const sent = [];
    const direct = { size: 2, map: async jobs => { sent.push(...jobs); return jobs.map(dispatchOne); } };
    const two = [L('TiO2', 30), L('SiO2', 100)];
    const items = [{ layers: two, prep: null, part: newPart() }, { layers: two, prep: { kind: 'delete', k: 0 }, part: newPart() }];
    const pooled = await makePoolRunner(direct).rung(e4, items, 7);
    assert.deepEqual(pooled, await makeSerialRunner().rung(e4, items, 7), 'rung jobs: the pool and the serial runner agree');
    assert.deepEqual(Object.keys(sent[0]).sort(), ['items', 'materials', 'spec', 'type', 'upto'], 'the rung job message');
    assert.deepEqual([sent.length, sent[0].type, sent[0].items.length, sent[0].upto], [2, 'deepSynthesisRaceRung', 1, 7]);
    assert.ok(sent[0].spec === e4.spec && sent[0].materials === e4.materials, 'the run\'s spec and tables');
    assert.ok(pooled.every(it => it.part.iters > 0 && it.part.iters <= 7), 'refined within the rung\'s budget');

    const kids = [{ kind: 'refine', dst: two, k0: 0, k1: 0, spacer: 1, pre: null, fit: true }, { kind: 'grow', layers: two }];
    const msg = dispatchOne({ type: 'deepSynthesisChild', materials: e4.materials, spec: e4.spec, items: kids });
    assert.deepEqual([msg.type, msg.kind, msg.items.length], ['result', 'deepSynthesisChild', 2], 'the result message');
    assert.deepEqual(msg.items, runDeepSynthesisJob({ type: 'deepSynthesisChild', materials: e4.materials, spec: e4.spec, items: kids },
        makeResolveMat(e4.materials, 'direct', noop)).items, 'a child job in a worker is the job run here');
    assert.ok(Array.isArray(msg.items[1].points) && msg.items[1].layers.length <= 4, 'a grown seed within the cap');
    assert.deepEqual(await makePoolRunner(direct).child(e4, kids), await makeSerialRunner().child(e4, kids),
        'child jobs: the pool and the serial runner agree');
    console.log('ok 9  worker path through dispatchSynthesisJob');
}

// ── 10. One against N workers ─────────────────────────────────────────────────
// A pool of 3 that runs each batch's jobs last to first and settles them in
// reverse order on staggered timers.
function reversePool(stats) {
    return {
        size: 3,
        map(jobs) {
            stats.jobs += jobs.length;
            const out = new Array(jobs.length);
            for (let i = jobs.length - 1; i >= 0; i--) out[i] = dispatchOne(jobs[i]);
            return Promise.all(out.map((m, i) => new Promise((resolve, reject) => setTimeout(() => {
                stats.settled.push(i);
                if (m.type === 'error') reject(new Error(m.message));
                else resolve(m);
            }, jobs.length - i))));
        },
    };
}

// A short search, and gradual evolution stopped at the first step that does
// not improve the kept design: the runs compared need not be long, only the same.
const OPTS = {
    ...DEEP_SYNTHESIS_DEFAULTS,
    ge: { ...DEEP_SYNTHESIS_DEFAULTS.ge, keepPatience: 1 },
    search: { ...DEEP_SYNTHESIS_DEFAULTS.search, rounds: 3, children: 4 },
};
const TWO = [L('TiO2', 30), L('SiO2', 100)];
async function deepRun(runner, start = [], maxLayers = 8) {
    const e = fixture('bbar', { maxLayers, refine: { maxIter: 20, plateau: 6, plateauGain: 1e-4 } });
    const events = [];
    const run = searchRun({ runner, onEvent: e2 => events.push(JSON.stringify(e2)) });
    const res = await runDeepSynthesis(e, start, OPTS, run);
    return { res, events };
}

// The run ended on a design within the cap at or below every design of 1 to
// cap layers on its trace, the designs the run recorded.
function assertKeptBest(res, cap, label) {
    const low = Math.min(...res.trace.points.filter(p => p.n >= 1 && p.n <= cap).map(p => p.mf));
    assert.ok(Number.isFinite(low), `${label}: a design within the cap was recorded`);
    assert.ok(res.layers && res.layers.length <= cap && res.mf <= low * (1 + 1e-9),
        `${label}: the run ends at or below it (${res.mf} against ${low})`);
}

// A serial runner that fails its jobs (RunnerFailure 'stopped') once `jobs`
// have run, and counts how often it read Stop.
function stoppingRunner(jobs) {
    const count = { seen: 0 };
    return { count, runner: makeSerialRunner({ shouldStop: () => ++count.seen > jobs }) };
}

// Two runs that made the same decisions: layers bit for bit, merit, trace,
// start, search statistics and every event.
function assertSameRun(a, b, label) {
    assert.ok(sameBits(a.res.layers, b.res.layers), `${label}: the same layers, bit for bit`);
    assert.equal(a.res.mf, b.res.mf, `${label}: the same merit`);
    assert.deepEqual(a.res.trace, b.res.trace, `${label}: the same trace`);
    assert.deepEqual([a.res.start, a.res.search], [b.res.start, b.res.search], `${label}: the same start and search`);
    assert.deepEqual(a.events, b.events, `${label}: the same events`);
}

{
    const stats = { jobs: 0, settled: [] };
    const serial = await deepRun(makeSerialRunner());
    assertSameRun(await deepRun(makePoolRunner(reversePool(stats))), serial, 'from no design');
    assert.ok(stats.jobs > 0 && stats.settled.some((i, k) => k > 0 && i < stats.settled[k - 1]), 'the pool ran, out of order');
    const { res } = serial;
    assert.equal(res.stopped, false);
    assert.ok(res.layers.length <= 8 && Number.isFinite(res.mf), 'a design within the cap');
    assert.deepEqual([res.start.kind, res.parts.comb.why], ['ge', 'passRuns'], 'from no design, gradual evolution');
    assert.ok(res.mf <= res.start.mf, 'the search keeps the best');

    const refined = await deepRun(makeSerialRunner(), TWO, 6);
    assertSameRun(await deepRun(makePoolRunner(reversePool(stats)), TWO, 6), refined, 'from two layers');
    const moved = refined.res.search;
    assert.ok(moved.accepted > 0 && Object.values(moved.newBests).some(n => n > 0), 'a search that moves');

    // A job rejected (the pool terminated by Stop): the run ends on the best
    // design so far, the start here.
    const failing = { size: 3, map: jobs => (jobs[0].type === 'deepSynthesisChild'
        ? Promise.reject(new Error('pool terminated')) : Promise.resolve(jobs.map(dispatchOne))) };
    const f = (await deepRun(makePoolRunner(failing), TWO)).res;
    assert.deepEqual([f.stopped, f.error, f.search, f.start.kind], [true, 'pool terminated', null, 'refined']);
    assert.deepEqual([f.mf, f.layers.length], [f.start.mf, f.start.n], 'the best so far is the refined start');
    const early = { size: 1, map: () => Promise.reject(new Error('worker error')) };
    const g = (await deepRun(makePoolRunner(early), [L('TiO2', 30)])).res;
    assert.deepEqual([g.stopped, g.layers, g.mf, g.start], [true, null, Infinity, null], 'no design before the first result');

    // Stop in the middle of a gradual evolution step (jobs 3, 9 and 12 end
    // inside one here): no job runs after it, and the designs the step's
    // needle cycle kept are not lost.
    for (const jobs of [3, 9, 12]) {
        const { count, runner } = stoppingRunner(jobs);
        const s = (await deepRun(runner)).res;
        assert.deepEqual([s.stopped, s.error, count.seen], [true, 'stopped', jobs + 1], `Stop after job ${jobs}`);
        assertKeptBest(s, 8, `Stop after job ${jobs}`);
    }

    // The comb's growth batch rejected: the refined seeds it kept are not
    // lost. Its refinements give each seed a made-up merit.
    const seedsOnly = {
        threads: 1,
        rung: async (e, items) => items.map((it, k) => ({ ...it, part: { ...it.part, iters: 1, done: true, mf: 0.5 + k / 1000 } })),
        child: async () => { throw new RunnerFailure(new Error('pool terminated')); },
    };
    const c = await runDeepSynthesis(fixture('bandpass', { maxLayers: 9 }), [], OPTS, searchRun({ runner: seedsOnly }));
    assert.deepEqual([c.stopped, c.error, c.start], [true, 'pool terminated', null], 'the comb\'s growth rejected');
    assertKeptBest(c, 9, 'the comb\'s growth rejected');

    // opts.race reaches the races: gradual evolution's first race starts at
    // `first` iterations, capped at maxIter 20.
    for (const [first, upto] of [[RACE.first, 20], [5, 5]]) {
        const uptos = [];
        const runner = makeSerialRunner();
        const recording = { ...runner, rung: (e, items, u) => { uptos.push(u); return runner.rung(e, items, u); } };
        const e = fixture('bbar', { refine: { maxIter: 20, plateau: 6, plateauGain: 1e-4 } });
        const stopped = searchRun({ runner: recording, shouldStop: () => uptos.length > 0 });
        await runDeepSynthesis(e, [], { ...OPTS, race: { ...RACE, first } }, stopped);
        assert.equal(uptos[0], upto, `race.first ${first}: the first rung's budget`);
    }
    console.log(`ok 10 1 against N workers (${stats.jobs} jobs; from no design MF ${res.mf.toExponential(4)} `
        + `at ${res.layers.length} layers, from two layers ${refined.res.mf.toExponential(4)})`);

    // ── 11. Real synthesis workers (node:worker_threads), 1 and 3 threads ──
    // The workers get the WASM kernel's bytes, so they run this thread's kernel.
    initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);
    globalThis.Worker = NodeModuleWorker;
    for (const threads of [1, 3]) {
        const bytes = getTmmWasmBytesForWorker();
        const workers = new WorkerPool(SYNTHESIS_WORKER_URL, threads, bytes ? { type: 'wasmInit', wasmBytes: bytes } : null);
        try {
            assertSameRun(await deepRun(makePoolRunner(workers), TWO, 6), refined, `${threads} workers`);
        } finally {
            workers.terminate();
        }
    }
    console.log('ok 11 real synthesis workers at 1 and 3 threads');
}

console.log(`All Deep Synthesis search tests passed (engine ${ENGINE}).`);
