/**
 * Synthesis on a design with environments (Needle, Needle Manual, Gradual
 * Evolution, Structural and Deep Synthesis score every environment that is
 * on):
 *
 *   1. The analytic needle function is the slope of the optical merit over
 *      every environment: a needle of material M is, in environment k, the
 *      material k swaps M for, f_k(M) times as thick. It equals a forward
 *      difference of the merit tables' OMF with the needle put in, the
 *      finite-difference scan, and Σ_k f_k·OMF_k·P_k / (N·OMF) of each
 *      environment's own scan; with a factor, a swap, a math row and a cone,
 *      and on each side every surface mode scans.
 *   2. A run fits the rows of the environments that are on, and none when no
 *      environment is on.
 *   3. A merit that counts environment 1 alone (environments 2 and 3 off, or
 *      environment 2 on with a factor and only a row of weight 0) gives the
 *      scans, and seeded Needle, Gradual Evolution, Structural and Deep
 *      Synthesis runs, exactly what the design without environments gives.
 *   4. Each method on a design with environments lowers the total merit
 *      `merit` gives, and reports that total for its answer.
 *   5. Worker inputs: the tables hold a substrate and a swap only another
 *      environment names, so a scan through the synthesis worker's handlers,
 *      and the Design Cleaner's refine in the optimizer worker, give what this
 *      thread gives.
 *   6. Floors: an MNT row is read in every environment it is scored in, at
 *      target / f with the environment's smallest factor; MXT at target / f
 *      with its largest; a row of an environment that is off sets none, and
 *      neither does the factor of a material the layers and the pool lack.
 *   7. Needle Manual's profile in the optimizer worker and the API's
 *      needleProfile score every environment, and Apply's refine lowers the
 *      merit over every environment; Deep Synthesis says its refine is
 *      Gauss-Newton because of the environments; the merit a run re-scores a
 *      design with is the tables' total.
 *
 * Run: node tests/environment_synthesis.mjs
 */
import assert from 'node:assert/strict';
import { initWasmForTest } from './_wasmInit.mjs';
import { shimBrowserGlobals } from './_uiShim.mjs';
import {
    makeOperand, insertNeedle, insertNeedleIntra, scanNeedlesAnalytic, scanNeedlesFD, findOptimalNeedleThickness,
    scanGEInsertions, DLSOptimizer,
} from '../src/utils/physics/optimizer.js';
import { needleScene } from '../src/utils/physics/optimizer/scanners/needleScene.js';
import { designMerits } from '../src/utils/physics/optimizer/environmentStacks.js';
import { evaluateForDisplay } from '../src/utils/physics/meritDisplay.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { environmentDesign, oneEnvironmentDesign } from '../src/utils/environments/environments.js';
import { rowsScoredIn } from '../src/utils/environments/environmentMerit.js';
import { synthesisRows, serializableMedia } from '../src/components/windows/optimization/synthesisShared/synthesisMath.js';
import { synthesisMntFloor } from '../src/components/windows/optimization/synthesisShared/minThickness.js';
import { presampleSynthesisMaterials, meritOf } from '../src/components/windows/optimization/synthesisShared/runGrid.js';
import { applyConstraintBounds } from '../src/utils/structural/setup.js';
import { scoreDesign } from '../src/utils/structural/workerJobs.js';
import { prepareRun as prepareDeep } from '../src/utils/synthesis/deepSynthesis/setup.js';
import { planRun as planDeep } from '../src/utils/synthesis/deepSynthesis/settings.js';
import { makeResolveMat } from '../src/utils/workers/resolveMat.js';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { dispatchSynthesisJob } from '../src/utils/workers/synthesisWorker.js';
import { handleOptimizerMessage } from '../src/utils/workers/optimizerJob.js';

shimBrowserGlobals();
await initWasmForTest();
const api = await import('../src/api/index.js');
const { insertionRefineJob } = await import('../src/components/windows/optimization/needleManual/model.js');

let pass = 0;
const check = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };
const relative = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

