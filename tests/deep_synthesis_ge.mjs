/**
 * Deep Synthesis gradual evolution (steps.js, prep.js, deepNeedle.js and
 * gradualEvolution.js, a port of ge.c and the deep branch of needle.c).
 *
 *   1. forcedSteps with two materials (thicken plus the outer layers), with
 *      three (every gap) and from the empty design; placeStep, stepStart.
 *   2. nextMinimum on a synthetic merit (the walk, the golden section, the
 *      lowest point when the merit still falls one wave out, none for a merit
 *      that never falls below the start) and on a one-layer BBAR design,
 *      where the thickness found is below its neighbours at +-1 nm.
 *   3. prepare for each kind, with the void cases, and the pair's spacer on a
 *      back_only run of three materials; runRungItem prepares on the first
 *      rung only.
 *   4. forcedCandidates on BBAR: every step listed once, the lowest refined
 *      merit first, the ones out last; steps refined back to the start are out.
 *   5. jointStep: pairs per spacer at the first pairM candidates of each
 *      material, then the held layers deleted; a pair gains on a converged
 *      three-layer BBAR. deepNeedleCycle gains on BBAR from two layers, and
 *      stops at the cap and on Stop.
 *   6. runGradualEvolution's stops on a rule runner (designs made to order,
 *      real merits): cycle, stalled, kept, undone, noStep; one geStep event
 *      per step.
 *   7. runGradualEvolution on real optics: from nothing on BBAR at a 20 nm
 *      floor and a cap of 6, better than the best single layer by far; from one
 *      layer on the shortpass edge filter at a 40 nm floor and a cap of 8, the
 *      merit many times lower, the same twice. The kept design stays within
 *      the cap.
 *   8. Stop before the first step and in the middle of a run; a regrid swaps
 *      the evaluator and the keeper.
 *   9. A merit still falling one wave out (BBAR with an 800 nm total
 *      thickness target): the step is the last point sampled, and the run
 *      grows a design from nothing.
 *
 * Run: node tests/deep_synthesis_ge.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { presampleSynthesisMaterials } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');
const { makeEngine } = await import('../src/utils/optimizers/index.js');
const { DLSOptimizer } = await import('../src/utils/physics/optimizer.js');
const { makeOperand } = await import('../src/utils/physics/optimizer/operandModel.js');
const { makeEvaluator, newPart } = await import('../src/utils/synthesis/deepSynthesis/evaluator.js');
const { makeTrace, makeKeeper } = await import('../src/utils/synthesis/deepSynthesis/trace.js');
const Dz = await import('../src/utils/synthesis/deepSynthesis/design.js');
const N = await import('../src/utils/synthesis/deepSynthesis/needleHelpers.js');
const S = await import('../src/utils/synthesis/deepSynthesis/steps.js');
const { prepare, runRungItem } = await import('../src/utils/synthesis/deepSynthesis/prep.js');
const { deepNeedleCycle, jointStep, DEEP } = await import('../src/utils/synthesis/deepSynthesis/deepNeedle.js');
const { forcedCandidates, runGradualEvolution, GE } = await import('../src/utils/synthesis/deepSynthesis/gradualEvolution.js');

// Step 1's engine is required: no fallback to another engine here.
const probe = makeEngine('trust-region', caseById('bbar').ops, caseById('bbar').thin(), getMaterial, {});
assert.notEqual(probe.constructor, DLSOptimizer, "makeEngine('trust-region') is registered");
const ENGINE = 'trust-region';

const base = { surfaceMode: 'front_only', mfEvalMode: 'side', incidentMedium: 'Air', exitMedium: 'Air',
               substrate: { material: 'BK7', thickness: 1 } };
const pool = ['TiO2', 'SiO2'];
// over: spec fields over the defaults; over.operands, over.base and over.pool
// are also what the materials are presampled for.
function fixture(caseId, over = {}) {
    const operands = over.operands ?? caseById(caseId).ops.map(op => ({ ...op, enabled: true }));
    const media = over.base ?? base, mats = over.pool ?? pool;
    const design = { ...media, frontLayers: [], backLayers: [] };
    const materials = presampleSynthesisMaterials(design, operands, mats.map(id => ({ id, mat: getMaterial(id) })));
    const spec = { operands, base, side: 'front', otherLayers: [], pool, dMin: 20, dMax: Infinity, maxLayers: 8,
                   engine: ENGINE, refine: { maxIter: 60, plateau: 6, plateauGain: 1e-4 }, targetMf: 1e-4, ...over };
    return makeEvaluator(spec, { materials });
}

// A serial runner (rung jobs only): a fresh evaluator per job, as a worker
// builds one, counting its jobs.
function serialRunner(counter = { jobs: 0 }) {
    return {
        threads: 1,
        counter,
        rung: async (ev, items, upto) => items.map(it => {
            counter.jobs++;
            return runRungItem(makeEvaluator(ev.spec, { materials: ev.materials }), it, upto);
        }),
    };
}

// A runner whose refinement is a rule on designs, with the real merit of the
// result: a forced step's item becomes rules.step(layers), an item without a
// prep rules.plain(layers), every other prep is void. `preps` collects what it
// was given.
function ruleRunner(rules, preps = []) {
    const done = (ev, it, layers) => ({ ...it, layers, prep: null,
        part: { iters: 1, state: null, done: true, mf: ev.mf(layers), void: false } });
    const one = (ev, it) => {
        preps.push(it.prep);
        if (!it.prep) return done(ev, it, rules.plain(it.layers));
        if (it.prep.kind === 'step') return done(ev, it, rules.step(it.layers));
        return { ...it, prep: null, part: { ...it.part, void: true, done: true, mf: Infinity } };
    };
    return { threads: 1, rung: async (ev, items) => items.map(it => one(ev, it)) };
}

const newLog = cap => ({ trace: makeTrace(), keep: cap === null ? null : makeKeeper(cap) });
const runOf = (runner, over = {}) => ({ runner, log: newLog(8), shouldStop: () => false, onEvent: () => {}, ...over });
const L = (material, thickness) => ({ material, thickness });
const minThickness = layers => Math.min(...layers.map(l => l.thickness));
// A refinement's merit comes from its own engine; ev.mf rescores the layers.
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.abs(b);
const GE_REASONS = ['target', 'maxLayers', 'noStep', 'undone', 'stalled', 'enough', 'cycle', 'kept', 'stopped'];
const NEEDLE_REASONS = ['maxLayers', 'enough', 'optimal', 'noGain', 'stopped'];

const ev = fixture('bbar');

// ── 1. forcedSteps, placeStep, stepStart ──────────────────────────────────────
{
    const three = [L('SiO2', 100), L('TiO2', 50), L('SiO2', 80)];
    const thicken = [0, 1, 2].map(k => ({ k, pos: -1, material: null }));
    const at = (pos, material) => ({ k: -1, pos, material });
    assert.deepEqual(S.forcedSteps(three, pool, { outer: true }),
        [...thicken, at(0, 'TiO2'), at(3, 'TiO2')], 'two materials: every layer thickened, new outer layers');
    assert.deepEqual(S.forcedSteps(three, pool, { outer: false }), thicken, 'without outer only the thickenings');
    assert.deepEqual(S.forcedSteps(three, ['TiO2', 'SiO2', 'Al2O3'], { outer: false }),
        [...thicken, at(0, 'TiO2'), at(0, 'Al2O3'), at(1, 'Al2O3'), at(2, 'Al2O3'), at(3, 'TiO2'), at(3, 'Al2O3')],
        'three materials: every gap, of a material other than both neighbours, in pool order');
    assert.deepEqual(S.forcedSteps([], pool, { outer: false }), [at(0, 'TiO2'), at(0, 'SiO2')],
        'from no design: a layer of every material');

    assert.deepEqual(S.placeStep(three, { k: 1, pos: -1, material: null }, 75),
        [L('SiO2', 100), L('TiO2', 75), L('SiO2', 80)], 'a thickened layer');
    assert.deepEqual(S.placeStep(three, at(3, 'TiO2'), 20), [...three, L('TiO2', 20)], 'a new layer at the gap');
    assert.deepEqual(three, [L('SiO2', 100), L('TiO2', 50), L('SiO2', 80)], 'the input is not changed');
    assert.equal(S.stepStart(ev, three, { k: 2, pos: -1, material: null }), 80, 'a thickening starts at the layer');
    assert.equal(S.stepStart(ev, three, at(0, 'TiO2')), 20, 'a new layer at the floor');
    console.log('ok 1  forcedSteps, placeStep, stepStart');
}

// ── 2. nextMinimum ────────────────────────────────────────────────────────────
{
    // Synthetic: lamMin 400 at n 2 gives steps of 6.25 nm; one wave at lamMax
    // 700 is 350 nm; the merit is a function of the one layer's thickness.
    const synth = f => ({ lamMin: 400, lamMax: 700, floor: 20, n: () => 2, mf: layers => f(layers[0].thickness) });
    const step = { k: 0, pos: -1, material: null };
    const one = [L('TiO2', 20)];
    const m = S.nextMinimum(synth(t => (t - 100) ** 2), one, step, 20);
    assert.ok(Math.abs(m.thickness - 100) < 0.1, `golden section to 1e-3 relative (${m.thickness})`);
    assert.ok(m.mf <= (101.25 - 100) ** 2, 'no worse than the step before the rise (101.25 nm)');
    // Still falling at 370 nm, one wave (350 nm) past the start: the lowest
    // point sampled, where ge.c gives no step.
    const far = S.nextMinimum(synth(t => (t - 1000) ** 2), one, step, 20);
    const lastStep = 20 + 6.25 * Math.floor(350 / 6.25);
    assert.deepEqual(far, { thickness: lastStep, mf: (lastStep - 1000) ** 2 }, 'no rise within one wave: the last step');
    assert.equal(S.nextMinimum(synth(t => t), one, step, 20), null, 'a merit that never falls: none');
    assert.equal(S.nextMinimum(synth(t => (t < 40 ? t : 40 - (t - 40) / 100)), one, step, 20), null,
        'a fall that stays above the start: none');
    const plateau = S.nextMinimum(synth(t => (t < 60 ? 100 - t : 40)), one, step, 20);
    assert.deepEqual(plateau, { thickness: 63.75, mf: 40 }, 'a flat bottom: its first step, golden points no lower');

    // Real optics: a SiO2 layer on BBAR thickened, and a new TiO2 layer at gap 0.
    const d = [L('SiO2', 60)];
    for (const st of [step, { k: -1, pos: 0, material: 'TiO2' }]) {
        const t0 = S.stepStart(ev, d, st);
        const r = S.nextMinimum(ev, d, st, t0);
        assert.ok(r && r.thickness > t0, 'a next minimum past the start');
        assert.ok(r.thickness <= t0 + ev.lamMax / ev.n(st.material ?? 'SiO2', ev.lamMax), 'within one wave');
        const f = t => ev.mf(S.placeStep(d, st, t));
        assert.equal(f(r.thickness), r.mf, 'the merit it reports is the merit there');
        assert.ok(r.mf < f(r.thickness - 1) && r.mf < f(r.thickness + 1), 'below its neighbours at +-1 nm');
    }
    console.log('ok 2  nextMinimum');
}

// ── 3. prepare and runRungItem ────────────────────────────────────────────────
{
    const two = ev.refine([L('TiO2', 30), L('SiO2', 50)]);
    const step = { k: -1, pos: 2, material: 'TiO2' };
    const min = S.nextMinimum(ev, two.layers, step, ev.floor);
    assert.deepEqual(prepare(ev, two.layers, { kind: 'step', step }), S.placeStep(two.layers, step, min.thickness),
        'step: placed at its next minimum');
    const flat = { ...ev, mf: () => 1 };
    assert.equal(prepare(flat, two.layers, { kind: 'step', step }), null, 'step: void when the merit never turns up');

    const cand = { pos: 0, layer: -1, frac: 0, material: 'SiO2', P: -1 };
    assert.deepEqual(prepare(ev, two.layers, { kind: 'needle', cand, mf0: two.mf }),
        N.insertOptimal(ev, two.layers, cand, two.mf), 'needle: insertOptimal');
    const ev0 = fixture('bbar', { dMin: 0 });
    assert.equal(prepare(ev0, two.layers, { kind: 'needle', cand, mf0: 0 }), null,
        'needle: void without a floor when no thickness beats mf0');

    const split = { pos: -1, layer: 1, frac: 0.5, material: 'TiO2', P: -1 };
    assert.deepEqual(prepare(ev, two.layers, { kind: 'pair', cand: split, spacerNm: 30 }),
        N.applyPair(two.layers, split, 30, { floorNm: 20 }), 'pair: floor, spacer, floor');
    // A back_only run on three materials: its Layers are in backLayers order,
    // index 0 at the substrate, so at an inner gap the spacer is the layer below.
    const pool3 = ['TiO2', 'Al2O3', 'SiO2'];
    const evBack = fixture('bbar', { base: { ...base, surfaceMode: 'back_only' }, side: 'back', pool: pool3 });
    const three = [L('TiO2', 30), L('Al2O3', 40), L('SiO2', 50)];
    const gap = { pos: 2, layer: -1, frac: 0, material: 'TiO2', P: -1 };
    assert.deepEqual(prepare(evBack, three, { kind: 'pair', cand: gap, spacerNm: 30 }),
        [L('TiO2', 30), L('Al2O3', 40), L('TiO2', 20), L('Al2O3', 30), L('TiO2', 20), L('SiO2', 50)],
        'pair on the back side: the spacer is the substrate-side neighbour');
    const evFront3 = fixture('bbar', { pool: pool3 });
    assert.deepEqual(prepare(evFront3, three, { kind: 'pair', cand: gap, spacerNm: 30 }).map(l => l.material),
        ['TiO2', 'Al2O3', 'TiO2', 'SiO2', 'TiO2', 'SiO2'], 'on the front side the other neighbour');
    const five = [L('TiO2', 30), L('SiO2', 50), L('TiO2', 30), L('SiO2', 50), L('TiO2', 30)];
    const evCap6 = fixture('bbar', { maxLayers: 6 });
    assert.equal(prepare(evCap6, five, { kind: 'pair', cand, spacerNm: 20 }), null, 'pair: void past the cap');
    assert.equal(prepare(ev, [], { kind: 'pair', cand, spacerNm: 20 }), null, 'pair: void on the empty design');
    const eight = [...five, L('SiO2', 50), L('TiO2', 30), L('SiO2', 50)];
    assert.deepEqual(prepare(evCap6, eight, { kind: 'delete', k: 1 }), Dz.withoutLayer(eight, 1),
        'delete: withoutLayer, above the cap too');

    const item = { layers: two.layers, prep: { kind: 'step', step }, part: newPart() };
    const r1 = runRungItem(ev, item, 2);
    assert.equal(r1.prep, null, 'the prep is spent');
    assert.ok(r1.part.iters > 0 || r1.part.done, 'and the item refined');
    assert.ok(minThickness(r1.layers) >= ev.floor * (1 - 1e-9), 'at or above the floor');
    const r2 = runRungItem(ev, r1, 60);
    assert.deepEqual(r2, ev.refinePart(r1, 60), 'later rungs only refine');
    const bad = runRungItem(flat, { layers: two.layers, prep: { kind: 'step', step }, part: newPart() }, 27);
    assert.deepEqual(bad.part, { iters: 0, state: null, done: true, mf: Infinity, void: true }, 'a void item');
    const plain = { layers: two.layers, prep: null, part: newPart() };
    assert.deepEqual(runRungItem(ev, plain, 27), ev.refinePart(plain, 27), 'an item without a prep is refined');
    console.log('ok 3  prepare and runRungItem');
}

// ── 4. forcedCandidates ───────────────────────────────────────────────────────
{
    const two = ev.refine([L('TiO2', 30), L('SiO2', 50)]);
    const run = runOf(serialRunner());
    const cands = await forcedCandidates(ev, two.layers, run);
    const steps = S.forcedSteps(two.layers, pool, { outer: GE.outer });
    assert.deepEqual(cands.map(c => c.idx).sort((a, b) => a - b), steps.map((_, i) => i), 'every step once');
    cands.forEach(c => assert.deepEqual(c.step, steps[c.idx], 'idx names the step'));
    const finite = cands.filter(c => Number.isFinite(c.mf));
    assert.ok(finite.length >= 1, 'at least one step stands');
    assert.deepEqual(cands.slice(0, finite.length), finite, 'the ones standing first');
    for (let i = 1; i < finite.length; i++) {
        const [a, b] = [finite[i - 1], finite[i]];
        assert.ok(a.mf < b.mf || (a.mf === b.mf && a.idx < b.idx), 'by refined merit, ties in listed order');
    }
    for (const c of finite) {
        assert.ok(near(c.mf, ev.mf(c.layers)), 'the merit of the refined step');
        assert.ok(minThickness(c.layers) >= ev.floor * (1 - 1e-9), 'at or above the floor');
        assert.ok(!Dz.sameDesign(ev.nRef, c, { layers: two.layers, mf: ev.mf(two.layers) }), 'not the start');
    }
    const empty = await forcedCandidates(ev, [], run);
    assert.deepEqual(empty.map(c => c.step.material).sort(), ['SiO2', 'TiO2'], 'from no design: one per material');

    const back = await forcedCandidates(ev, two.layers, runOf(ruleRunner({ step: d => d, plain: d => d })));
    assert.ok(back.length === steps.length && back.every(c => c.mf === Infinity), 'refined back to the start: out');
    console.log(`ok 4  forcedCandidates (${finite.length} of ${cands.length} standing)`);
}

// ── 5. jointStep and deepNeedleCycle ──────────────────────────────────────────
{
    const c = (material, i) => ({ pos: i % 3, layer: -1, frac: 0, material, P: -10 + i });
    const cands = [...Array.from({ length: 10 }, (_, i) => c('TiO2', i)), c('SiO2', 10), c('SiO2', 11)];
    const held = [L('TiO2', 20), L('SiO2', 90), L('TiO2', 20 * (1 + 1e-10)), L('SiO2', 20.001)];
    const preps = [];
    const run = runOf(ruleRunner({ step: d => d, plain: d => d }, preps));
    assert.equal(await jointStep(ev, { layers: held, mf: ev.mf(held) }, cands, run), null, 'no move gains');
    const paired = cands.filter(x => x.material === 'SiO2' || cands.indexOf(x) < DEEP.pairM);
    const expected = paired.flatMap(cand => N.SPACERS.map(s => ({ kind: 'pair', cand, spacerNm: s * 20 })))
        .concat([{ kind: 'delete', k: 0 }, { kind: 'delete', k: 2 }]);
    assert.deepEqual(preps, expected, 'pairs at the first pairM per material, three spacers each, then the held layers');
    preps.length = 0;
    assert.equal(await jointStep(ev, { layers: [], mf: ev.mf([]) }, cands, run), null, 'nothing on the empty design');
    assert.equal(preps.length, 0, 'and no job');

    // A converged three-layer BBAR at a 20 nm floor: a pair gains (needle.c 58-72).
    const start = ev.refine([L('SiO2', 120), L('TiO2', 60), L('SiO2', 150)]);
    const minima = N.scanWindow(ev, start.layers, { minima: true });
    const joint = await jointStep(ev, start, minima, runOf(serialRunner()));
    assert.ok(joint && joint.mf < start.mf * (1 - N.GAIN_TOL), 'a joint move gains on a converged design');
    assert.ok(joint.layers.length <= ev.maxLayers && minThickness(joint.layers) >= 20 * (1 - 1e-9));

    // The deep cycle from two layers.
    const log = newLog(ev.maxLayers);
    const r = await deepNeedleCycle(ev, [L('TiO2', 30), L('SiO2', 50)], { pairs: true }, runOf(serialRunner(), { log }));
    const first = ev.refine([L('TiO2', 30), L('SiO2', 50)]);
    assert.ok(NEEDLE_REASONS.includes(r.reason), r.reason);
    assert.ok(r.insertions >= 1 && r.mf < first.mf * 0.5, `the cycle gains (${first.mf} -> ${r.mf})`);
    assert.equal(r.ev, ev);
    assert.ok(near(r.mf, ev.mf(r.layers)));
    assert.equal(log.trace.points.length, r.insertions + 1, 'one trace point per design held');
    log.trace.points.forEach((p, i) => i > 0 && assert.ok(p.mf < log.trace.points[i - 1].mf, 'each move gains'));
    assert.ok(r.layers.length <= ev.maxLayers + 1, 'at most a split past the cap (needle.c 466)');
    assert.ok(log.keep.layers.length <= ev.maxLayers, 'the kept design within the cap');

    const full = await deepNeedleCycle(fixture('bbar', { maxLayers: 2 }), [L('TiO2', 30), L('SiO2', 50)],
        { pairs: true }, runOf(serialRunner()));
    assert.equal(full.reason, 'maxLayers', 'at the cap');
    assert.equal(full.insertions, 0);
    const stopped = await deepNeedleCycle(ev, [L('TiO2', 30), L('SiO2', 50)], { pairs: true },
        runOf(serialRunner(), { shouldStop: () => true }));
    assert.equal(stopped.reason, 'stopped', 'Stop');
    console.log(`ok 5  jointStep and deepNeedleCycle (${r.insertions} moves, MF ${r.mf.toExponential(3)}, ${r.reason})`);
}

// ── 6. The stops of gradual evolution on a rule runner ────────────────────────
{
    // A forced step from one design gives the other; the needle cycle finds no
    // move (every needle, pair and deletion is void). A is the better one.
    const X = [L('TiO2', 60), L('SiO2', 90)], Y = [L('SiO2', 100), L('TiO2', 40), L('SiO2', 80)];
    const [A, B] = ev.mf(X) < ev.mf(Y) ? [X, Y] : [Y, X];
    const swap = { step: d => (Dz.sameBits(d, A) ? B : A), plain: d => d };
    // pairsAt[k]: the pair moves offered up to step k + 1's event.
    const ge = async (rules, opts, over = {}) => {
        const events = [], preps = [], pairsAt = [];
        const count = () => preps.filter(p => p?.kind === 'pair').length;
        const onEvent = e => { events.push(e); pairsAt.push(count()); };
        const out = await runGradualEvolution(ev, A, opts, runOf(ruleRunner(rules, preps), { onEvent, ...over }));
        assert.deepEqual(events.map(e => e.step), Array.from({ length: out.steps }, (_, i) => i + 1), 'a geStep per step');
        events.forEach(e => assert.ok(e.type === 'geStep' && e.reason === null && e.mf === ev.mf(e.layers)));
        return { ...out, events, pairsAt };
    };

    // B (new best), A (new best), B (seen), A (seen), B again: cycle.
    const cyc = await ge(swap, {});
    assert.equal(cyc.reason, 'cycle');
    assert.equal(cyc.steps, 5);
    assert.deepEqual(cyc.events.map(e => e.layers.length), [B, A, B, A, B].map(d => d.length));
    assert.deepEqual(cyc.best, { layers: A, mf: ev.mf(A) }, 'the best design of the run');
    const pairsPerStep = cyc.pairsAt.map((n, k) => n - (cyc.pairsAt[k - 1] ?? 0));
    assert.deepEqual(pairsPerStep.map(n => n > 0), [false, false, false, true, true],
        'joint moves only in the cycles after a step without a new best (ge.c 337)');

    const stall = await ge(swap, { cycle: false, patience: 3 });
    assert.deepEqual([stall.reason, stall.steps], ['stalled', 5], 'three steps without a new best');

    const kept = await ge(swap, { cycle: false, keepPatience: 3 }, { log: newLog(1) });
    assert.deepEqual([kept.reason, kept.steps], ['kept', 3], 'three steps without a better kept design');
    const noKeeper = await ge(swap, { cycle: false, patience: 4, keepPatience: 3 }, { log: newLog(null) });
    assert.equal(noKeeper.reason, 'stalled', 'no keeper, no keep-patience stop');

    const undone = await ge({ step: () => B, plain: () => A }, {});
    assert.deepEqual([undone.reason, undone.steps], ['undone', 1], 'the cycle takes every step back to the last design');

    const none = await ge({ step: d => d, plain: d => d }, {});
    assert.deepEqual([none.reason, none.steps, none.best], ['noStep', 0, null], 'every step refined back: none');
    console.log('ok 6  cycle, stalled, kept, undone, noStep');
}

// ── 7. Real optics ────────────────────────────────────────────────────────────
// The best single layer: every pool material on a 1 nm grid to one wave,
// the best refined.
function bestSingleLayer(e) {
    let best = { layers: [], mf: e.mf([]) };
    for (const material of e.pool) {
        const top = N.thicknessCap(e, material);
        for (let t = e.floor; t <= top; t += 1) {
            const mf = e.mf([L(material, t)]);
            if (mf < best.mf) best = { layers: [L(material, t)], mf };
        }
    }
    return e.refine(best.layers);
}

async function realGe(e, start) {
    const counter = { jobs: 0 };
    const log = newLog(e.maxLayers);
    const t0 = performance.now();
    const out = await runGradualEvolution(e, start, {}, runOf(serialRunner(counter), { log }));
    assert.ok(GE_REASONS.includes(out.reason), out.reason);
    assert.ok(out.keep === log.keep && log.keep.layers.length <= e.maxLayers, 'the kept design within the cap');
    assert.ok(log.trace.points.every(p => p.n <= e.maxLayers + 1), 'at most a split past the cap (needle.c 466)');
    assert.ok(out.best.mf <= log.keep.mf && near(out.best.mf, e.mf(out.best.layers)));
    assert.ok(minThickness(out.best.layers) >= e.floor * (1 - 1e-9), 'at or above the floor');
    const maxN = Math.max(...log.trace.points.map(p => p.n));
    return { ...out, log, maxN, jobs: counter.jobs, ms: performance.now() - t0 };
}

{
    const e = fixture('bbar', { maxLayers: 6 });
    const single = bestSingleLayer(e);
    const r = await realGe(e, []);
    assert.ok(r.best.mf < 0.5 * single.mf, `from nothing: ${r.best.mf} well below the best single layer ${single.mf}`);
    console.log(`ok 7  BBAR from nothing, 20 nm, cap 6: MF ${r.best.mf.toExponential(3)} at ${r.best.layers.length}`
        + ` layers (best single layer ${single.mf.toExponential(3)}), ${r.steps} steps, ${r.reason},`
        + ` at most ${r.maxN} layers, ${r.jobs} jobs, ${Math.round(r.ms)} ms`);

    const edge = fixture('shortpass', { dMin: 40, maxLayers: 8 });
    const one = edge.refine([L('SiO2', 100)]);
    const a = await realGe(edge, one.layers);
    const b = await realGe(edge, one.layers);
    assert.ok(a.best.mf < 0.2 * one.mf, `shortpass: ${a.best.mf} many times below one layer's ${one.mf}`);
    assert.deepEqual([b.best, b.reason, b.steps], [a.best, a.reason, a.steps], 'the same twice');
    console.log(`ok 7  shortpass from one layer, 40 nm, cap 8: MF ${one.mf.toExponential(3)} -> `
        + `${a.best.mf.toExponential(3)} at ${a.best.layers.length} layers, ${a.steps} steps, ${a.reason},`
        + ` at most ${a.maxN} layers, ${a.jobs} jobs, ${Math.round(a.ms)} ms`);
}

// ── 8. Stop and regrid ────────────────────────────────────────────────────────
{
    const e = fixture('shortpass', { dMin: 40, maxLayers: 8 });
    const one = e.refine([L('SiO2', 100)]).layers;
    const counter = { jobs: 0 };
    const now = await runGradualEvolution(e, one, {}, runOf(serialRunner(counter), { shouldStop: () => true }));
    assert.deepEqual([now.reason, now.steps, now.best, counter.jobs], ['stopped', 0, null, 0], 'Stop before a step');

    const mid = { jobs: 0 };
    let at = Infinity;
    const shouldStop = () => { if (mid.jobs >= 12 && at === Infinity) at = mid.jobs; return mid.jobs >= 12; };
    const r = await runGradualEvolution(e, one, {}, runOf(serialRunner(mid), { shouldStop }));
    assert.equal(r.reason, 'stopped', 'Stop in the middle of a run');
    assert.equal(mid.jobs - at, 0, 'no job starts once Stop is seen');
    assert.ok(r.best === null || near(r.best.mf, e.mf(r.best.layers)), 'the best so far');

    // A regrid at the first step: the run goes on with the new evaluator and a
    // keeper rescored on it.
    const grids = [];
    const regrid = layers => {
        grids.push(layers.length);
        return grids.length === 1 ? fixture('shortpass', { dMin: 40, maxLayers: 5 }) : null;
    };
    const log = newLog(8);
    const before = log.keep;
    const g = await runGradualEvolution(e, one, {}, runOf(serialRunner(), { regrid, log }));
    assert.equal(grids[0], 1, 'called with the design about to be worked on');
    assert.equal(g.ev.maxLayers, 5, 'the run ends on the new evaluator');
    assert.ok(g.keep === log.keep && g.keep !== before, 'the keeper swapped for a rescored one');
    assert.equal(g.reason, 'maxLayers');
    assert.ok(g.keep.cap === 8 && g.best.layers.length <= 6, 'the cap of the new evaluator ends the run');
    console.log(`ok 8  Stop and regrid (stopped after ${at} jobs)`);
}

// ── 9. A merit still falling one wave out ─────────────────────────────────────
{
    // BBAR with a total thickness of 800 nm asked for: from nothing a new
    // layer's merit still falls one wave out (under 500 nm), where ge.c has no
    // step and the run would end at no layers. The step is the lowest point
    // sampled, and the run grows a design.
    const tt = { ...makeOperand({ type: 'TT', target: 800, weight: 1 }), enabled: true };
    const e = fixture('bbar', { operands: [...caseById('bbar').ops.map(op => ({ ...op, enabled: true })), tt], maxLayers: 3 });
    const st = { k: -1, pos: 0, material: 'SiO2' };
    const h = e.lamMin / (S.STEP_PER_WAVE * e.n('SiO2', e.lamMin));
    const tMax = e.floor + e.lamMax / e.n('SiO2', e.lamMax);
    const m = S.nextMinimum(e, [], st, e.floor);
    assert.ok(tMax < 800 && m && m.thickness > tMax - h && m.thickness <= tMax, `the last step (${m?.thickness} nm)`);
    assert.equal(m.mf, e.mf(S.placeStep([], st, m.thickness)), 'the merit there');
    assert.ok(m.mf < e.mf(S.placeStep([], st, m.thickness - h)), 'still falling');

    const log = newLog(e.maxLayers);
    const r = await runGradualEvolution(e, [], {}, runOf(serialRunner(), { log }));
    assert.ok(r.steps >= 1 && r.best && r.best.layers.length >= 1, `grows from nothing (${r.reason}, ${r.steps} steps)`);
    assert.ok(r.best.mf < 0.01 * e.mf([]), `the merit from ${e.mf([])} to ${r.best.mf}`);
    const total = r.best.layers.reduce((sum, l) => sum + l.thickness, 0);
    assert.ok(Math.abs(total - 800) < 8, `the total thickness near 800 nm (${total})`);
    console.log(`ok 9  TT 800 nm from nothing: ${r.best.layers.length} layers, ${total.toFixed(1)} nm, `
        + `MF ${r.best.mf.toExponential(3)}, ${r.steps} steps, ${r.reason}`);
}

console.log(`All Deep Synthesis gradual evolution tests passed (engine ${ENGINE}).`);
