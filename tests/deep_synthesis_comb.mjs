/**
 * Deep Synthesis comb (points.js and comb.js, a port of cavity.c and the
 * lab's Point, point_kind and half_wave).
 *
 *   1. Target points: the pointKind table; targetPoints on the 3-line
 *      bandpass (one point per sample wavelength, in operand order, all pass
 *      or stop, each weighing its share of its row's weight) and on R
 *      targets; repeats of a point merged with their weights added; a ramp,
 *      an absorptance and a group-delay row make allPassStop false, while
 *      blank, thickness, zero-weight and disabled rows do not count;
 *      passIndices; passRuns on hand-built points
 *      (wavelength order, a pass point before a stop point at one wavelength,
 *      0 with a point that is neither); nCos and halfWave at normal and
 *      oblique incidence.
 *   2. The comb applies to the bandpass (three pass runs) and is off with one
 *      pass run (bbar, shortpass), on R = 0.5 (bs), on a ramp and with an
 *      absorptance row added, each with its reason code.
 *   3. combPeriods finds the cavity of a synthetic comb without dispersion,
 *      gives nothing when every point has the same order per nm, and gives at
 *      most two cavity thicknesses with S > 0 on the bandpass, best first.
 *   4. combSeeds: count and order, the reflector at the floor and at twice the
 *      floor while within a quarter wave, a fifth of a quarter wave without a
 *      floor, no cavity thinner than the floor.
 *   5. buildSeed lays cavities and reflectors out, with and without end
 *      reflectors.
 *   6. runComb on the bandpass at a small cap: every seed refined once and
 *      recorded in seed order, the distinct seeds grown best refined first,
 *      their traces appended in that order, the kept design the best on the
 *      trace within the cap, the grown design the best growth; the kept design
 *      lowers the merit from the bare substrate and from one refined layer;
 *      the same result twice, every job through a structured clone.
 *   7. On a synthetic runner: refined seeds within the same-design tolerances
 *      are grown once, ties in refined merit go to the earlier seed, ties in
 *      grown merit to the earlier run, and the kept design is the best within
 *      the cap among refined seeds and growths. Given a keeper of the
 *      caller's, the comb keeps its designs there, and a growth batch that
 *      does not come back leaves the best refined seed in it.
 *   8. runComb does no work where the comb is off or no period fits, and
 *      stops when asked.
 *
 * Run: node tests/deep_synthesis_comb.mjs
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
const { operandSampleLambdas, bandQuadratureWeights } = await import('../src/utils/physics/optimizer/sampling.js');
const { makeEvaluator } = await import('../src/utils/synthesis/deepSynthesis/evaluator.js');
const { makeTrace, makeKeeper } = await import('../src/utils/synthesis/deepSynthesis/trace.js');
const { sameBits } = await import('../src/utils/synthesis/deepSynthesis/design.js');
const {
    pointKind, targetPoints, passIndices, passRuns, nCos, halfWave,
} = await import('../src/utils/synthesis/deepSynthesis/points.js');
const {
    COMB, combApplies, combPeriods, combSeeds, buildSeed, growSeed, runComb,
} = await import('../src/utils/synthesis/deepSynthesis/comb.js');

// Step 1's engine is required: no fallback to another engine here.
const probe = makeEngine('trust-region', caseById('bbar').ops, caseById('bbar').thin(), getMaterial, {});
assert.notEqual(probe.constructor, DLSOptimizer, "makeEngine('trust-region') is registered");
const ENGINE = 'trust-region';

const base = { surfaceMode: 'front_only', mfEvalMode: 'side', incidentMedium: 'Air', exitMedium: 'Air',
               substrate: { material: 'BK7', thickness: 1 } };
const pool = ['TiO2', 'SiO2'];
function evaluatorFor(operands, over = {}, media = base) {
    const design = { ...media, frontLayers: [], backLayers: [] };
    const materials = presampleSynthesisMaterials(design, operands, pool.map(id => ({ id, mat: getMaterial(id) })));
    const spec = { operands, base: media, side: 'front', otherLayers: [], pool, dMin: 20, dMax: Infinity, maxLayers: 8,
                   engine: ENGINE, refine: { maxIter: 60, plateau: 6, plateauGain: 1e-4 }, targetMf: 1e-4, ...over };
    return makeEvaluator(spec, { materials });
}
const caseOps = caseId => caseById(caseId).ops.map(op => ({ ...op, enabled: true }));
const fixture = (caseId, over = {}) => evaluatorFor(caseOps(caseId), over);
const withRows = (caseId, ...rows) => evaluatorFor([...caseOps(caseId), ...rows]);

const tgt = (type, a, b, t, te) =>
    makeOperand({ type, lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: t, targetEnd: te ?? t, weight: 1 });
const point = (lam, kind) => ({ lam, aoi: 0, n0: 1, q: 'T', target: kind === 'pass' ? 1 : 0, weight: 1, kind });

// ── 1. Target points ─────────────────────────────────────────────────────────
{
    const table = [['T', 1, 'pass'], ['T', 0, 'stop'], ['R', 0, 'pass'], ['R', 1, 'stop'],
                   ['T', 0.5, 'none'], ['R', 0.99, 'none'], ['T', 1 + 1e-15, 'none'], ['R', -0, 'pass']];
    for (const [q, target, kind] of table) assert.equal(pointKind(q, target), kind, `${q} = ${target} is ${kind}`);
}
{
    const ev = fixture('bandpass');
    const { points, allPassStop } = targetPoints(ev);
    assert.equal(allPassStop, true, 'bandpass: every row a pass or stop target');
    const lams = ev.operands.flatMap(op => operandSampleLambdas(op));
    assert.deepEqual(points.map(p => p.lam), lams, 'one point per sample wavelength, in operand order');
    const kinds = ev.operands.flatMap(op => operandSampleLambdas(op).map(() => (op.target === 1 ? 'pass' : 'stop')));
    assert.deepEqual(points.map(p => p.kind), kinds, 'T = 1 rows pass, T = 0 rows stop');
    assert.equal(ev.incident, 'Air');
    assert.ok(points.every(p => p.q === 'T' && p.aoi === 0 && p.n0 === ev.n('Air', p.lam)),
        'quantity, angle and the incident index of each point');
    const shares = ev.operands.flatMap(op => [...bandQuadratureWeights(operandSampleLambdas(op).length)]
        .map(q => op.weight * q));
    assert.deepEqual(points.map(p => p.weight), shares, "each point weighs its share of its row's weight, as calcMF");
    let at = 0;
    for (const op of ev.operands) {
        const n = operandSampleLambdas(op).length;
        const sum = points.slice(at, at + n).reduce((w, p) => w + p.weight, 0);
        assert.ok(Math.abs(sum - op.weight) <= 1e-12, `a band's points sum to its row's weight (${n} samples)`);
        at += n;
    }
    assert.deepEqual(passIndices(points), kinds.flatMap((k, i) => (k === 'pass' ? [i] : [])), 'pass indices');

    const glass = evaluatorFor(caseOps('bandpass'), {}, { ...base, incidentMedium: 'BK7' });
    const inGlass = targetPoints(glass).points;
    assert.equal(glass.incident, 'BK7');
    assert.ok(inGlass.every(p => p.n0 === glass.n('BK7', p.lam) && p.n0 > 1.4), 'n0: the incident medium at each wavelength');

    const rPoints = targetPoints(evaluatorFor([tgt('RGT', 400, 450, 0), tgt('RAV', 500, 550, 1), tgt('R', 600, 600, 0)]));
    assert.equal(rPoints.allPassStop, true, 'R targets of 0 and 1');
    assert.ok(rPoints.points.every(p => p.q === 'R'), 'R points');
    assert.equal(passRuns(rPoints.points, rPoints.allPassStop), 2, 'R = 0, R = 1, R = 0: two pass runs');

    const ramp = targetPoints(withRows('bandpass', tgt('TGT', 710, 730, 0, 1)));
    const rampPts = ramp.points.slice(points.length);
    assert.equal(ramp.allPassStop, false, 'a ramp is not a pass or stop target');
    assert.ok(rampPts.length >= 2 && rampPts.every(p => p.kind === 'none'), 'no ramp point is a pass or stop point');
    assert.deepEqual([rampPts[0].target, rampPts.at(-1).target], [0, 1], 'the ramp line at its ends');
    assert.deepEqual(ramp.points.slice(0, points.length), points, 'the other rows keep their points');
    const flat = targetPoints(withRows('bandpass', tgt('TGT', 710, 730, 0, 0)));
    assert.equal(flat.allPassStop, true, 'a flat range target is a stop target');

    const absorb = targetPoints(withRows('bandpass', tgt('AAV', 500, 600, 0)));
    assert.equal(absorb.allPassStop, false, 'an absorptance row counts toward the merit');
    assert.equal(absorb.points.length, points.length, 'and gives no point');
    const gd = targetPoints(withRows('bandpass', makeOperand({ type: 'GD', lambdaStart: 550, lambdaEnd: 550, target: 0 })));
    assert.equal(gd.allPassStop, false, 'a group-delay row counts toward the merit');

    // Rows asking for the same kind of point at one wavelength and angle give
    // one point with their shares added: adjacent pass bands sharing an edge,
    // a band repeated, and a single wavelength inside a band. A stop point at
    // a pass point's wavelength, or one at another angle, stays.
    const [lower, upper] = [tgt('TGT', 400, 450, 1), tgt('TGT', 450, 500, 1)];
    const shared = targetPoints(evaluatorFor([lower, upper, lower, tgt('T', 426, 426, 1),
        tgt('TGT', 520, 540, 0), tgt('TGT', 540, 560, 1), { ...tgt('T', 426, 426, 1), aoi: 20 }]));
    const firstBand = operandSampleLambdas(lower);
    const qLo = bandQuadratureWeights(firstBand.length);
    const qUp = bandQuadratureWeights(operandSampleLambdas(upper).length);
    const pts = shared.points;
    assert.equal(new Set(pts.map(p => `${p.lam}|${p.aoi}|${p.kind}`)).size, pts.length, 'every point once');
    assert.deepEqual(pts.slice(0, firstBand.length).map(p => p.lam), firstBand, 'merged at the place of the first');
    const one = lam => pts.filter(p => p.lam === lam && p.aoi === 0 && p.kind === 'pass');
    const close = (a, b) => Math.abs(a - b) <= 1e-15;
    assert.equal(one(450).length, 1, 'a shared band edge is one pass point');
    assert.ok(close(one(450)[0].weight, 2 * qLo.at(-1) + qUp[0]), 'with the shares of both bands and the repeat');
    assert.ok(firstBand.includes(426) && one(426).length === 1, 'a single wavelength inside a band is one point');
    assert.ok(close(one(426)[0].weight, 2 * qLo[firstBand.indexOf(426)] + 1), 'weighing all three');
    assert.equal(pts.filter(p => p.lam === 540).length, 2, 'a stop and a pass point at one wavelength both stay');
    assert.equal(pts.filter(p => p.lam === 426 && p.aoi === 20).length, 1, 'a point at another angle stays');
    const total = pts.reduce((w, p) => w + p.weight, 0);
    assert.ok(Math.abs(total - 7) <= 1e-12, 'the weights still sum to the rows\' weights');
    assert.equal(passIndices(pts).length, pts.filter(p => p.kind === 'pass').length);

    const inert = [makeOperand({ type: 'BLNK' }), makeOperand({ type: 'TT', target: 1000 }),
                   { ...tgt('AAV', 500, 600, 0), weight: 0 }, { ...tgt('AAV', 500, 600, 0), enabled: false }];
    for (const row of inert) {
        const r = targetPoints(withRows('bandpass', row));
        assert.equal(r.allPassStop, true, `${row.type} (weight ${row.weight}, enabled ${row.enabled}) does not count`);
        assert.equal(r.points.length, points.length);
    }
}
{
    // wavelength order; at 500 nm the pass point sorts before the stop point
    const shuffled = [point(500, 'stop'), point(500, 'pass'), point(400, 'pass')];
    assert.equal(passRuns(shuffled, true), 1, 'a pass point before a stop point at one wavelength');
    const three = [point(600, 'pass'), point(450, 'stop'), point(400, 'pass'), point(550, 'stop'), point(500, 'pass')];
    assert.equal(passRuns(three, true), 3, 'three pass runs, unsorted input');
    assert.equal(passRuns(three, false), 0, 'none unless every row is a pass or stop target');
    assert.equal(passRuns([...three, { ...point(700, 'stop'), kind: 'none' }], true), 0, 'none with a point that is neither');
    assert.equal(passRuns([], true), 0);
    assert.deepEqual(passIndices(three), [0, 2, 4]);
}
{
    const ev = fixture('bandpass');
    const lam = ev.lambdas[3];
    const n = ev.n('TiO2', lam);
    const normal = { ...point(lam, 'pass'), n0: ev.n('Air', lam) };
    assert.equal(nCos(ev, 'TiO2', normal), n, 'n cos(theta) at normal incidence is n');
    assert.equal(halfWave(ev, 'TiO2', normal), lam / (2 * n), 'a half wave at normal incidence');
    const oblique = { ...normal, aoi: 30, n0: 1.5 };
    const expected = Math.sqrt(n * n - 0.5625);   // n0 sin 30 deg = 0.75
    assert.ok(Math.abs(nCos(ev, 'TiO2', oblique) - expected) <= 1e-12 * expected, 'Snell at 30 degrees');
    assert.ok(Math.abs(halfWave(ev, 'TiO2', oblique) - lam / (2 * expected)) <= 1e-12 * lam, 'a half wave at 30 degrees');
}

// ── 2. Where the comb applies ────────────────────────────────────────────────
{
    const on = combApplies(fixture('bandpass'));
    assert.equal(on.on, true, 'the 3-line bandpass takes the comb');
    assert.equal(on.why, null);
    assert.equal(on.passRuns, 3, 'three pass runs between stop points');
    assert.ok(on.points.length > 0 && on.points.every(p => p.kind === 'pass' || p.kind === 'stop'));

    for (const [caseId, runs] of [['bbar', 1], ['shortpass', 1]]) {
        const off = combApplies(fixture(caseId));
        assert.equal(off.on, false, `${caseId}: one pass run is no comb`);
        assert.equal(off.why, 'passRuns', `${caseId}: off for its pass runs`);
        assert.equal(off.passRuns, runs, `${caseId}: ${runs} pass run`);
    }
    const bs = combApplies(fixture('bs'));
    assert.deepEqual([bs.on, bs.why, bs.passRuns], [false, 'notPassStop', 0], 'R = 0.5 is neither a pass nor a stop target');

    const ramp = combApplies(withRows('bandpass', tgt('TGT', 700, 720, 0, 1)));
    assert.deepEqual([ramp.on, ramp.why], [false, 'notPassStop'], 'a ramp is neither a pass nor a stop target');
    const absorb = combApplies(withRows('bandpass', tgt('AAV', 500, 600, 0)));
    assert.deepEqual([absorb.on, absorb.why], [false, 'notPassStop'], 'an absorptance operand turns the comb off');
    const blank = combApplies(withRows('bandpass', makeOperand({ type: 'BLNK' })));
    assert.equal(blank.on, true, 'a blank row does not count toward the optical merit');
}

// ── 3. Cavity thickness ──────────────────────────────────────────────────────
// A comb of a cavity of index 2 without dispersion and no reflector: the order is
// m = 4 d / lambda, so at d = 1000 nm stop points at m = 7 and 8 and pass points at
// m = 7.5 and 8.5 fit exactly (S = 1). The scan step is lambda_min / 256.
const flatEv = {
    pool: ['C', 'R'], floor: 20, lambdas: [],
    n: m => ({ C: 2, R: 1.5 })[m],
    nRef: m => ({ C: 2, R: 1.5 })[m],
};
const combPoints = [point(4000 / 8.5, 'pass'), point(4000 / 8, 'stop'), point(4000 / 7.5, 'pass'), point(4000 / 7, 'stop')];
flatEv.lambdas = combPoints.map(p => p.lam);
{
    const h = (4000 / 8.5) / (COMB.stepsPerOrder * 4);
    const found = combPeriods(flatEv, combPoints, { cavity: 'C', reflector: 'R', reflectorNm: 0, passRuns: 2 });
    assert.ok(found.length >= 1 && found.length <= COMB.periods, 'one or two cavity thicknesses');
    assert.ok(Math.abs(found[0].dc - 1000) <= h, `best cavity ${found[0].dc} nm is the grid step nearest 1000 nm`);
    assert.ok(found[0].S > 0.99, `the exact comb fits with S ${found[0].S}`);
    for (let i = 1; i < found.length; i++) assert.ok(found[i].S <= found[i - 1].S, 'best fit first');

    // Five pass runs ask for orders spread by 4 to 10 across the target, 2667 to
    // 6667 nm of cavity here, so the exact comb at 1000 nm is out of range.
    const wide = combPeriods(flatEv, combPoints, { cavity: 'C', reflector: 'R', reflectorNm: 0, passRuns: 5 });
    const spread = dc => 4 * dc / combPoints[0].lam - 4 * dc / combPoints[3].lam;
    assert.ok(wide.length > 0 && wide.every(p => spread(p.dc) >= 4 && spread(p.dc) <= 10), 'only cavities in the spread range');

    const same = [point(500, 'pass'), point(500, 'stop')];
    assert.deepEqual(combPeriods(flatEv, same, { cavity: 'C', reflector: 'R', reflectorNm: 20, passRuns: 2 }), [],
        'no order spread, no period');
    assert.deepEqual(combPeriods(flatEv, [], { cavity: 'C', reflector: 'R', reflectorNm: 20, passRuns: 2 }), []);

    const ev = fixture('bandpass');
    const { points, passRuns: runs } = combApplies(ev);
    const real = combPeriods(ev, points, { cavity: 'TiO2', reflector: 'SiO2', reflectorNm: 20, passRuns: runs });
    assert.ok(real.length >= 1 && real.length <= COMB.periods, `bandpass: ${real.length} cavity thicknesses`);
    assert.ok(real.every(p => p.S > 0 && p.dc > 0), 'every fit positive');
    for (let i = 1; i < real.length; i++) assert.ok(real[i].S <= real[i - 1].S, 'bandpass: best fit first');
}

// ── 4. Seeds ─────────────────────────────────────────────────────────────────
function checkFamilies(seeds, label) {
    assert.equal(seeds.length % 6, 0, `${label}: six seeds per period`);
    for (let i = 0; i < seeds.length; i += 6) {
        const fam = seeds.slice(i, i + 6);
        assert.deepEqual(fam.map(s => s.count), [4, 4, 6, 6, 8, 8], `${label}: cavity counts in order`);
        assert.deepEqual(fam.map(s => s.ends), [false, true, false, true, false, true], `${label}: ends in order`);
        assert.ok(fam.every(s => s.dc === fam[0].dc && s.reflectorNm === fam[0].reflectorNm), `${label}: one period`);
    }
}
function sides(seeds) {
    const first = seeds.findIndex(s => s.cavity !== seeds[0].cavity);
    return first < 0 ? [seeds, []] : [seeds.slice(0, first), seeds.slice(first)];
}
{
    // flat case: quarter wave at the middle grid wavelength 533.3 nm is 88.9 nm in R, 66.7 nm in C
    const seeds = combSeeds(flatEv, combPoints, 2);
    checkFamilies(seeds, 'floor 20');
    const [hiSide, loSide] = sides(seeds);
    assert.ok(hiSide.length > 0 && hiSide.every(s => s.cavity === 'C' && s.reflector === 'R'), 'high-index cavity first');
    assert.ok(loSide.every(s => s.cavity === 'R' && s.reflector === 'C'), 'then the low-index cavity');
    for (const side of [hiSide, loSide]) {
        const t = [...new Set(side.map(s => s.reflectorNm))];
        assert.deepEqual(t, t.slice().sort((a, b) => a - b), 'reflector thickness ascending within a side');
        assert.ok(t.every(x => x === 20 || x === 40), 'reflector at the floor and twice the floor');
    }
    assert.ok(hiSide.some(s => s.reflectorNm === 40), 'twice the floor is within a quarter wave');

    const thick = combSeeds({ ...flatEv, floor: 70 }, combPoints, 2);
    assert.ok(thick.every(s => s.reflectorNm === 70), 'twice a floor past the quarter wave is not tried');
    assert.ok(sides(thick)[1].length > 0, 'a floor past the quarter wave (66.7 nm in C) is still tried once');

    const free = combSeeds({ ...flatEv, floor: 0 }, combPoints, 2);
    const qw = (4000 / 7.5) / (4 * 1.5);
    const [freeHi] = sides(free);
    const tFree = [...new Set(freeHi.map(s => s.reflectorNm))];
    assert.deepEqual(tFree, [qw / 5, (qw / 5) * 2], 'without a floor a quarter wave / 5 (divided, as the C does), then twice that');

    for (const floor of [0, 20, 500, 1200]) {
        const s = combSeeds({ ...flatEv, floor }, combPoints, 2);
        assert.ok(s.every(x => x.dc >= floor), `floor ${floor}: no cavity thinner than the floor`);
    }

    const ev = fixture('bandpass');
    const { points, passRuns: runs } = combApplies(ev);
    const real = combSeeds(ev, points, runs);
    checkFamilies(real, 'bandpass');
    assert.equal(real[0].cavity, 'TiO2', 'bandpass: TiO2 cavities first');
    assert.ok(real.length >= 6 && real.length <= 48, `bandpass: ${real.length} seeds`);
}

// ── 5. Seed layout ───────────────────────────────────────────────────────────
{
    const seed = { cavity: 'TiO2', reflector: 'SiO2', count: 3, ends: false, reflectorNm: 20, dc: 600 };
    const plain = buildSeed(seed);
    assert.deepEqual(plain.map(l => l.material), ['TiO2', 'SiO2', 'TiO2', 'SiO2', 'TiO2']);
    assert.deepEqual(plain.map(l => l.thickness), [600, 20, 600, 20, 600]);
    const ended = buildSeed({ ...seed, ends: true });
    assert.deepEqual(ended.map(l => l.material), ['SiO2', 'TiO2', 'SiO2', 'TiO2', 'SiO2', 'TiO2', 'SiO2']);
    assert.ok(ended.every(l => Object.keys(l).length === 2), 'layers carry material and thickness only');
    ended[0].thickness = 1;
    assert.equal(ended[2].thickness, 20, 'every reflector is its own object');
}

// ── 6. runComb on the bandpass ───────────────────────────────────────────────
// A serial runner: a fresh evaluator per job, as a worker builds one, and every job
// through a structured clone, as a worker would receive and return it. The seeds
// carry no preparation, so a rung job is the refinement alone. `jobs` keeps what
// went in and came back, in order.
function serialRunner(jobs) {
    const fresh = ev => makeEvaluator(ev.spec, { materials: ev.materials });
    const send = (items, body) => structuredClone(structuredClone(items).map(body));
    const kept = (list, out) => { list.push(...out); return out; };
    return {
        threads: 1,
        rung: async (ev, items, upto) => kept(jobs.rung, send(items, it => fresh(ev).refinePart(it, upto))),
        child: async (ev, items) => {
            jobs.childIn.push(...items);
            return kept(jobs.child, send(items, it => growSeed(fresh(ev), it.layers)));
        },
    };
}
// The bandpass at three points per band, so that the 48 seeds refine and grow in a second.
const coarseBandpass = over => evaluatorFor(caseOps('bandpass').map(op => ({ ...op, rampPoints: 3 })), over);
async function combRun(ev, shouldStop = () => false) {
    const jobs = { rung: [], childIn: [], child: [] };
    const run = { runner: serialRunner(jobs), log: { trace: makeTrace(), keep: null }, shouldStop, onEvent: () => {} };
    const out = await runComb(ev, run);
    return { out, jobs, trace: run.log.trace };
}
const bestOf = mfs => Math.min(...mfs);
const byRefined = rung => (i, j) => (rung[i].part.mf - rung[j].part.mf) || i - j;

function checkJobs({ out, jobs, trace }) {
    assert.equal(out.why, null, 'the comb ran');
    assert.ok(out.seeds >= 6 && out.distinct >= 1 && out.distinct <= out.seeds, `${out.seeds} seeds, ${out.distinct} distinct`);
    assert.equal(jobs.rung.length, out.seeds, 'every seed refined once');
    assert.ok(jobs.rung.every(it => it.part.done), 'every seed refined to the end');
    assert.equal(jobs.childIn.length, out.distinct, 'every distinct seed grown once');
    const seedOf = jobs.childIn.map(it => jobs.rung.findIndex(r => sameBits(r.layers, it.layers)));
    assert.ok(seedOf.every(i => i >= 0), 'the grown designs are refined seeds');
    assert.deepEqual(seedOf, seedOf.slice().sort(byRefined(jobs.rung)), 'grown best refined first, ties to the earlier seed');
    const refinedPts = jobs.rung.map(it => ({ mf: it.part.mf, n: it.layers.length }));
    assert.deepEqual(trace.points.slice(0, out.seeds), refinedPts, 'refined seeds on the trace in seed order');
    assert.deepEqual(trace.points.slice(out.seeds), jobs.child.flatMap(g => g.points), 'growth traces in rank order');
}

function checkResult({ out, jobs, trace }, ev) {
    const cap = ev.maxLayers;
    assert.equal(out.ev, ev, 'no regrid: the same evaluator');
    assert.ok(out.kept, 'a design within the cap is kept');
    assert.ok(out.kept.layers.length <= cap, `kept design has ${out.kept.layers.length} layers, cap ${cap}`);
    assert.ok(Number.isFinite(out.kept.mf), 'kept merit finite');
    assert.equal(out.kept.mf, bestOf(trace.points.filter(p => p.n <= cap).map(p => p.mf)), 'kept: the best on the trace within the cap');
    assert.ok(Math.abs(ev.mf(out.kept.layers) - out.kept.mf) <= 1e-9 * out.kept.mf, 'kept merit is the design\'s');
    assert.ok(out.kept.layers.every(l => l.thickness >= ev.dMin * (1 - 1e-9)), 'kept layers at or above the floor');
    const first = jobs.child.findIndex(g => g.mf === bestOf(jobs.child.map(c => c.mf)));
    assert.ok(out.grown && sameBits(out.grown.layers, jobs.child[first].layers), 'grown: the best growth, ties to the earlier run');
    assert.equal(out.grown.mf, jobs.child[first].mf);
    const reasons = new Set(['maxLayers', 'enough', 'optimal', 'noGain']);
    assert.ok(jobs.child.every(g => reasons.has(g.reason)), 'every growth ends with a needle reason');
    assert.ok(jobs.child.every(g => g.kept === null || g.kept.layers.length <= cap), 'every growth keeps within the cap');
}

{
    const ev = coarseBandpass({ maxLayers: 9, refine: { maxIter: 6, plateau: 6, plateauGain: 1e-4 } });
    const t0 = Date.now();
    const a = await combRun(ev);
    const ms = Date.now() - t0;
    checkJobs(a);
    checkResult(a, ev);

    const { out } = a;
    const bare = ev.mf([]);
    const single = ev.refine([{ material: 'SiO2', thickness: 100 }]).mf;
    assert.ok(out.kept.mf < bare, `comb ${out.kept.mf.toFixed(4)} below the bare substrate ${bare.toFixed(4)}`);
    assert.ok(out.kept.mf < single, `comb ${out.kept.mf.toFixed(4)} below one refined layer ${single.toFixed(4)}`);

    const b = await combRun(ev);
    assert.ok(sameBits(b.out.kept.layers, out.kept.layers), 'same kept design twice');
    assert.equal(b.out.kept.mf, out.kept.mf, 'same merit twice');
    assert.ok(sameBits(b.out.grown.layers, out.grown.layers), 'same grown design twice');
    assert.deepEqual(b.trace.points, a.trace.points, 'same trace twice');
    console.log(`bandpass comb: ${out.seeds} seeds, ${out.distinct} distinct, kept ${(100 * out.kept.mf).toFixed(2)}% `
        + `at ${out.kept.layers.length} layers (bare ${(100 * bare).toFixed(2)}%, one layer ${(100 * single).toFixed(2)}%), `
        + `${ms} ms`);
}

// ── 7. Distinct seeds and rank order, on a synthetic runner ──────────────────
// Seed i refines to one of five two-layer designs (i % 5); the repeats are a
// hair off in thickness and merit, so only the same-design tolerances make them
// one. Seeds 1 and 3 tie on merit. The growths tie on merit at ranks 1 and 2.
const refinedMf = [0.3, 0.1, 0.2, 0.1, 0.4];
const grownMf = [0.05, 0.02, 0.02, 0.3, 0.2];
function refinedSeed(it, i, upto) {
    const k = i % 5, off = i >= 5 ? 1 + 1e-12 : 1;
    const layers = [{ material: 'TiO2', thickness: (100 + k) * off }, { material: 'SiO2', thickness: 50 }];
    return { ...it, layers, part: { iters: upto, state: null, done: true, mf: refinedMf[k] * off, void: false } };
}
function grownSeed(it, j) {
    const layers = [...it.layers, { material: 'TiO2', thickness: 10 + j }];
    const mf = grownMf[j];
    return { layers, mf, reason: 'noGain', points: [{ mf, n: 3 }], kept: j === 4 ? null : { layers, mf } };
}
// child(ev, items): the runner's growth batch. keep: the caller's keeper, or null.
const syntheticRun = (child, keep = null) => ({
    runner: { threads: 1, rung: async (_, items, upto) => items.map((it, i) => refinedSeed(it, i, upto)), child },
    log: { trace: makeTrace(), keep }, shouldStop: () => false, onEvent: () => {},
});
{
    const ev = fixture('bandpass', { maxLayers: 3 });
    const childIn = [];
    const run = syntheticRun(async (_, items) => { childIn.push(...items); return items.map(grownSeed); });
    const out = await runComb(ev, run);
    assert.ok(out.seeds >= 6, `${out.seeds} seeds`);
    assert.equal(out.distinct, 5, 'repeats within the same-design tolerances are one design');
    assert.deepEqual(childIn.map(it => it.layers[0].thickness), [101, 103, 102, 100, 104],
        'grown by refined merit, ties to the earlier seed');
    const pts = run.log.trace.points;
    assert.equal(pts.length, out.seeds + 5, 'every refined seed and every growth on the trace');
    assert.ok(pts.slice(0, out.seeds).every((p, i) => p.n === 2 && p.mf === refinedMf[i % 5] * (i >= 5 ? 1 + 1e-12 : 1)),
        'refined seeds in seed order');
    assert.deepEqual(pts.slice(out.seeds).map(p => p.mf), grownMf, 'growth traces in rank order');
    assert.deepEqual([out.grown.mf, out.grown.layers[2].thickness], [0.02, 11], 'best growth, ties to the earlier run');
    assert.deepEqual([out.kept.mf, out.kept.layers[2].thickness], [0.02, 11], 'kept: the best within the cap, the earlier on a tie');
}
// With a keeper of the caller's (giga4.c 533-535) the comb keeps its designs
// there, so a growth batch that does not come back (Stop terminates the pool)
// leaves the best refined seed within the cap with the caller.
{
    const ev = fixture('bandpass', { maxLayers: 3 });
    const keep = makeKeeper(3);
    const out = await runComb(ev, syntheticRun(async (_, items) => items.map(grownSeed), keep));
    assert.deepEqual(out.kept, { layers: keep.layers, mf: keep.mf }, "kept: the caller's keeper");
    assert.deepEqual([keep.mf, keep.layers[2].thickness], [0.02, 11], 'the best growth within the cap');

    const lost = new Error('pool terminated');
    const keptBefore = makeKeeper(3);
    await assert.rejects(runComb(ev, syntheticRun(async () => { throw lost; }, keptBefore)), lost,
        'a lost growth batch fails the comb');
    assert.deepEqual([keptBefore.mf, keptBefore.layers[0].thickness], [0.1, 101],
        "the best refined seed stays in the caller's keeper, ties to the earlier seed");
}

// ── 8. Off, no period, and stopped ───────────────────────────────────────────
async function checkNoWork(ev, why, label) {
    const r = await combRun(ev);
    assert.equal(r.out.why, why, `${label}: ${why}`);
    assert.deepEqual([r.out.kept, r.out.grown], [null, null], `${label}: no design`);
    assert.deepEqual([r.jobs.rung.length, r.jobs.child.length], [0, 0], `${label}: no job sent`);
    assert.equal(r.trace.points.length, 0, `${label}: nothing recorded`);
    return r.out;
}
{
    await checkNoWork(fixture('bbar'), 'passRuns', 'bbar');
    await checkNoWork(fixture('bs'), 'notPassStop', 'bs');
    // A 2000 nm floor makes the reflectors thicker than any comb period the target allows.
    const tooThick = await checkNoWork(fixture('bandpass', { dMin: 2000 }), 'noPeriod', 'bandpass at a 2000 nm floor');
    assert.equal(tooThick.seeds, 0);

    const ev = coarseBandpass({ maxLayers: 9, refine: { maxIter: 3, plateau: 6, plateauGain: 1e-4 } });
    const early = await combRun(ev, () => true);
    assert.equal(early.out.why, 'stopped', 'stopped before any refinement');
    assert.deepEqual([early.jobs.rung.length, early.jobs.child.length], [0, 0], 'stopped: no job sent');

    let calls = 0;
    const late = await combRun(ev, () => calls++ > 0);
    assert.equal(late.out.why, 'stopped', 'stopped after the seeds were refined');
    assert.equal(late.jobs.child.length, 0, 'no growth after the stop');
    assert.ok(late.jobs.rung.length > 0 && late.out.distinct > 0, 'the seeds were refined');
    assert.ok(late.out.kept && late.out.kept.layers.length <= 9, 'the best refined seed within the cap is kept');
}

console.log('deep_synthesis_comb: all checks passed');