const row = (fields, id, env) => ({ ...makeOperand(fields), id, ...(env ? { env } : {}) });
// Single-wavelength rows, so a run's grid and the merit tables' are the same.
const ROWS = [
    row({ type: 'R', lambdaStart: 480, aoi: 0, pol: 'avg', target: 0, weight: 1 }, 'r480'),
    row({ type: 'R', lambdaStart: 560, aoi: 20, pol: 'avg', target: 0, weight: 2 }, 'r560'),
    row({ type: 'R', lambdaStart: 640, aoi: 0, pol: 'avg', target: 0, weight: 1 }, 'r640'),
    row({ type: 'T', lambdaStart: 520, aoi: 0, pol: 'avg', target: 0.99, weight: 1 }, 't520', 'env2'),
    row({ type: 'OPVA', refId: 't520', target: 1, weight: 1 }, 'math'),
    row({ type: 'R', lambdaStart: 600, aoi: 0, pol: 'avg', target: 0, weight: 1 }, 'r600', 'base'),
];
const WATER = { id: 'env2', name: 'Under water on sapphire', incidentMedium: 'H2O', substrate: { material: 'Al2O3' } };
const EDGE = { id: 'env3', name: 'Dome edge', thicknessFactors: { TiO2: 0.9 }, materialSwaps: { SiO2: 'MgF2' } };
const BASE = {
    name: 'Environments', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [24, 32, 110, 92].map((thickness, i) => ({ id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false })),
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side', referenceWavelength: 550,
};
const withEnvironments = (environments, rows = ROWS, extra = {}) => ({
    ...BASE, ...extra, meritOperands: rows, environments: [{ id: 'base' }, ...environments],
});
const DESIGN = withEnvironments([WATER, EDGE]);
const lookup = designMaterialLookup(DESIGN);
const POOL_IDS = ['TiO2', 'SiO2', 'MgF2'];
const POOL = POOL_IDS.map(id => ({ id, name: id, mat: lookup(id) }));

// The merit tables' OMF of `design` over `rows`.
const tableOmf = (design, rows) => evaluateForDisplay(design, rows).omf;

// The design with a needle of `cand` (a scan candidate) `nm` thick put in.
const withNeedle = (design, cand, nm) => (cand.intra
    ? insertNeedleIntra(design, cand, nm, 'front')
    : insertNeedle(design, cand.pos, cand.materialId, nm, 'front'));

