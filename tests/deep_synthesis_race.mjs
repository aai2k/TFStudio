/**
 * Deep Synthesis race (src/utils/synthesis/deepSynthesis/race.js, the lab's race.c).
 *
 *   1. Rung budgets: 27 iterations, then 81 capped at maxIter, then the end.
 *   2. Each cut keeps ceil(n / 3), at least `keep`, ties to the lower index.
 *   3. A candidate whose refinement ended early keeps its merit and is not run again.
 *   4. `reject` removes a finished design; when no survivor stands, the dropped are
 *      refined to the end one at a time, the latest cut's best first, and a dropped
 *      one whose refinement had ended stands again without another call.
 *   5. A void candidate (its preparation failed) is neither alive nor a spare.
 *   6. shouldStop ends the race.
 *   7. A rung is a batch of independent jobs: a runner that sends each item through a
 *      structured clone and settles them out of order gives the serial result.
 *   8. Real optics: three needle-inserted bbar designs raced with the serial runner,
 *      once serially and once batched.
 *
 * The synthetic refinement names each candidate by its layer's material and reads its
 * merit from a table of (iterations, merit) steps, so the expected cuts are known.
 *
 * Run: node tests/deep_synthesis_race.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { raceRefine, RACE } = await import('../src/utils/synthesis/deepSynthesis/race.js');

const newPart = () => ({ iters: 0, state: null, done: false, mf: NaN, void: false });

// A candidate: its name, merit steps { iters: mf }, the iteration its refinement
// ends at (Infinity for never before maxIter), and whether its preparation fails.
const cand = (name, steps, { endAt = Infinity, isVoid = false } = {}) => ({ name, steps, endAt, isVoid });

function meritAt(steps, iters) {
    let mf = Infinity;
    for (const [at, value] of Object.entries(steps)) if (Number(at) <= iters) mf = value;
    return mf;
}

// The refine_part rule of refine.c 569-589, on the synthetic merit.
function refineSynthetic(book, item, upto, maxIter) {
    const { part } = item;
    const cap = Math.min(upto, maxIter);
    if (part.done || (part.iters > 0 && cap <= part.iters)) return item;
    const c = book[item.layers[0].material];
    if (c.isVoid) return { ...item, part: { ...part, void: true, done: true, mf: Infinity } };
    const iters = Math.min(cap, c.endAt);
    const done = iters >= c.endAt || iters >= maxIter;
    const layers = [{ material: c.name, thickness: 100 + iters }];
    return { ...item, layers, part: { iters, state: { radius: iters }, done, mf: meritAt(c.steps, iters), void: false } };
}

function race(cands, opts = {}) {
    const book = Object.fromEntries(cands.map(c => [c.name, c]));
    const items = cands.map(c => ({ layers: [{ material: c.name, thickness: 100 }], prep: null, part: newPart() }));
    const maxIter = opts.maxIter ?? 60;
    const calls = [];
    const job = (item, upto) => refineSynthetic(book, item, upto, maxIter);
    const runRung = opts.batched ? batchedRung(job, calls) : serialRung(job, calls);
    const shouldStop = opts.stopAfter === undefined ? undefined : () => calls.length >= opts.stopAfter;
    const before = JSON.stringify(items);
    return raceRefine(items, { maxIter, ...opts, runRung, shouldStop }).then(out => {
        assert.equal(JSON.stringify(items), before, 'the race does not change the items it is given');
        return { out, calls };
    });
}

const record = (calls, items, upto) => calls.push({ names: items.map(it => it.layers[0].material), upto });

function serialRung(job, calls) {
    return async (items, upto) => {
        record(calls, items, upto);
        return items.map(it => job(it, upto));
    };
}

// One job per item through a structured clone, settled in reverse order on staggered
// timers, gathered in item order as WorkerPool.map does.
function batchedRung(job, calls) {
    return async (items, upto) => {
        record(calls, items, upto);
        return Promise.all(items.map((it, k) => new Promise(resolve => {
            const msg = structuredClone({ item: it, upto });
            setTimeout(() => resolve(structuredClone(job(msg.item, msg.upto))), 2 * (items.length - k));
        })));
    };
}

const standing = out => out.filter(it => Number.isFinite(it.mf)).map(it => it.layers[0].material);
const plan = calls => calls.map(c => `${c.names.join(',')}@${c.upto}`);
const names = n => Array.from({ length: n }, (_, i) => `c${i}`);

// Nine candidates: c3, c5, c1 lead at 27; c1 leads at 60 and after.
const m27 = [5, 3, 8, 1, 9, 2, 7, 6, 4];
const nine = (later = {}) => names(9).map((name, i) => cand(name, { 27: m27[i], ...(later[name] ?? {}) }));
const leaders = { c1: { 60: 0.5, 200: 0.4 }, c3: { 60: 0.9, 200: 0.8 }, c5: { 60: 0.7, 200: 0.6 } };

// ── 1. Rung budgets ───────────────────────────────────────────────────────────
{
    assert.deepEqual({ ...RACE }, { first: 27, eta: 3, rungs: 2, keep: 1 }, 'race.c defaults');
    const long = await race(nine(leaders), { maxIter: 200 });
    assert.deepEqual(plan(long.calls), ['c0,c1,c2,c3,c4,c5,c6,c7,c8@27', 'c1,c3,c5@81', 'c1@200'],
        'rungs at 27 and 81 iterations, then the survivor to the end');
    assert.deepEqual(standing(long.out), ['c1']);
    assert.equal(long.out[1].mf, 0.4);
    assert.equal(long.out[1].part.iters, 200);

    const short = await race(nine(leaders), { maxIter: 60 });
    assert.deepEqual(plan(short.calls), ['c0,c1,c2,c3,c4,c5,c6,c7,c8@27', 'c1,c3,c5@60'],
        'the 81-iteration rung is capped at maxIter, which ends every survivor, so the last rung runs nothing');
    assert.deepEqual(standing(short.out), ['c1']);
    assert.equal(short.out[1].mf, 0.5);
    assert.equal(short.out[3].part.mf, 0.9, 'a dropped candidate keeps its own merit on its part');
    assert.equal(short.out[3].mf, Infinity, 'and has no verdict');
    assert.equal(short.out[0].part.iters, 27, 'a candidate cut at the first rung stops at 27 iterations');
    console.log('ok 1  rung budgets');
}

// ── 2. Cut size and ties ──────────────────────────────────────────────────────
{
    for (const n of [1, 2, 3, 4, 5, 7, 9, 10]) {
        const { calls } = await race(names(n).map((name, i) => cand(name, { 27: i + 1 })), { maxIter: 200 });
        assert.equal(calls[1].names.length, Math.max(1, Math.ceil(n / 3)), `${n} candidates keep ceil(n / 3)`);
    }
    const kept2 = await race(names(3).map((name, i) => cand(name, { 27: 3 - i })), { maxIter: 200, keep: 2 });
    assert.deepEqual(kept2.calls[1].names, ['c1', 'c2'], 'keep sets the least kept; survivors run in index order');

    const even = await race(names(6).map(name => cand(name, { 27: 1, 81: 0.5, 200: 0.2 })), { maxIter: 200 });
    assert.deepEqual(even.calls[1].names, ['c0', 'c1'], 'equal merits: the lower indices go on');
    assert.deepEqual(standing(even.out), ['c0'], 'and the lower index wins');

    const mixed = await race([3, 1, 2, 1, 1, 5].map((v, i) => cand(`c${i}`, { 27: v, 81: 0.5 })), { maxIter: 200 });
    assert.deepEqual(mixed.calls[1].names, ['c1', 'c3'], 'of three tied leaders the two lowest indices go on');
    console.log('ok 2  cut size and ties');
}

// ── 3. A refinement that ended early ─────────────────────────────────────────
{
    const cs = [cand('c0', { 27: 0.3, 60: 0.5 }), cand('c1', { 27: 0.6 }), cand('c2', { 10: 0.1 }, { endAt: 10 }),
        cand('c3', { 27: 0.7 }), cand('c4', { 27: 0.8 }), cand('c5', { 27: 0.9 })];
    const { out, calls } = await race(cs, { maxIter: 60 });
    assert.deepEqual(plan(calls), ['c0,c1,c2,c3,c4,c5@27', 'c0@60'],
        'the finished candidate goes on without being run again');
    assert.deepEqual(standing(out), ['c2']);
    assert.equal(out[2].mf, 0.1, 'it keeps its final merit');
    assert.equal(out[2].part.iters, 10);
    console.log('ok 3  early end');
}

// ── 4. Reject and revival ─────────────────────────────────────────────────────
{
    const seen = [];
    const rejectOf = bad => (layers, mf) => {
        seen.push(layers[0].material);
        assert.ok(Number.isFinite(mf), 'reject is shown the finished merit');
        return bad.includes(layers[0].material);
    };
    // c0, c1, c2 lead at 27; c1, then c2, then c0 at 81 and after.
    const later = { c0: { 81: 0.3, 200: 0.25 }, c1: { 81: 0.1, 200: 0.05 }, c2: { 81: 0.2, 200: 0.15 } };
    const wide = names(9).map((name, i) => cand(name, { 27: i + 1, ...(later[name] ?? { 81: 5, 200: 5 }) }));
    const { out, calls } = await race(wide, { maxIter: 200, reject: rejectOf(['c1', 'c2']) });
    assert.deepEqual(plan(calls), ['c0,c1,c2,c3,c4,c5,c6,c7,c8@27', 'c0,c1,c2@81', 'c1@200', 'c2@200', 'c0@200'],
        'the survivor is rejected; the last cut\'s dropped are revived best first, one at a time');
    assert.deepEqual(seen, ['c1', 'c2', 'c0'], 'reject sees only finished designs');
    assert.deepEqual(standing(out), ['c0']);
    assert.equal(out[1].mf, Infinity, 'a rejected design has no verdict');

    const ended = [...wide];
    ended[2] = cand('c2', { 27: 3, 50: 0.2 }, { endAt: 50 });
    const back = await race(ended, { maxIter: 200, reject: rejectOf(['c1']) });
    assert.deepEqual(plan(back.calls), ['c0,c1,c2,c3,c4,c5,c6,c7,c8@27', 'c0,c1,c2@81', 'c1@200'],
        'a dropped candidate whose refinement had ended is revived without a call');
    assert.deepEqual(standing(back.out), ['c2']);
    assert.equal(back.out[2].mf, 0.2);

    const allRejected = await race(nine(leaders), { maxIter: 60, reject: () => true });
    assert.deepEqual(standing(allRejected.out), [], 'nothing stands when every design is rejected');
    assert.equal(allRejected.calls.length, 2 + 6, 'each spare of the first cut is refined once to the end');
    assert.ok(allRejected.calls.slice(2).every(c => c.names.length === 1 && c.upto === 60));
    console.log('ok 4  reject and revival');
}

// ── 5. Void candidates ────────────────────────────────────────────────────────
{
    const cs = [cand('c0', { 27: 1 }), cand('c1', {}, { isVoid: true }), cand('c2', { 27: 2 }), cand('c3', { 27: 3 })];
    const { out, calls } = await race(cs, { maxIter: 60, reject: () => true });
    assert.deepEqual(calls[1].names, ['c0'], 'three candidates stand after a void one: keep ceil(3 / 3)');
    assert.ok(!calls.slice(1).some(c => c.names.includes('c1')), 'a void candidate is never revived');
    assert.deepEqual(plan(calls), ['c0,c1,c2,c3@27', 'c0@60', 'c2@60', 'c3@60']);
    assert.equal(out[1].mf, Infinity);
    assert.equal(out[1].part.void, true);
    console.log('ok 5  void candidates');
}

// ── 6. Stop ───────────────────────────────────────────────────────────────────
{
    const now = await race(nine(leaders), { stopAfter: 0 });
    assert.equal(now.calls.length, 0, 'a stop before the first rung runs nothing');
    assert.deepEqual(standing(now.out), []);

    const one = await race(nine(leaders), { stopAfter: 1 });
    assert.equal(one.calls.length, 1, 'a stop after the first rung runs no other');
    assert.deepEqual(standing(one.out), [], 'a refinement cut short has no verdict');

    const early = [cand('c0', { 5: 0.1 }, { endAt: 5 }), cand('c1', { 27: 1 }), cand('c2', { 27: 2 })];
    const kept = await race(early, { stopAfter: 1 });
    assert.deepEqual(standing(kept.out), ['c0'], 'a survivor refined to the end before the stop keeps its verdict');

    const revival = await race(nine(leaders), { reject: () => true, stopAfter: 4 });
    assert.equal(revival.calls.length, 4, 'a stop between revivals ends them');
    console.log('ok 6  stop');
}

// ── 7. Serial against batched ─────────────────────────────────────────────────
{
    const many = names(20).map((name, i) => {
        const a = ((i * 7) % 11) / 10, b = ((i * 5) % 13) / 4;
        const steps = { 27: a + b / 28, 81: a + b / 82, 200: a + b / 201 };
        return cand(name, steps, { endAt: i % 6 === 0 ? 40 + i : Infinity, isVoid: i === 13 });
    });
    const reject = (layers, mf) => mf < 0.3;
    for (const opts of [{ maxIter: 200 }, { maxIter: 60 }, { maxIter: 200, reject }]) {
        const serial = await race(many, opts);
        const batched = await race(many, { ...opts, batched: true });
        assert.deepEqual(batched.out, serial.out, 'a batched race ends on the serial result');
        assert.deepEqual(batched.calls, serial.calls, 'and runs the same rungs');
        assert.ok(standing(serial.out).length >= 1);
    }
    console.log('ok 7  serial matches batched');
}

// ── 8. Real optics ────────────────────────────────────────────────────────────
await realOptics();

// The shared fixture of the Deep Synthesis tests on bbar, with the inline serial
// runner's job: a fresh evaluator per item.
async function opticsFixture() {
    const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
    const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
    const { presampleSynthesisMaterials } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');
    const { makeEngine } = await import('../src/utils/optimizers/index.js');
    const { DLSOptimizer } = await import('../src/utils/physics/optimizer.js');
    const { makeEvaluator, newPart: evPart } = await import('../src/utils/synthesis/deepSynthesis/evaluator.js');

    // Step 1's engine is required: no fallback to another engine here.
    const probe = makeEngine('trust-region', caseById('bbar').ops, caseById('bbar').thin(), getMaterial, {});
    assert.notEqual(probe.constructor, DLSOptimizer, "makeEngine('trust-region') is registered");
    const ENGINE = 'trust-region';
    const base = { surfaceMode: 'front_only', mfEvalMode: 'side', incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 } };
    const pool = ['TiO2', 'SiO2'];
    const operands = caseById('bbar').ops.map(op => ({ ...op, enabled: true }));
    const design = { ...base, frontLayers: [], backLayers: [] };
    const materials = presampleSynthesisMaterials(design, operands, pool.map(id => ({ id, mat: getMaterial(id) })));
    const spec = { operands, base, side: 'front', otherLayers: [], pool, dMin: 20, dMax: Infinity, maxLayers: 8,
        engine: ENGINE, refine: { maxIter: 60, plateau: 6, plateauGain: 1e-4 }, targetMf: 1e-4 };
    const ev = makeEvaluator(spec, { materials });
    const job = (it, upto) => makeEvaluator(ev.spec, { materials: ev.materials }).refinePart(it, upto);
    return { ENGINE, ev, job, newPart: evPart };
}

// On bbar at a 20 nm floor these refinements end within ten iterations, so the
// lab's first rung of 27 settles them; a first rung of 2 makes the survivor go on
// across rungs from the engine state it stopped with.
async function realOptics() {
    const fx = await opticsFixture();
    const L = (material, thickness) => ({ material, thickness });
    const starts = [
        [L('SiO2', 20), L('TiO2', 30), L('SiO2', 50)],
        [L('TiO2', 30), L('SiO2', 25), L('TiO2', 20), L('SiO2', 25)],
        [L('TiO2', 30), L('SiO2', 50), L('TiO2', 20)],
    ];
    const items = starts.map(layers => ({ layers, prep: null, part: fx.newPart() }));
    for (const first of [RACE.first, 2]) {
        const w = await opticsRace(fx, items, first);
        console.log(`ok 8  real optics (${fx.ENGINE}, first rung ${first}): MF ${w.mf.toExponential(3)}`
            + ` in ${w.part.iters} iterations`);
    }
}

async function opticsRace({ ev, job }, items, first) {
    const maxIter = ev.spec.refine.maxIter;
    const serialCalls = [], batchedCalls = [];
    const serial = await raceRefine(items, { maxIter, first, runRung: serialRung(job, serialCalls) });
    const batched = await raceRefine(items, { maxIter, first, runRung: batchedRung(job, batchedCalls) });
    const atFirst = items.map(it => job(it, first).part.mf);
    const lead = atFirst.indexOf(Math.min(...atFirst));
    checkOpticsWinner(serial, { lead, first, ev, start: items[lead].layers });
    assert.deepEqual(batched.map(it => [it.layers, it.mf]), serial.map(it => [it.layers, it.mf]),
        'the batched race gives the serial layers and merits');
    assert.deepEqual(batchedCalls, serialCalls);
    return serial[lead];
}

function checkOpticsWinner(out, { lead, first, ev, start }) {
    const winners = out.map((it, i) => (Number.isFinite(it.mf) ? i : -1)).filter(i => i >= 0);
    assert.deepEqual(winners, [lead], 'of three candidates the one that led after the first rung stands');
    const w = out[lead];
    assert.equal(w.mf, w.part.mf);
    assert.ok(w.part.done);
    assert.ok(w.mf < ev.mf(start), 'the race lowers the merit of the design it keeps');
    assert.ok(w.layers.every(l => l.thickness >= ev.spec.dMin - 1e-9), 'every layer stays at or above dMin');
    out.forEach((it, i) => {
        if (i !== lead) assert.ok(it.part.done || it.part.iters === first, 'a dropped candidate ran the first rung only');
    });
}

console.log('All Deep Synthesis race tests passed.');
