/**
 * Structural Optimizer proposals.
 *
 *   1. A refined proposal that comes back to the current design (same materials
 *      in order, every thickness within 0.5 nm) is not a candidate, and a batch
 *      of only such proposals gives none, which is not an accepted move. When
 *      one comes back lower, the current design takes it without counting a
 *      move.
 *   2. The slots after the needles take random mutations of every enabled kind,
 *      add and split included.
 *   3. At a Min thickness the needle scan offers no split whose halves are
 *      under it.
 *   4. A Deep search kick never leaves the stack without a free layer, and a
 *      random split inserts a layer no thicker than Max added.
 *   5. CG stops at once when no layer is free.
 *
 * Run: node tests/structural_proposals.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const {
    generateProposals, needleProposals, refineProposals, acceptProposal,
} = await import('../src/components/windows/optimization/structuralOptimizer/runners/proposals.js');
const { isCurrentDesign } = await import(
    '../src/components/windows/optimization/structuralOptimizer/runners/sameDesign.js');
const { makeRng, basinKick, proposeMutation, MUTATION_KINDS } = await import('../src/utils/synthesis/structuralOptimizer.js');
const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getCatalogs } = await import('../src/utils/materials/catalogManager.js');
const { getPoolMaterials, serializableMedia, densifyForRun } = await import(
    '../src/components/windows/optimization/synthesisShared/synthesisHelpers.js');
const { CGOptimizer } = await import('../src/utils/optimizers/cg.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');

const layer = (material, thickness, locked = false) => ({ id: `${material}-${thickness}`, material, thickness, locked });

// ── 1. Proposals that refine back to the current design ────────────────────────
{
    const cur = [layer('SiO2', 90), layer('TiO2', 50)];
    const S = { layerKey: 'frontLayers', cfg: { dMin: 1 }, current: { frontLayers: cur } };
    const same = front => isCurrentDesign(S, { frontLayers: front });
    assert.ok(same([layer('SiO2', 90.3), layer('TiO2', 49.8)]), 'every thickness within 0.5 nm is the current design');
    assert.ok(!same([layer('SiO2', 91), layer('TiO2', 50)]), 'a layer 1 nm away is a different design');
    assert.ok(!same([layer('SiO2', 90), layer('Ta2O5', 50)]), 'another material is a different design');
    assert.ok(same([layer('SiO2', 90), layer('TiO2', 0.4), layer('TiO2', 50)]),
        'a needle that collapsed into its neighbour leaves the current design');
    assert.ok(!same([layer('SiO2', 90), layer('TiO2', 50), layer('SiO2', 40)]), 'an extra layer is a different design');
    const untidy = { ...S, current: { frontLayers: [layer('SiO2', 40), layer('SiO2', 50), layer('TiO2', 50)] } };
    assert.ok(isCurrentDesign(untidy, { frontLayers: [layer('SiO2', 90.2), layer('TiO2', 50)] }),
        'a starting design with two touching layers of one material compares as one layer');
}

// Workers that answer each refine with a scripted result.
class ScriptedWorker {
    constructor(result) { this.result = result; this.onmessage = null; }
    postMessage() {
        setTimeout(() => this.onmessage?.({ data: {
            type: 'done', mfBest: this.result.mf, omfBest: this.result.mf,
            bestFrontLayers: this.result.frontLayers, bestBackLayers: [],
        } }), 0);
    }
    terminate() {}
}

function scriptedRun(results) {
    const ctx = {
        runningRef: { current: true }, runIdRef: { current: 1 },
        workersRef: { current: results.map(r => new ScriptedWorker(r)) },
        setStatusMsg: () => {}, setMf: () => {}, setOmf: () => {},
    };
    const cur = [layer('SiO2', 90)];
    const S = {
        runId: 1, layerKey: 'frontLayers', otherKey: 'backLayers', surfaceMode: 'front_only', media: {},
        structEngine: 'cg', operands: [], materials: {}, wasmBytes: null,
        cfg: { dMin: 1, dMax: Infinity, refineIter: 5 }, lastTick: 0,
        current: { mf: 0.03, frontLayers: cur, backLayers: [] },
        best: { mf: 0.03 }, attempts: 0, accepts: 0, noImprove: 0, rng: makeRng(1),
        ts: { statusRefining: n => `refining ${n}` },
    };
    const proposals = results.map(() => ({ layers: cur, mutation: { kind: 'perturb' } }));
    return { ctx, S, proposals };
}

{
    const back = { mf: 0.0299, frontLayers: [layer('SiO2', 90.2)] };
    const moved = { mf: 0.04, frontLayers: [layer('SiO2', 90), layer('TiO2', 40)] };
    const mixed = scriptedRun([back, moved, back]);
    const { best, polish } = await refineProposals(mixed.ctx, mixed.S, mixed.proposals);
    assert.equal(best.result.frontLayers.length, 2,
        'the real change goes to the accept test, even when a proposal that came back scores lower');
    assert.equal(polish.result.mf, 0.0299, 'and the one that came back is kept apart');

    const same = { mf: 0.03, frontLayers: [layer('SiO2', 90.1)] };
    const stuck = scriptedRun([same, same, same]);
    const batch = await refineProposals(stuck.ctx, stuck.S, stuck.proposals);
    assert.equal(batch.best, null, 'a batch that only came back to the current design gives no candidate');
    acceptProposal(stuck.ctx, stuck.S, batch, 0.1, () => { throw new Error('not a new best'); });
    assert.deepEqual([stuck.S.attempts, stuck.S.accepts, stuck.S.noImprove], [0, 0, 1],
        'and counts as an iteration without improvement, not as an accepted move');

    const polished = scriptedRun([back, back]);
    polished.S.noImprove = 5;
    const rows = [];
    const refined = await refineProposals(polished.ctx, polished.S, polished.proposals);
    acceptProposal(polished.ctx, polished.S, refined, 0.1, (ctx, S, candidate) => {
        rows.push(candidate.mf);
        S.noImprove = 0;
        return false;
    });
    assert.equal(polished.S.current.mf, 0.0299, 'a result that came back lower becomes the current design');
    assert.deepEqual(rows, [0.0299], 'and the new best');
    assert.deepEqual([polished.S.attempts, polished.S.noImprove], [0, 6],
        'without counting a move or restarting the count of iterations without improvement');
}

// ── 2 and 3. Proposals from a real design at a 40 nm floor ─────────────────────
const bbar = caseById('bbar');
const builtin = getCatalogs().find(c => c.id === 'builtin');
const excluded = new Set(Object.keys(builtin.materials).filter(k => k !== 'TiO2' && k !== 'SiO2'));

function runState(frontLayers, { dMin, seed = 1, workerCount = 8 }) {
    const design = { ...bbar.thin(), frontLayers, backLayers: [] };
    const operands = densifyForRun(bbar.ops.map((op, i) => ({ ...op, id: op.id || `op${i}`, enabled: true })), design);
    const pool = getPoolMaterials(new Set(['builtin']), { excluded, design });
    return {
        current: { frontLayers, backLayers: [] }, layerKey: 'frontLayers', otherKey: 'backLayers', side: 'front',
        kinds: MUTATION_KINDS.slice(), workerCount, pool, poolLite: pool.map(m => ({ id: m.id, name: m.name })),
        cfg: { dMin, dMax: Infinity, maxLayers: 80, addMaxNm: 120, jitterPct: 0.15 },
        rng: makeRng(seed), media: serializableMedia(design), operands, curDes: design,
        ts: { statusCap: 'cap', statusNoMut: 'none' },
    };
}

{
    let randomGrowth = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
        const S = runState([layer('SiO2', 90)], { dMin: 40, seed });
        const needles = needleProposals(S, S.current, Math.ceil(S.workerCount / 2)).length;
        const { proposals } = generateProposals(S);
        assert.equal(proposals.length, S.workerCount, 'every slot holds a proposal');
        randomGrowth += proposals.slice(needles)
            .filter(p => p.mutation.kind === 'add' || p.mutation.kind === 'split').length;
    }
    assert.ok(randomGrowth > 0, `random add and split fill slots after the needles (${randomGrowth} over 5 batches)`);
}

{
    const dMin = 40;
    const S = runState([layer('SiO2', 180), layer('TiO2', 100)], { dMin });
    const proposals = needleProposals(S, S.current, 16);
    const splits = proposals.filter(p => p.mutation.kind === 'split');
    assert.ok(splits.length > 0, `the scan offers splits here (${splits.length} of ${proposals.length})`);
    const thin = proposals.flatMap(p => p.layers).filter(l => l.thickness < dMin - 1e-9);
    assert.equal(thin.length, 0,
        `no proposal has a layer under ${dMin} nm (${thin.map(l => l.thickness.toFixed(1)).join(', ')})`);
}

// ── 4. Deep search kicks ───────────────────────────────────────────────────────
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const only = basinKick([layer('SiO2', 90)], { rng: makeRng(seed), pool: [], kinds: ['remove'], dMin: 1 });
    assert.equal(only.length, 1, 'a kick does not remove the only layer');
    const withLocked = basinKick([layer('TiO2', 20, true), layer('SiO2', 90)],
        { rng: makeRng(seed), pool: [], kinds: ['remove'], dMin: 1 });
    assert.ok(withLocked.some(l => !l.locked), 'a kick leaves a free layer next to a locked one');
}

// A random split inserts a layer no thicker than Max added, as a random add does.
{
    let thickest = 0;
    for (let seed = 1; seed <= 200; seed++) {
        const { mutation } = proposeMutation([layer('SiO2', 400)], {
            rng: makeRng(seed), pool: [{ id: 'TiO2' }], kinds: ['split'], dMin: 40, addMaxNm: 120,
        });
        thickest = Math.max(thickest, mutation.thickness);
    }
    assert.ok(thickest <= 120 && thickest > 110, `a split's inserted layer stays within Max added (${thickest.toFixed(1)} nm)`);
}

// ── 5. CG with nothing to move ─────────────────────────────────────────────────
{
    const design = { ...bbar.thin() };
    design.frontLayers = design.frontLayers.map(l => ({ ...l, locked: true }));
    for (const persistent of [false, true]) {
        const cg = new CGOptimizer(bbar.ops, design, id => getMaterial(id), { maxIter: 30, persistent });
        assert.ok(cg.isConverged(), `CG (${persistent ? 'persistent' : 'synthesis'}) is converged with every layer locked`);
    }
}

console.log('All Structural proposal tests passed.');