// ── 1. The needle function over environments ───────────────────────────────
for (const [label, design] of [['no cone', DESIGN], ['a cone', { ...DESIGN, cone: { enabled: true, halfAngleDeg: 8, distribution: 'uniform', gridPoints: 4 } }]]) {
    const rows = synthesisRows(design, design.meritOperands);
    const args = { operands: rows, design, resolveMat: lookup, candidateMats: POOL, deltaNm: 0.5, nIntra: 3, side: 'front' };
    const analytic = scanNeedlesAnalytic(args);
    await check(`with ${label}, the analytic scan runs over the environments and its mf0 is the tables' OMF`, () => {
        assert.ok(analytic && analytic.candidates.length > 0);
        assert.ok(relative(analytic.mf0, tableOmf(design, rows)) <= 1e-12, `${analytic.mf0} vs ${tableOmf(design, rows)}`);
    });
    const fd = scanNeedlesFD({ ...args, deltaNm: 1e-4 });
    await check(`with ${label}, each candidate's slope is the finite-difference scan's`, () => {
        assert.equal(fd.candidates.length, analytic.candidates.length);
        const scale = Math.max(...analytic.candidates.map(c => Math.abs(c.grad)));
        analytic.candidates.forEach((c, i) => {
            const other = fd.candidates[i];
            assert.equal(`${c.pos}|${c.materialId}`, `${other.pos}|${other.materialId}`);
            assert.ok(Math.abs(c.grad - other.grad) <= 2e-4 * scale, `${c.materialId} at ${c.pos}: ${c.grad} vs ${other.grad}`);
        });
    });
    await check(`with ${label}, and a forward difference of the tables' OMF with the needle put in`, () => {
        const h = 1e-4;
        const omf0 = tableOmf(design, rows);
        const scale = Math.max(...analytic.candidates.map(c => Math.abs(c.grad)));
        for (const c of analytic.candidates.filter((_, i) => i % 5 === 0)) {
            const slope = (tableOmf(withNeedle(design, c, h), rows) - omf0) / h;
            assert.ok(Math.abs(c.grad - slope) <= 2e-4 * scale, `${c.materialId} at ${c.pos}: ${c.grad} vs ${slope}`);
        }
    });
}
// Every surface mode: the analytic slope over the environments is the
// finite-difference scan's, on each side a mode scans.
const SIDE_LAYERS = [60, 140].map((thickness, i) => ({ id: `B${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false }));
const MODES = [
    ['back_only', { surfaceMode: 'back_only', mfEvalMode: 'side', frontLayers: [], backLayers: BASE.frontLayers }, ['back']],
    ['symmetric', { surfaceMode: 'symmetric', mfEvalMode: 'total', backLayers: [] }, ['front']],
    ['both_independent', { surfaceMode: 'both_independent', mfEvalMode: 'total', backLayers: SIDE_LAYERS }, ['front', 'back']],
];
for (const [mode, extra, sides] of MODES) {
    await check(`in ${mode}, the analytic slope over the environments is the finite-difference scan's`, () => {
        const design = withEnvironments([WATER, EDGE], ROWS, extra);
        const rows = synthesisRows(design, design.meritOperands);
        for (const side of sides) {
            const args = { operands: rows, design, resolveMat: lookup, candidateMats: POOL, nIntra: 3, side };
            const analytic = scanNeedlesAnalytic(args);
            const fd = scanNeedlesFD({ ...args, deltaNm: 1e-5 });
            assert.ok(analytic && relative(analytic.mf0, fd.mf0) <= 1e-12, `${side}: ${analytic?.mf0} vs ${fd.mf0}`);
            const scale = Math.max(...analytic.candidates.map(c => Math.abs(c.grad)));
            analytic.candidates.forEach((c, i) => assert.ok(Math.abs(c.grad - fd.candidates[i].grad) <= 1e-4 * scale,
                `${side}, ${c.materialId} at ${c.pos}: ${c.grad} vs ${fd.candidates[i].grad}`));
        }
    });
}
await check('the slope is Σ f·OMF_k·P_k / (N·OMF) of each environment scanned on its own', () => {
    const rows = synthesisRows(DESIGN, DESIGN.meritOperands);
    const total = scanNeedlesAnalytic({ operands: rows, design: DESIGN, resolveMat: lookup, candidateMats: POOL, nIntra: 3 });
    const environments = [{ id: 'base' }, WATER, EDGE];
    const each = environments.map(env => {
        const own = oneEnvironmentDesign(DESIGN, env.id);
        const swapped = POOL.map(p => ({ ...p, mat: lookup(env.materialSwaps?.[p.id] ?? p.id) }));
        // Each environment's own scan, its candidates by recipe material.
        const scan = scanNeedlesAnalytic({ operands: rowsScoredIn(rows, env.id), design: own, resolveMat: lookup, candidateMats: swapped, nIntra: 3 });
        return { env, scan };
    });
    // Positions inside a layer whose host the swap makes the needle's own
    // material are not scanned by that environment alone; compare the gaps.
    const gaps = total.candidates.filter(c => !c.intra);
    for (const c of gaps) {
        let sum = 0;
        for (const { env, scan } of each) {
            const mine = scan.candidates.find(o => !o.intra && o.pos === c.pos && o.materialId === c.materialId);
            const factor = env.thicknessFactors?.[c.materialId] ?? 1;
            sum += factor * scan.mf0 * mine.grad;
        }
        const expected = sum / (each.length * total.mf0);
        assert.ok(relative(c.grad, expected) <= 1e-9, `${c.materialId} at ${c.pos}: ${c.grad} vs ${expected}`);
    }
});
await check('a needle goes into each environment as its swap, as thick as its factor says', () => {
    const rows = synthesisRows(DESIGN, DESIGN.meritOperands);
    const scene = needleScene({ operands: rows, design: DESIGN, resolveMat: lookup, side: 'front' });
    const cand = { pos: 2, materialId: 'SiO2' };
    const nm = 7;
    assert.ok(relative(scene.gap(2, 'SiO2', lookup('SiO2'), nm), tableOmf(withNeedle(DESIGN, cand, nm), rows)) <= 1e-12);
    const inEdge = environmentDesign(withNeedle(DESIGN, cand, nm), 'env3').frontLayers[2];
    assert.deepEqual([inEdge.material, inEdge.thickness], ['MgF2', 7]);
    const titania = environmentDesign(withNeedle(DESIGN, { pos: 2, materialId: 'TiO2' }, 10), 'env3').frontLayers[2];
    assert.ok(Math.abs(titania.thickness - 9) < 1e-12);
});
await check('the needle thickness search and the forced-step scan score the total OMF', () => {
    const rows = synthesisRows(DESIGN, DESIGN.meritOperands);
    const cand = { pos: 1, materialId: 'MgF2', _mat: lookup('MgF2') };
    const d = findOptimalNeedleThickness({ operands: rows, design: DESIGN, resolveMat: lookup, candidate: cand, deltaNm: 1, maxNm: 60, side: 'front' });
    const omfAt = nm => tableOmf(withNeedle(DESIGN, cand, nm), rows);
    assert.ok(d >= 1 && omfAt(d) <= omfAt(1) + 1e-12, `${d}: ${omfAt(d)} vs ${omfAt(1)}`);
    const ge = scanGEInsertions({ operands: rows, design: DESIGN, resolveMat: lookup, candidateMats: POOL, thickNm: 15, side: 'front' });
    for (const c of ge.candidates) assert.ok(relative(c.mfNew, tableOmf(withNeedle(DESIGN, c, 15), rows)) <= 1e-12, `${c.materialId} at ${c.pos}`);
});

