/**
 * Deep Synthesis needle helpers (needleHelpers.js with needleScan.js,
 * needleInsert.js and needleProbe.js, a port of needle.c and giga4.c
 * floor_bound). design.js, trace.js and evaluator.js are tested in
 * deep_synthesis_evaluator.mjs.
 *
 *   1. depthMinima against a brute-force check on synthetic values, with a
 *      minimum on a gap between two layers, ties, +Infinity positions and the
 *      material-then-depth order.
 *   2. intraCount: lambda_min / 32 spacing at the densest material, the 3 and
 *      8192 clamps, the window's thickest layer with fit, none without room.
 *   3. applyNeedle and applyPair geometry: split fractions from the incident
 *      side, the pair's layer order and spacer material at a gap, at the
 *      substrate end and inside a layer, on the front side and on a back side
 *      stack of three materials (index 0 at the substrate); pairOpts.
 *   4. floorHeld: the tolerance, largest gradient first, ties to the lower
 *      index; nothing without a floor.
 *   5. goldenMinimum and bestThickness on a known merit: the bracket from the
 *      floor or from 1 nm, the cap, and null when nothing beats mf0.
 *   6. scanWindow on BBAR: the window equals the full scan filtered by
 *      position, no gap candidate of a neighbour's material, splits respect
 *      the floor, only gaps with fit and room 1, nothing with room 0.
 *   7. Depth minima and the pair on a converged three-layer BBAR design at a
 *      20 nm floor: insertOptimal falls back to the floor, refinement never
 *      raises the merit of a needle or pair design and keeps the floor, the
 *      best needle and the best pair gain; without a floor a needle at every
 *      minimum gains at its best thickness.
 *   8. probeNeedleRun from one SiO2 layer on BBAR: without a floor it lowers
 *      the merit at every insertion and stops at the layer cap, the same
 *      twice; at a 20 nm floor it stalls with no gain; Stop and the target.
 *
 * Run: node tests/deep_synthesis_needle.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const N = await import('../src/utils/synthesis/deepSynthesis/needleHelpers.js');
const { makeTrace, makeKeeper } = await import('../src/utils/synthesis/deepSynthesis/trace.js');
const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { presampleSynthesisMaterials } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');
const { makeEngine } = await import('../src/utils/optimizers/index.js');
const { DLSOptimizer } = await import('../src/utils/physics/optimizer.js');
const { makeEvaluator } = await import('../src/utils/synthesis/deepSynthesis/evaluator.js');

const base = { surfaceMode: 'front_only', mfEvalMode: 'side', incidentMedium: 'Air', exitMedium: 'Air',
               substrate: { material: 'BK7', thickness: 1 } };
const pool = ['TiO2', 'SiO2'];
function fixture(caseId, over = {}) {
    const operands = caseById(caseId).ops.map(op => ({ ...op, enabled: true }));
    const design = { ...base, frontLayers: [], backLayers: [] };
    const materials = presampleSynthesisMaterials(design, operands, pool.map(id => ({ id, mat: getMaterial(id) })));
    const spec = { operands, base, side: 'front', otherLayers: [], pool, dMin: 20, dMax: Infinity, maxLayers: 8,
                   engine: ENGINE, refine: { maxIter: 60, plateau: 6, plateauGain: 1e-4 }, targetMf: 1e-4, ...over };
    return makeEvaluator(spec, { materials });
}
const probe = makeEngine('trust-region', caseById('bbar').ops, caseById('bbar').thin(), getMaterial, {});
assert.notEqual(probe.constructor, DLSOptimizer, "makeEngine('trust-region') is registered");
const ENGINE = 'trust-region';

const L = (material, thickness) => ({ material, thickness });
const inWindow = (c, k0, k1) => (c.layer >= 0 ? c.layer >= k0 && c.layer < k1 : c.pos >= k0 && c.pos <= k1);
const minThickness = layers => Math.min(...layers.map(l => l.thickness));

// ── 1. depthMinima on synthetic values ────────────────────────────────────────
{
    // Brute force from the definition: v[i] < -tiny, strictly below the
    // position above, no higher than the one below.
    const brute = (v, tiny) => v.flatMap((x, i) =>
        (x < -tiny && (i === 0 || x < v[i - 1]) && (i === v.length - 1 || x <= v[i + 1])) ? [i] : []);
    const nLayers = 2, nIntra = 3, M = (nLayers + 1) + nLayers * nIntra;   // 9
    const I = Infinity;
    const values = {
        // gap 1 (i = 4) is the lowest point between the two layers' interiors
        H: [-1, -2, -3, -2, -5, -4, I, -4, -1],
        // ties (i = 1, 2 and 6, 7): only the upper of two equal points is a
        // minimum; +Infinity below gap 1 (i = 5) does not stop it being one
        L: [0, -3, -3, -1, -2, I, -6, -6, -7],
    };
    const tiny = 1e-9;
    const got = N.depthMinima({ materials: ['H', 'L'], nLayers, nIntra, value: (m, i) => values[m][i], tiny });
    const want = ['H', 'L'].flatMap(m => brute(values[m], tiny).map(i => ({ m, i })));
    assert.equal(got.length, want.length, 'depthMinima finds exactly the brute-force minima');
    got.forEach((c, n) => {
        const { m, i } = want[n];
        const k = Math.floor(i / (nIntra + 1)), r = i % (nIntra + 1);
        assert.equal(c.material, m, 'material order, then depth order');
        assert.equal(c.P, values[m][i]);
        if (r === 0) assert.deepEqual([c.pos, c.layer, c.frac], [k, -1, 0], `gap ${k} maps back to a gap`);
        else assert.deepEqual([c.pos, c.layer, c.frac], [-1, k, r / (nIntra + 1)], `point ${r} of layer ${k}`);
    });
    assert.ok(got.some(c => c.material === 'H' && c.pos === 1), 'a minimum on the gap between the two layers is kept');
    assert.deepEqual(got.filter(c => c.material === 'H').map(c => c.layer >= 0 ? `s${c.layer}` : `g${c.pos}`),
        ['s0', 'g1', 's1'], 'H: the lowest points of layer 0, gap 1 and layer 1');
    assert.deepEqual(got.filter(c => c.material === 'L').map(c => c.layer >= 0 ? `s${c.layer}` : `g${c.pos}`),
        ['s0', 'g1', 's1', 'g2'], 'L: the upper of two equal points; the last point needs no lower neighbour');
    assert.equal(N.depthMinima({ materials: ['H'], nLayers, nIntra, value: () => -1e-12, tiny: 1e-9 }).length, 0,
        'values above -tiny are rounding');

    // Random arrays against the brute force.
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let t = 0; t < 200; t++) {
        const nl = 1 + Math.floor(rnd() * 4), ni = Math.floor(rnd() * 4), m = (nl + 1) + nl * ni;
        const v = Array.from({ length: m }, () => (rnd() < 0.15 ? Infinity : Math.round((rnd() - 0.6) * 6)));
        const out = N.depthMinima({ materials: ['X'], nLayers: nl, nIntra: ni, value: (_, i) => v[i], tiny: 0 });
        const idx = out.map(c => (c.layer >= 0 ? c.layer * (ni + 1) + Math.round(c.frac * (ni + 1)) : c.pos * (ni + 1)));
        assert.deepEqual(idx, brute(v, 0), `random case ${t}`);
    }
}

// ── 2. intraCount ─────────────────────────────────────────────────────────────
{
    const fake = { pool: ['H', 'L'], lamMin: 400, n: id => (id === 'H' ? 2 : 1.5) };
    // spacing lambda_min / 32 = 12.5 nm of optical thickness at n = 2
    assert.equal(N.intraCount(fake, [L('L', 100)]), 16, '200 nm optical over 12.5 nm');
    assert.equal(N.intraCount(fake, [L('L', 1)]), 3, 'at least 3');
    assert.equal(N.intraCount(fake, [L('L', 1e7)]), 8192, 'at most 8192');
    assert.equal(N.intraCount(fake, []), 0, 'none on the empty design');
    const two = [L('H', 100), L('L', 10)];
    assert.equal(N.intraCount(fake, two, { k0: 1, k1: 2 }), 16, 'without fit the design\'s thickest layer');
    assert.equal(N.intraCount(fake, two, { k0: 1, k1: 2, fit: true, room: 2 }), 3, 'with fit the window\'s');
    assert.equal(N.intraCount(fake, two, { fit: true, room: 1 }), 0, 'no split without room for two layers');
    assert.equal(N.intraCount({ ...fake, n: () => 0.5 }, [L('L', 100)]), 8, 'the index is at least 1');
}

// ── 3. applyNeedle and applyPair geometry ────────────────────────────────────
{
    const S = [L('H', 10), L('L', 100), L('H', 30)];
    assert.deepEqual(N.applyNeedle(S, { pos: 1, layer: -1, frac: 0, material: 'M' }, 5),
        [L('H', 10), L('M', 5), L('L', 100), L('H', 30)], 'a gap needle becomes layer pos');
    assert.deepEqual(N.applyNeedle(S, { pos: -1, layer: 1, frac: 0.25, material: 'H' }, 5),
        [L('H', 10), L('L', 25), L('H', 5), L('L', 75), L('H', 30)], 'a split leaves frac * d on the incident side');
    assert.deepEqual(S, [L('H', 10), L('L', 100), L('H', 30)], 'the input is not changed');

    const f = 20, s = 30, front = { floorNm: f };
    assert.deepEqual(N.applyPair(S, { pos: 1, layer: -1, frac: 0, material: 'M' }, s, front),
        [L('H', 10), L('M', f), L('L', s), L('M', f), L('L', 100), L('H', 30)],
        'at a gap the spacer is the layer on the substrate side');
    assert.deepEqual(N.applyPair(S, { pos: 0, layer: -1, frac: 0, material: 'M' }, s, front),
        [L('M', f), L('H', s), L('M', f), L('H', 10), L('L', 100), L('H', 30)], 'at the incident end');
    assert.deepEqual(N.applyPair(S, { pos: 3, layer: -1, frac: 0, material: 'L' }, s, front),
        [L('H', 10), L('L', 100), L('H', 30), L('L', f), L('H', s), L('L', f)],
        'at the substrate end the spacer is the layer above');
    assert.deepEqual(N.applyPair(S, { pos: -1, layer: 1, frac: 0.5, material: 'H' }, s, front),
        [L('H', 10), L('L', 50), L('H', f), L('L', s), L('H', f), L('L', 50), L('H', 30)],
        'inside a layer the spacer is the host');
    assert.equal(N.applyPair([], { pos: 0, layer: -1, frac: 0, material: 'H' }, s, front), null,
        'no pair on the empty design');

    // A back side stack of three materials in backLayers order, index 0 at the
    // substrate: the substrate side of gap pos is layer pos - 1, and gap 0 is
    // the substrate end.
    const B = [L('H', 10), L('L', 100), L('M', 30)];
    const back = { floorNm: f, substrateAt0: true };
    assert.deepEqual(N.applyPair(B, { pos: 2, layer: -1, frac: 0, material: 'H' }, s, back),
        [L('H', 10), L('L', 100), L('H', f), L('L', s), L('H', f), L('M', 30)],
        'back side: at a gap the spacer is the layer on the substrate side');
    assert.deepEqual(N.applyPair(B, { pos: 2, layer: -1, frac: 0, material: 'H' }, s, front),
        [L('H', 10), L('L', 100), L('H', f), L('M', s), L('H', f), L('M', 30)],
        'the same gap on the front side takes the other neighbour');
    assert.deepEqual(N.applyPair(B, { pos: 0, layer: -1, frac: 0, material: 'M' }, s, back),
        [L('M', f), L('H', s), L('M', f), ...B], 'back side: at the substrate end the spacer is the layer above');
    assert.deepEqual(N.applyPair(B, { pos: 3, layer: -1, frac: 0, material: 'H' }, s, back),
        [...B, L('H', f), L('M', s), L('H', f)], 'back side: at the incident end the spacer is the outer layer');
    assert.deepEqual(N.applyPair(B, { pos: -1, layer: 1, frac: 0.5, material: 'M' }, s, back),
        [L('H', 10), L('L', 50), L('M', f), L('L', s), L('M', f), L('L', 50), L('M', 30)],
        'back side: inside a layer the spacer is the host');
    assert.deepEqual(N.pairOpts({ floor: 20, side: 'front' }), { floorNm: 20, substrateAt0: false }, 'pairOpts, front');
    assert.deepEqual(N.pairOpts({ floor: 20, side: 'back' }), { floorNm: 20, substrateAt0: true }, 'pairOpts, back');
}

// ── 4. floorHeld ──────────────────────────────────────────────────────────────
{
    const g = [0.1, 0.5, 0.3, 0.9, 0.3, -2];
    const fake = { floor: 20, grad: () => g };
    const layers = [L('H', 20), L('L', 50), L('H', 20 * (1 + 5e-10)), L('L', 20 * (1 + 2e-9)), L('H', 19), L('L', 20)];
    assert.deepEqual(N.floorHeld(fake, layers), [2, 4, 0, 5],
        'held within 1e-9 of the floor, the largest dMF/dd first, ties to the lower index');
    assert.deepEqual(N.floorHeld({ ...fake, floor: 0 }, layers), [], 'nothing without a floor');
    assert.deepEqual(N.floorHeld(fake, []), [], 'nothing on the empty design');
}

// ── 5. goldenMinimum and bestThickness on a known merit ──────────────────────
{
    const g = N.goldenMinimum(t => (t - 3.7) ** 2, 0, 10, { t: 0, mf: 13.69 });
    assert.ok(Math.abs(g.t - 3.7) < 5e-3, `golden section finds the parabola's minimum (${g.t})`);

    // Merit of the inserted layer's thickness alone: a parabola about 37 nm.
    const fake = { mf: layers => (layers[1].thickness - 37) ** 2 + 1 };
    const S = [L('H', 50), L('L', 60)];
    const cand = { pos: 1, layer: -1, frac: 0, material: 'M' };
    const noFloor = N.bestThickness(fake, S, cand, { lo: 0, hi: 300, minNew: 1e-3, mf0: 2000 });
    assert.ok(Math.abs(noFloor.thickness - 37) < 0.05 && noFloor.mf < 2000, 'from 1 nm, doubled and narrowed');
    const floored = N.bestThickness(fake, S, cand, { lo: 20, hi: 300, minNew: 1e-3, mf0: 2000 });
    assert.ok(Math.abs(floored.thickness - 37) < 0.05, 'from the floor');
    const capped = N.bestThickness(fake, S, cand, { lo: 20, hi: 30, minNew: 1e-3, mf0: 2000 });
    assert.equal(capped.thickness, 30, 'still falling at the cap: the cap');
    assert.equal(N.bestThickness(fake, S, cand, { lo: 0, hi: 300, minNew: 1e-3, mf0: 0.5 }), null,
        'null when no thickness beats mf0');
    let calls = 0;
    const rising = { mf: () => { calls++; return 5; } };
    assert.equal(N.bestThickness(rising, S, cand, { lo: 0, hi: 300, minNew: 1e-3, mf0: 5 }), null,
        'no gain down to minNew');
    assert.equal(calls, 11, '1 nm halved ten times to below 1e-3 nm');
}

// ── 6. scanWindow on BBAR ─────────────────────────────────────────────────────
const ev = fixture('bbar');
const ev0 = fixture('bbar', { dMin: 0 });
{
    const S = [L('TiO2', 30), L('SiO2', 50), L('TiO2', 100), L('SiO2', 90)];
    const full = N.scanWindow(ev, S, { max: Infinity });
    assert.ok(full.length > 10, `the full scan finds candidates (${full.length})`);
    for (const [k0, k1] of [[1, 3], [0, 1], [2, 4], [4, 4]]) {
        const win = N.scanWindow(ev, S, { k0, k1, max: Infinity });
        assert.deepEqual(win, full.filter(c => inWindow(c, k0, k1)), `window [${k0}, ${k1}] is the full scan filtered`);
        assert.deepEqual(N.scanWindow(ev, S, { k0, k1, max: 3 }), win.slice(0, 3), 'and cut to max after the sort');
    }
    for (let i = 1; i < full.length; i++) assert.ok(full[i - 1].P <= full[i].P, 'most negative P first');
    for (const c of full) {
        assert.ok(c.P < 0, 'only improving candidates');
        if (c.layer >= 0) {
            assert.notEqual(c.material, S[c.layer].material, 'a split is by another material');
            const d = S[c.layer].thickness;
            assert.ok(c.frac * d >= 20 * (1 - 1e-9) && (1 - c.frac) * d >= 20 * (1 - 1e-9), 'both parts at the floor or more');
        } else {
            assert.ok(S[c.pos - 1]?.material !== c.material && S[c.pos]?.material !== c.material,
                'no gap candidate of a neighbour\'s material');
        }
    }
    assert.ok(full.some(c => c.layer >= 0), 'splits of the thick layers are scanned');
    assert.equal(N.scanWindow(ev, S, { max: 5 }).length, 5, 'at most max');

    // With two materials only the outer gaps take a needle: an inner gap has
    // one of each as neighbours.
    const room1 = N.scanWindow(ev, S, { k0: 2, k1: 4, fit: true, room: 1, max: Infinity });
    assert.ok(room1.length > 0 && room1.every(c => c.layer < 0 && inWindow(c, 2, 4)), 'room 1: gaps in the window only');
    assert.deepEqual(N.scanWindow(ev, S, { fit: true, room: 0 }), [], 'room 0: nothing');
    const room2 = N.scanWindow(ev, S, { k0: 2, k1: 4, fit: true, room: 2, max: Infinity });
    assert.ok(room2.some(c => c.layer >= 0) && room2.every(c => inWindow(c, 2, 4)), 'room 2: splits too');

    const minima = N.scanWindow(ev, S, { minima: true, max: Infinity });
    assert.ok(minima.length > 0 && minima.length < full.length, 'the minima are a subset');
    const key = c => `${c.pos}|${c.layer}|${c.frac}|${c.material}`;
    const all = new Map(full.map(c => [key(c), c.P]));
    for (const c of minima) assert.equal(all.get(key(c)), c.P, 'every minimum is an allowed improving position');

    const empty = N.scanWindow(ev, [], { max: Infinity });
    assert.ok(empty.length > 0 && empty.every(c => c.pos === 0 && c.layer === -1), 'the empty design scans its one gap');
}

// ── 7. Depth minima and the pair on a small real design ───────────────────────
// The merit of a design refined from `T`: never above T's own, every layer at
// the floor or more.
function refinedFrom(e, T, what) {
    const inserted = e.mf(T);
    const R = e.refine(T);
    assert.ok(R.mf <= inserted * (1 + 1e-12), `refinement does not raise the merit of the ${what}`);
    assert.ok(R.layers.length === 0 || minThickness(R.layers) >= e.floor * (1 - 1e-9), `the refined ${what} keeps the floor`);
    return R.mf;
}
{
    // A converged three-layer AR at a 20 nm floor: no floor-thick needle
    // lowers its merit before refinement, so insertOptimal places each at the
    // floor, and the pairs are what the lab added them for.
    const start = ev.refine([L('SiO2', 120), L('TiO2', 60), L('SiO2', 150)]);
    const cands = N.scanWindow(ev, start.layers, { minima: true });
    assert.ok(cands.some(c => c.layer >= 0) && cands.some(c => c.layer < 0), 'minima inside layers and on gaps');
    let bestNeedle = Infinity, bestPair = Infinity;
    for (const cand of cands.slice(0, 4)) {
        const fit = N.bestThickness(ev, start.layers, cand,
            { lo: ev.floor, hi: N.thicknessCap(ev, cand.material), minNew: N.MIN_NEW_NM, mf0: start.mf });
        const T = N.insertOptimal(ev, start.layers, cand, start.mf);
        assert.deepEqual(T, N.applyNeedle(start.layers, cand, fit ? fit.thickness : ev.floor),
            'insertOptimal: the best thickness, else the floor');
        bestNeedle = Math.min(bestNeedle, refinedFrom(ev, T, 'needle'));
        for (const s of N.SPACERS) {
            const P = N.applyPair(start.layers, cand, s * ev.floor, N.pairOpts(ev));
            assert.equal(P.length, start.layers.length + (cand.layer >= 0 ? 4 : 3), 'a pair adds three layers, four in a split');
            bestPair = Math.min(bestPair, refinedFrom(ev, P, 'pair'));
        }
    }
    assert.ok(bestNeedle < start.mf, `a needle at a minimum gains after refinement (${bestNeedle} < ${start.mf})`);
    assert.ok(bestPair < start.mf, `a pair at a minimum gains after refinement (${bestPair} < ${start.mf})`);

    // Without a floor a thin needle at a minimum of P < 0 always gains.
    const start0 = ev0.refine([L('SiO2', 120), L('TiO2', 60), L('SiO2', 150)]);
    const cands0 = N.scanWindow(ev0, start0.layers, { minima: true });
    assert.ok(cands0.length > 0, 'minima without a floor');
    for (const cand of cands0.slice(0, 4)) {
        const hi = N.thicknessCap(ev0, cand.material);
        const fit = N.bestThickness(ev0, start0.layers, cand, { lo: 0, hi, minNew: N.MIN_NEW_NM, mf0: start0.mf });
        assert.ok(fit && fit.mf < start0.mf && fit.thickness > 0 && fit.thickness <= hi, 'a thickness in (0, cap] gains');
        const T = N.insertOptimal(ev0, start0.layers, cand, start0.mf);
        assert.equal(ev0.mf(T), fit.mf, 'insertOptimal places it there');
        assert.ok(refinedFrom(ev0, T, 'needle') < start0.mf, 'and refinement keeps the gain');
    }

    // Held layers of a real design, the larger gradient first.
    const S = [L('TiO2', 20), L('SiO2', 90), L('TiO2', 20), L('SiO2', 40)];
    const held = N.floorHeld(ev, S);
    const g = ev.grad(S);
    assert.deepEqual([...held].sort(), [0, 2], 'the floor-thick layers are held');
    assert.ok(g[held[0]] >= g[held[1]], 'the larger gradient first');
}

// ── 8. probeNeedleRun ─────────────────────────────────────────────────────────
{
    // Without a floor (one candidate per scan, needle.c 500) the probes grow.
    const cap = 5;
    const run = () => {
        const log = { trace: makeTrace(), keep: makeKeeper(cap) };
        const out = N.probeNeedleRun(ev0, [L('SiO2', 94)], { tries: 1, maxLayers: cap, log, targetMf: 1e-6 });
        return { out, log };
    };
    const { out, log } = run();
    const first = log.trace.points[0];
    assert.equal(first.n, 1, 'the first point is the refined start');
    assert.ok(out.mf < first.mf, `the cycle lowers the merit (${out.mf} < ${first.mf})`);
    assert.equal(out.reason, 'maxLayers', `it stops at the layer cap (${out.reason})`);
    assert.ok(out.insertions > 0 && out.layers.length >= cap, 'at or past the cap when it stops');
    assert.equal(log.trace.points.length, out.insertions + 1, 'every held design is recorded');
    const mfs = log.trace.points.map(p => p.mf);
    assert.ok(mfs.every((m, i) => i === 0 || m < mfs[i - 1]), 'each insertion lowers the merit');
    const again = run().out;
    assert.deepEqual(again.layers, out.layers, 'the same run gives the same design');
    assert.equal(again.mf, out.mf);

    // At a 20 nm floor one SiO2 layer is where the probe cycle stalls: the
    // floor-thick TiO2 needle refines to a worse design (needle.c 58-67).
    const stall = N.probeNeedleRun(ev, [L('SiO2', 94)],
        { tries: 10, maxLayers: cap, log: { trace: makeTrace(), keep: null }, targetMf: 1e-6 });
    assert.deepEqual([stall.reason, stall.insertions, stall.layers.length], ['noGain', 0, 1], 'no probe gains at the floor');

    const stopped = N.probeNeedleRun(ev0, [L('SiO2', 94)], {
        tries: 1, maxLayers: cap, log: { trace: makeTrace(), keep: null }, targetMf: 1e-6, shouldStop: () => true });
    assert.deepEqual([stopped.reason, stopped.insertions], ['stopped', 0], 'a stop ends the cycle before a scan');
    const target = N.probeNeedleRun(ev0, [L('SiO2', 94)], {
        tries: 1, maxLayers: cap, log: { trace: makeTrace(), keep: null }, targetMf: 0.02 });
    assert.equal(target.reason, 'enough', 'the stop rule ends the cycle once the target is met');
    assert.ok(target.mf <= 0.02, 'at a design within the target');
}

console.log(`All Deep Synthesis needle helper tests passed (engine ${ENGINE}).`);