// ── 2. The rows a run fits ──────────────────────────────────────────────────
await check('a run fits the rows of the environments that are on', () => {
    const ids = design => synthesisRows(design, design.meritOperands).map(op => op.id);
    assert.deepEqual(ids(DESIGN), ['r480', 'r560', 'r640', 't520', 'math', 'r600']);
    const waterOff = withEnvironments([{ ...WATER, enabled: false }, EDGE]);
    assert.deepEqual(ids(waterOff), ['r480', 'r560', 'r640', 'r600'], 'the row of an environment that is off, and the math row reading it, go');
    const allOff = withEnvironments([{ ...WATER, enabled: false }]);
    allOff.environments[0] = { id: 'base', enabled: false };
    assert.deepEqual(ids(allOff), []);
});
await check('with no environment on, a run has nothing to fit', async () => {
    const allOff = withEnvironments([{ ...WATER, enabled: false }]);
    allOff.environments[0] = { id: 'base', enabled: false };
    const { result } = await api.synthesize(allOff, { method: 'needle', pool: POOL_IDS, settings: { maxLayers: 6 } });
    assert.equal(result.stopReason, 'noOperands');
});

// ── 3. Environment 1 alone, bit for bit ─────────────────────────────────────
const ALONE = withEnvironments([{ ...WATER, enabled: false }, { ...EDGE, enabled: false }]);
const PLAIN = { ...BASE, meritOperands: ROWS.filter(op => op.env !== 'env2' && op.id !== 'math') };
const layersOf = layers => (layers || []).map(l => [l.material, l.thickness]);
const answerOf = ({ result }) => ({
    completed: result.completed, stopReason: result.stopReason, mf: result.mf, omf: result.omf ?? null,
    front: layersOf(result.frontLayers ?? result.layers), back: layersOf(result.backLayers),
});
await check('a merit of environment 1 alone scans as the design without environments', () => {
    const scan = (design, scanner) => scanner({ operands: synthesisRows(design, design.meritOperands), design, resolveMat: lookup, candidateMats: POOL, nIntra: 3 });
    assert.deepEqual(scan(ALONE, scanNeedlesAnalytic), scan(PLAIN, scanNeedlesAnalytic));
    assert.deepEqual(scan(ALONE, scanNeedlesFD), scan(PLAIN, scanNeedlesFD));
    assert.equal(meritOf(synthesisRows(ALONE, ALONE.meritOperands), ALONE, lookup), meritOf(PLAIN.meritOperands, PLAIN, lookup));
});
const RUNS = {
    needle: { maxLayers: 6 },
    ge: { maxLayers: 6, maxGeCycles: 1 },
    structural: { seed: 11, maxIter: 6 },
    deep: { dMin: 20, maxLayers: 6, seed: 7, method: { search: { rounds: 2, children: 3 } } },
};
// Environment 2 on, with a factor, holding only a row of weight 0, and every
// other row scored in environment 1: the merit counts environment 1 alone.
const ALONE_ON = withEnvironments([{ id: 'env2', thicknessFactors: { TiO2: 0.9 } }], [
    ...PLAIN.meritOperands.map(op => ({ ...op, env: 'base' })),
    row({ type: 'R', lambdaStart: 700, aoi: 0, pol: 'avg', target: 0, weight: 0 }, 'w0', 'env2'),
]);
for (const [method, settings] of Object.entries(RUNS)) {
    await check(`a seeded ${method} run on environment 1 alone is the design without environments' run`, async () => {
        const plain = answerOf(await api.synthesize(PLAIN, { method, pool: POOL_IDS, settings }));
        assert.ok(plain.front.length > 0, `${plain.stopReason}`);
        assert.deepEqual(answerOf(await api.synthesize(ALONE, { method, pool: POOL_IDS, settings })), plain, 'the other environments off');
        assert.deepEqual(answerOf(await api.synthesize(ALONE_ON, { method, pool: POOL_IDS, settings })), plain, 'environment 2 on, counting nothing');
    });
}

// ── 4. Runs over every environment ──────────────────────────────────────────
for (const [method, settings] of Object.entries(RUNS)) {
    await check(`${method} lowers the merit over every environment and reports it`, async () => {
        const before = api.merit(DESIGN).total;
        const { result, design } = await api.synthesize(DESIGN, { method, pool: POOL_IDS, settings });
        const after = api.merit(design).total;
        assert.ok(result.completed, `${result.stopReason} ${result.message ?? ''}`);
        assert.ok(after < before, `${after} vs ${before}`);
        assert.ok(relative(result.mf, after) <= 1e-9, `${method}: ${result.mf} vs ${after}`);
    });
}

// ── 5. Worker inputs ────────────────────────────────────────────────────────
await check('the worker tables hold the materials only other environments name', () => {
    const rows = synthesisRows(DESIGN, DESIGN.meritOperands);
    const tables = presampleSynthesisMaterials(DESIGN, rows, POOL);
    for (const id of ['H2O', 'Al2O3', 'MgF2']) assert.ok(tables[id], `${id} is in the tables`);
    assert.deepEqual(serializableMedia(DESIGN).environments, DESIGN.environments);
    assert.equal('environments' in serializableMedia(PLAIN), false);
});
await check('a scan through the synthesis worker gives what this thread gives', () => {
    const rows = synthesisRows(DESIGN, DESIGN.meritOperands);
    const design = { ...serializableMedia(DESIGN), frontLayers: DESIGN.frontLayers, backLayers: [] };
    const job = { type: 'scan', operands: rows, design, poolSlice: POOL.map(({ id, name }) => ({ id, name })), deltaNm: 0.5, side: 'front', dMin: 1, nIntra: 3 };
    const tables = presampleSynthesisMaterials(DESIGN, rows, POOL);
    let answer = null;
    dispatchSynthesisJob(job, makeResolveMat(tables, 'test', () => {}), m => { if (m.type === 'result') answer = m; });
    const here = scanNeedlesAnalytic({ operands: rows, design: DESIGN, resolveMat: lookup, candidateMats: POOL, deltaNm: 0.5, nIntra: 3, dMin: 1 });
    assert.ok(relative(answer.mf0, here.mf0) <= 1e-12, `${answer.mf0} vs ${here.mf0}`);
    assert.ok(relative(answer.mf0, tableOmf(DESIGN, rows)) <= 1e-12, `${answer.mf0} vs the tables' ${tableOmf(DESIGN, rows)}`);
});
await check('the Design Cleaner\'s refine in the optimizer worker scores another environment\'s own substrate', async () => {
    const rows = synthesisRows(DESIGN, DESIGN.meritOperands);
    const tables = presampleSynthesisMaterials(DESIGN, rows, []);
    const messages = [];
    // The job refineInWorker (synthesisShared/workerRefine.js) posts.
    await handleOptimizerMessage({ type: 'start', method: 'dls', operands: rows, design: DESIGN, materials: tables, opts: { maxIter: 2 }, engineOpts: { dMin: 1 } },
        m => messages.push(m));
    const init = messages.find(m => m.type === 'init');
    const here = new DLSOptimizer(rows, DESIGN, lookup, { dMin: 1 }).mf;
    assert.ok(init && relative(init.mfInitial, here) <= 1e-12, `${init?.mfInitial} vs ${here}`);
});

// ── 6. Floors ───────────────────────────────────────────────────────────────
const mnt = (target, id, env) => row({ type: 'MNT', lambdaStart: 1, lambdaEnd: 4, target, weight: 1 }, id, env);
const mxt = (target, id, env) => row({ type: 'MXT', lambdaStart: 1, lambdaEnd: 4, target, weight: 1 }, id, env);
await check('an MNT row is read in each environment it is scored in, at target / f', () => {
    const edge = { id: 'env2', thicknessFactors: { TiO2: 0.8 } };
    assert.equal(synthesisMntFloor(withEnvironments([edge], [ROWS[0], mnt(20, 'm')])), 25);
    assert.equal(synthesisMntFloor(withEnvironments([edge], [ROWS[0], mnt(20, 'm', 'base')])), 20, 'environment 1 alone');
    assert.equal(synthesisMntFloor(withEnvironments([{ ...edge, enabled: false }], [ROWS[0], mnt(20, 'm')])), 20, 'environment 2 off');
    assert.equal(synthesisMntFloor(withEnvironments([{ id: 'env2', thicknessFactors: { TiO2: 1.25 } }], [ROWS[0], mnt(20, 'm')])), 20, 'a factor above 1 lowers no floor');
    assert.equal(synthesisMntFloor(PLAIN), 0);
});
await check('Structural and Deep Synthesis take the floor and the ceiling the same way', () => {
    const design = withEnvironments([{ id: 'env2', thicknessFactors: { TiO2: 0.8, SiO2: 1.25 } }], [ROWS[0], mnt(20, 'm'), mxt(250, 'x', 'env2')]);
    const bounds = { dMin: 1 };
    applyConstraintBounds(bounds, synthesisRows(design, design.meritOperands), design);
    assert.deepEqual(bounds, { dMin: 25, dMax: 200 });
    const deep = prepareDeep(design, design.meritOperands, planDeep({ pool: POOL, dMin: 1 }));
    assert.deepEqual([deep.dMin, deep.dMax], [25, 200]);
});
await check('a factor of a material neither the layers nor the pool hold binds nothing', () => {
    const design = withEnvironments([{ id: 'env2', thicknessFactors: { Ta2O5: 0.5, HfO2: 2 } }], [ROWS[0], mnt(20, 'm'), mxt(300, 'x')]);
    assert.equal(synthesisMntFloor(design), 20);
    assert.equal(synthesisMntFloor(design, design.meritOperands, ['Ta2O5']), 40, 'until the pool holds it');
    const rows = synthesisRows(design, design.meritOperands);
    const bounds = { dMin: 1 };
    applyConstraintBounds(bounds, rows, design, POOL);
    assert.deepEqual(bounds, { dMin: 20, dMax: 300 });
    const pooled = { dMin: 1 };
    applyConstraintBounds(pooled, rows, design, [...POOL, { id: 'Ta2O5' }, { id: 'HfO2' }]);
    assert.deepEqual(pooled, { dMin: 40, dMax: 150 });
});
await check('a Gradual Evolution run keeps every layer at the floor of the edge environment', async () => {
    let design = api.addEnvironment(api.stackFromFormula(api.newDesign({ name: 'Floor' }), { formula: 'H L' }), { name: 'Dome edge', thicknessFactors: { TiO2: 0.8 } });
    design = api.setMerit(design, [
        { type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0 },
        { type: 'MNT', target: 20 },
    ]);
    const { result, design: grown } = await api.synthesize(design, { method: 'ge', pool: ['TiO2', 'SiO2'], settings: { maxLayers: 6, maxGeCycles: 1 } });
    const thinnest = Math.min(...grown.frontLayers.map(l => l.thickness));
    assert.ok(result.completed && thinnest >= 25 - 1e-6, `${result.stopReason} ${thinnest}`);
});

// ── 7. Needle Manual and Deep Synthesis ─────────────────────────────────────
await check('Needle Manual\'s profile in the optimizer worker, and the API\'s, score every environment', async () => {
    const rows = synthesisRows(DESIGN, DESIGN.meritOperands);
    const messages = [];
    // The job profileScanOffThread (needleManual/model.js) posts.
    await handleOptimizerMessage({
        type: 'needleProfile', operands: rows, design: DESIGN, poolIds: POOL_IDS, deltaNm: 0.5, nIntra: 3, side: 'front',
        materials: presampleSynthesisMaterials(DESIGN, rows, POOL),
    }, m => messages.push(m));
    const { scan } = messages.find(m => m.type === 'needleProfile');
    assert.ok(relative(scan.mf0, tableOmf(DESIGN, rows)) <= 1e-12, `${scan.mf0} vs ${tableOmf(DESIGN, rows)}`);
    const profile = api.needleProfile(DESIGN, { pool: POOL_IDS });
    assert.ok(relative(profile.mf0, api.merit(DESIGN).optical) <= 1e-12, `${profile.mf0} vs ${api.merit(DESIGN).optical}`);
});
await check('Needle Manual\'s refine after Apply lowers the merit over every environment', () => {
    const rows = synthesisRows(DESIGN, DESIGN.meritOperands);
    const inserted = withNeedle(DESIGN, { pos: 2, materialId: 'SiO2' }, 5);
    const job = insertionRefineJob(rows, inserted, 1, 10);
    assert.deepEqual(job.design.environments, DESIGN.environments);
    const engine = makeEngine(job.method, job.operands, job.design, lookup, { dMin: job.dMin });
    const before = evaluateForDisplay(inserted, rows).mf;
    assert.ok(relative(engine.mf, before) <= 1e-12, `${engine.mf} vs the tables' ${before}`);
    for (let i = 0; i < job.iters && !engine.isConverged(); i++) engine.step();
    engine.restoreBest();
    const after = evaluateForDisplay(engine.applyToDesign(job.design), rows).mf;
    assert.ok(after < before && relative(engine.mfBest, after) <= 1e-12, `${after} vs ${before}`);
});
await check('Deep Synthesis\'s refine is Gauss-Newton because of the environments, and Newton on environment 1 alone', () => {
    const plan = planDeep({ pool: POOL, dMin: 1 });
    assert.deepEqual(prepareDeep(DESIGN, DESIGN.meritOperands, plan).parts.refine.why, 'environments');
    const alone = prepareDeep(ALONE, ALONE.meritOperands, plan).parts.refine;
    assert.deepEqual([alone.model, alone.why], ['newton', null]);
});
await check('the merit a run re-scores a design with is the tables\' total', () => {
    const rows = synthesisRows(DESIGN, DESIGN.meritOperands);
    const shown = evaluateForDisplay(DESIGN, rows);
    const merits = designMerits(rows, DESIGN, lookup);
    assert.ok(relative(merits.mf, shown.mf) <= 1e-12 && relative(merits.omf, shown.omf) <= 1e-12, `${merits.mf} ${shown.mf}`);
    assert.ok(relative(meritOf(rows, DESIGN, lookup), shown.mf) <= 1e-12, 'Needle\'s and Gradual Evolution\'s regrid');
    const structural = scoreDesign(rows, DESIGN, lookup, null, null);
    assert.ok(relative(structural.mf, shown.mf) <= 1e-12 && relative(structural.omf, shown.omf) <= 1e-12, 'Structural\'s');
});

console.log(`${pass} passed`);
