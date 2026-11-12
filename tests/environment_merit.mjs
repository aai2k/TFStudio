/**
 * The merit of a design with environments, in the merit table and in the
 * least-squares engine (utils/environments/environmentMerit.js,
 * utils/physics/environmentDisplay.js, physics/optimizer/environmentGroups.js):
 *
 *   1. The table's MF is √(mean of MF_k²) over the environments, each MF_k
 *      the merit of a design without environments, the design environment k
 *      sees, over the rows scored there; the OMF likewise. A row of one
 *      environment shows its value there, a row of every environment its
 *      value in environment 1, and the result lists each environment's merit.
 *   2. An environment with a material that resolves to nothing has no merit,
 *      so neither has the design; the other environments keep their values.
 *   3. An environment switched off, and one whose rows all weigh 0, count in
 *      neither the MF nor N; a math row without env is scored where the rows
 *      it reads are; the run's check reads each row where it is scored.
 *   4. The engine's MF and OMF at the start are the table's, and its analytic
 *      Jacobian, with a thickness factor and a material swap, is the central
 *      difference of its residuals.
 *   5. DLS lowers the MF over every environment, and its MF stays the
 *      table's for the design it gives.
 *   6. A merit that counts environment 1 alone, environment 2 being off or
 *      holding only rows of weight 0, is scored as environment 1's design
 *      without environments: the table's MF and OMF are that design's, and
 *      DLS, Newton, SQP and trust-region take exactly the steps they take on
 *      it, full Newton Hessian included. One that counts environment 2 alone
 *      stays scored over groups.
 *   7. A refinement run through runRefinement, its workers given only the
 *      worker payload, scores a substrate only environment 2 names, and its
 *      MF is the table's on the run's grid.
 *
 * Synthesis over environments is tests/environment_synthesis.mjs.
 *
 * Run: node tests/environment_merit.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initWasmForTest, TMMCORE_WASM_PATH } from './_wasmInit.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';
import {
    DLSOptimizer, makeOperand, makeMeasuredCurveOperand, withDesignSampleCounts,
} from '../src/utils/physics/optimizer.js';
import { makeResolveMat } from '../src/utils/workers/resolveMat.js';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { evaluateForDisplay, meritDisplay } from '../src/utils/physics/meritDisplay.js';
import { oneEnvironmentDesign } from '../src/utils/environments/environments.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { computeOperandDisplay } from '../src/utils/refinement/operandCheck.js';
import { runRefinement } from '../src/utils/refinement/runRefinement.js';
import { densifyForRun, buildPayload, presampleMaterials } from '../src/utils/refinement/workerInputs.js';
import { InThreadOptimizerWorker } from '../src/utils/workers/inThreadOptimizerWorker.js';

await initWasmForTest();

let pass = 0;
const check = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };
const relative = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

const row = (fields, env) => ({ ...makeOperand(fields), ...(env ? { env } : {}) });
const ROWS = [
    row({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }),
    row({ type: 'T', lambdaStart: 550, target: 0.98, weight: 2 }, 'env2'),
    row({ type: 'R', lambdaStart: 600, target: 0, weight: 1 }, 'base'),
    row({ type: 'MNT', lambdaStart: 1, lambdaEnd: 4, target: 70, weight: 1 }),
    row({ type: 'TAV', lambdaStart: 700, lambdaEnd: 800, target: 0.9, weight: 1 }, 'env3'),
];
const WATER = { id: 'env2', name: 'Under water on sapphire', incidentMedium: 'H2O', substrate: { material: 'Al2O3' } };
const EDGE = { id: 'env3', name: 'Dome edge', thicknessFactors: { TiO2: 0.95 }, materialSwaps: { SiO2: 'MgF2' } };
const BASE = {
    name: 'Environments', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [80, 140, 60, 120].map((thickness, i) => ({ id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false })),
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
};
const withEnvironments = (environments, rows = ROWS) => ({ ...BASE, meritOperands: rows, environments: [{ id: 'base' }, ...environments] });
const DESIGN = withEnvironments([WATER, EDGE]);

// The design environment `id` sees, as a design without environments, and
// the rows scored there: a row of every environment and its own.
function apart(design, rows, id) {
    return { own: oneEnvironmentDesign(design, id), rows: rows.filter(op => op.env == null || op.env === id) };
}

const rms = values => Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
// Rows as a run samples them: band rows on environment 1's fringe grid.
const sampled = withDesignSampleCounts(ROWS, DESIGN, designMaterialLookup(DESIGN));

// ── 1. The table ───────────────────────────────────────────────────────────
const shown = evaluateForDisplay(DESIGN, ROWS);
const each = ['base', 'env2', 'env3'].map(id => {
    const { own, rows } = apart(DESIGN, sampled, id);
    return { id, rows, ...meritDisplay(own, rows) };
});
check('the MF is √(mean of MF_k²) of each environment scored apart, and the OMF likewise', () => {
    assert.ok(each.every(e => Number.isFinite(e.mf) && e.mf > 0), JSON.stringify(each.map(e => e.mf)));
    assert.ok(relative(shown.mf, rms(each.map(e => e.mf))) <= 1e-12, `${shown.mf} vs ${rms(each.map(e => e.mf))}`);
    assert.ok(relative(shown.omf, rms(each.map(e => e.omf))) <= 1e-12, `${shown.omf} vs ${rms(each.map(e => e.omf))}`);
    assert.ok(shown.mf > shown.omf, 'the MNT row is violated, so the MF is above the OMF');
});
check('each environment differs from the others, so the three are scored on their own stacks', () => {
    const [base, water, edge] = each;
    assert.notEqual(base.computed[0], water.computed[0]);
    assert.notEqual(base.computed[0], edge.computed[0]);
});
check('a row of one environment shows its value there; a row of every environment its value in environment 1', () => {
    const valueIn = (id, op) => { const e = each.find(x => x.id === id); return e.computed[e.rows.indexOf(op)]; };
    assert.equal(shown.computed[0], valueIn('base', sampled[0]));
    assert.equal(shown.computed[1], valueIn('env2', sampled[1]));
    assert.equal(shown.computed[2], valueIn('base', sampled[2]));
    assert.equal(shown.computed[4], valueIn('env3', sampled[4]));
    assert.deepEqual(shown.environments.map(e => [e.id, e.rows]), [['base', [0, 2, 3]], ['env2', [0, 1, 3]], ['env3', [0, 3, 4]]]);
    assert.deepEqual(shown.environments.map(e => e.mf), each.map(e => e.mf));
});

// ── 2. A material that resolves to nothing ─────────────────────────────────
check('an environment whose substrate resolves to nothing has no merit, and nor has the design', () => {
    const lost = withEnvironments([{ ...WATER, substrate: { material: 'user_gone:Nothing' } }, EDGE]);
    const result = evaluateForDisplay(lost, ROWS);
    assert.equal(result.mf, null);
    assert.equal(result.omf, null);
    assert.equal(result.environments[1].mf, null);
    assert.equal(result.computed[1], null, 'the row of that environment has no value');
    assert.equal(result.computed[0], shown.computed[0], 'environment 1 keeps its values');
});

// ── 3. What counts in N ────────────────────────────────────────────────────
check('an environment switched off, and one whose rows all weigh 0, are not in the MF', () => {
    const off = withEnvironments([{ ...WATER, enabled: false }, EDGE]);
    const result = evaluateForDisplay(off, ROWS);
    assert.ok(relative(result.mf, rms([each[0].mf, each[2].mf])) <= 1e-12);
    assert.equal(result.computed[1], null, 'a row of an environment switched off has no value');
    const monitor = [
        row({ type: 'R', lambdaStart: 600, target: 0, weight: 1 }, 'base'),
        row({ type: 'TAV', lambdaStart: 700, lambdaEnd: 800, target: 0.9, weight: 0 }, 'env3'),
    ];
    const quiet = evaluateForDisplay(withEnvironments([WATER, EDGE], monitor), monitor);
    assert.deepEqual(quiet.environments.map(e => [e.id, e.scored]), [['base', true], ['env3', false]], 'environment 2 has no row');
    assert.ok(Number.isFinite(quiet.computed[1]), 'the row of weight 0 still shows its value');
    assert.equal(quiet.mf, quiet.environments[0].mf);
});
check('a math row without env that reads a row of one environment is scored there, not left without a value elsewhere', () => {
    const reads = [
        { ...row({ type: 'T', lambdaStart: 550, target: 0.98, weight: 1 }, 'env2'), id: 'wet' },
        { ...makeOperand({ type: 'OPGT', target: 0.5, weight: 1 }), refId: 'wet' },
        row({ type: 'R', lambdaStart: 600, target: 0, weight: 1 }, 'base'),
    ];
    const result = evaluateForDisplay(withEnvironments([WATER], reads), reads);
    assert.deepEqual(result.environments.map(e => [e.id, e.rows]), [['base', [2]], ['env2', [0, 1]]]);
    assert.deepEqual(result.errors, [null, null, null]);
    assert.ok(Number.isFinite(result.mf) && Number.isFinite(result.computed[1]));
});
check('the run\'s check reads each row in every environment it is scored in', () => {
    const check2 = computeOperandDisplay(DESIGN, ROWS);
    assert.equal(check2.mf, shown.mf);
    assert.deepEqual(check2.errors, [null, null, null, null, null]);
});

// ── 4. The engine at the start ─────────────────────────────────────────────
const lookup = designMaterialLookup(DESIGN);
check('the engine\'s MF and OMF at the start are the table\'s', () => {
    const engine = new DLSOptimizer(sampled, DESIGN, lookup);
    assert.ok(relative(engine.mf, shown.mf) <= 1e-12, `${engine.mf} vs ${shown.mf}`);
    assert.ok(relative(engine.mfOpticalAt(engine.thicknesses), shown.omf) <= 1e-12);
});
// Central differences step each layer by 1e-4 of its thickness, 0.006 to
// 0.014 nm on these layers: the engine's floor, which the fdStep of 1e-3 nm
// given here does not go below. The analytic Jacobian is the exact
// derivative, so what the two differ by is the difference's truncation
// error. A tolerance of 1e-7 of the largest entry keeps clear of it and still
// catches a column without its factor, 5% off.
check('the analytic Jacobian, with a factor and a swap, is the central difference of the residuals', () => {
    const engine = new DLSOptimizer(sampled, DESIGN, lookup, { fdStep: 1e-3 });
    const x = engine.thicknesses;
    const free = x.map((_, i) => i);
    const J = engine._analyticJacobian(x, free);
    assert.ok(J, 'every row has an analytic chain rule');
    const F = engine._fdJacobian(x, free, J.length);
    assert.equal(J.length, engine._residuals(x).length);
    const largest = Math.max(...J.flat().map(Math.abs));
    const worst = Math.max(...J.flatMap((r, i) => r.map((v, c) => Math.abs(v - F[i][c]))));
    assert.ok(worst <= 1e-7 * largest, `worst ${worst} of ${largest}`);
    const r = engine._residuals(x);
    const D = engine._groups.weightSum(engine._evaluate(x));
    assert.ok(relative(Math.sqrt(r.reduce((s, v) => s + v * v, 0) / D), engine.mf) <= 1e-12, 'Σ r² = D̄·MF²');
});
check('the gradient of the MF is the central difference of the MF', () => {
    const engine = new DLSOptimizer(sampled, DESIGN, lookup);
    const x = engine.thicknesses;
    const g = engine.gradMF(x);
    const h = 1e-3;
    x.forEach((d, i) => {
        const up = x.slice(); up[i] = d + h;
        const down = x.slice(); down[i] = d - h;
        const fd = (engine.mfAt(up) - engine.mfAt(down)) / (2 * h);
        assert.ok(Math.abs(g[i] - fd) <= 1e-6 * Math.max(...g.map(Math.abs)), `layer ${i}: ${g[i]} vs ${fd}`);
    });
});

// ── 5. A refinement over every environment ─────────────────────────────────
check('DLS lowers the MF over every environment, and its MF is the table\'s for the design it gives', () => {
    const engine = new DLSOptimizer(sampled, DESIGN, lookup);
    const start = engine.mf;
    for (let i = 0; i < 8 && !engine.isConverged(); i++) engine.step();
    assert.ok(engine.mf < 0.5 * start, `${start} to ${engine.mf}`);
    const refined = engine.applyToDesign(DESIGN);
    const table = meritDisplay(refined, sampled);
    assert.ok(relative(engine.mf, table.mf) <= 1e-12, `${engine.mf} vs ${table.mf}`);
});

// ── 6. A merit that counts environment 1 alone ─────────────────────────────
{
    const rows = sampled.filter(op => op.env !== 'env3');
    // Environment 1's rows, each scored there alone, and a row of weight 0 in
    // environment 2: environment 2 is evaluated but counts in no merit.
    const own = rows.filter(op => op.env !== 'env2').map(op => ({ ...op, env: 'base' }));
    const watched = [...own, { ...rows.find(op => op.env === 'env2'), weight: 0 }];
    const alone = apart(withEnvironments([WATER], rows), rows, 'base');
    // eslint-disable-next-line no-unused-vars
    const aloneRows = alone.rows.map(({ env, ...op }) => op);
    const cases = [
        ['switched off', withEnvironments([{ ...WATER, enabled: false }], rows), rows],
        ['holding only a row of weight 0', withEnvironments([WATER], watched), watched],
    ];
    for (const [how, design, caseRows] of cases) {
        check(`with environment 2 ${how}, the table's MF and OMF are environment 1's as they are`, () => {
            const shownHere = evaluateForDisplay(design, caseRows);
            const plain = evaluateForDisplay(alone.own, aloneRows);
            assert.equal(shownHere.mf, plain.mf);
            assert.equal(shownHere.omf, plain.omf);
        });
        for (const method of ['dls', 'newton', 'sqp', 'trust-region']) {
            check(`with environment 2 ${how}, ${method} takes exactly the steps it takes on environment 1 alone`, () => {
                const grouped = makeEngine(method, caseRows, design, lookup, { maxIter: 15 });
                const plain = makeEngine(method, aloneRows, alone.own, lookup, { maxIter: 15 });
                assert.equal(grouped._groups, undefined, 'no groups: the design without environments');
                if (method === 'trust-region') assert.equal(grouped.hessianModel, 'newton', 'the full Newton Hessian');
                const start = plain.mf;
                for (let i = 0; i < 15; i++) {
                    if (!grouped.isConverged()) grouped.step();
                    if (!plain.isConverged()) plain.step();
                }
                assert.ok(plain.mf < start, `${method} moved: ${start} to ${plain.mf}`);
                assert.deepEqual(grouped.thicknesses, plain.thicknesses);
                assert.equal(grouped.mf, plain.mf);
                assert.equal(grouped.iter, plain.iter);
            });
        }
    }
    check('a merit that counts another environment alone stays scored over groups, its thicknesses being scaled', () => {
        const edgeOnly = { ...BASE, meritOperands: ROWS, environments: [{ id: 'base', enabled: false }, { ...WATER, enabled: false }, EDGE] };
        const engine = new DLSOptimizer(sampled, edgeOnly, lookup);
        assert.equal(engine._groups.count, 1);
        assert.equal(engine.mf, evaluateForDisplay(edgeOnly, ROWS).mf);
    });
}

// ── 7. A run through the worker payload ────────────────────────────────────
{
    const rows = ROWS.filter(op => op.env !== 'env3');
    // Al2O3 is named by environment 2 alone: no layer, medium or substrate of
    // environment 1 is Al2O3, so the run's tables hold it only if the run
    // samples every environment's materials.
    const design = withEnvironments([WATER], rows);
    const result = await runRefinement(design, rows, { method: 'dls', maxIter: 10 }, { makeWorker: () => new InThreadOptimizerWorker() });
    check('a run scores the substrate only environment 2 names, and its MF is the table\'s on the run\'s grid', () => {
        assert.equal(result.completed, true, result.stopReason);
        const grid = densifyForRun(rows.filter(op => op.enabled), design);
        const startTable = meritDisplay(design, grid);
        const answer = { ...design, frontLayers: result.frontLayers, backLayers: result.backLayers };
        const endTable = meritDisplay(answer, grid);
        assert.ok(relative(result.mfInitial, startTable.mf) <= 1e-12, `${result.mfInitial} vs ${startTable.mf}`);
        assert.ok(relative(result.mf, endTable.mf) <= 1e-12, `${result.mf} vs ${endTable.mf}`);
        // The table proper samples band rows for the answer's own fringes,
        // which here are the run's grid as well.
        assert.equal(evaluateForDisplay(answer, rows).mf, endTable.mf);
        assert.ok(result.mf < result.mfInitial);
    });
}

// ── 9. The Jacobian and the gradient in every layout ───────────────────────
// Two environments, the second under water with TiO2 7% thinner and SiO2
// made of MgF2. In each case the analytic Jacobian is checked against central
// differences of the residuals, and the gradient of the MF against central
// differences of the MF, each to 1e-6 of its largest entry. The differences
// step a layer by 1e-4 of its thickness, about 0.01 nm here, whatever fdStep
// asks below that, and at that step their truncation error is 1e-7 to 4e-7
// of the largest entry on these stacks, with or without environments; the
// analytic Jacobian is the exact derivative. A column missing its factor or a
// group missing its scale is off by percent.
{
    const layer = (material, thickness, locked = false) => ({ id: `${material}${thickness}`, material, thickness, locked });
    const front = [layer('TiO2', 90), layer('SiO2', 130), layer('TiO2', 70)];
    const back = [layer('SiO2', 110), layer('TiO2', 60)];
    const SECOND = { id: 'env2', incidentMedium: 'H2O', thicknessFactors: { TiO2: 0.93 }, materialSwaps: { SiO2: 'MgF2' } };
    const optical = [
        row({ type: 'R', lambdaStart: 550, target: 0, weight: 1 }),
        row({ type: 'T', lambdaStart: 620, aoi: 30, pol: 's', target: 1, weight: 2 }),
        row({ type: 'RAV', lambdaStart: 480, lambdaEnd: 540, target: 0, weight: 1 }, 'env2'),
    ];
    const bounds = [
        row({ type: 'MNT', lambdaStart: 1, lambdaEnd: 3, target: 100, weight: 1 }, 'env2'),
        row({ type: 'MXT', lambdaStart: 1, lambdaEnd: 3, target: 80, weight: 1 }, 'env2'),
    ];
    const setup = (fields, rows = optical) => ({
        ...BASE, frontLayers: front, backLayers: [], ...fields, meritOperands: rows,
        environments: [{ id: 'base' }, SECOND],
    });
    const cases = [
        ['back-only', setup({ surfaceMode: 'back_only', frontLayers: [layer('TiO2', 50), layer('SiO2', 70)], backLayers: front })],
        ['symmetric', setup({ surfaceMode: 'symmetric', backLayers: [...front].reverse() })],
        ['both sides', setup({ surfaceMode: 'both_independent', backLayers: back })],
        ['whole-part scoring', setup({ mfEvalMode: 'total', backLayers: back })],
        ['a cone of incidence', setup({ cone: { enabled: true, halfAngleDeg: 10, gridPoints: 5 } })],
        ['a locked layer', setup({ frontLayers: [front[0], { ...front[1], locked: true }, front[2]] })],
        ['a group of MNT and MXT rows alone', setup({}, [...optical.slice(0, 2).map(op => ({ ...op, env: 'base' })), ...bounds])],
    ];
    for (const [name, design] of cases) {
        check(`the analytic Jacobian and the gradient with ${name}`, () => {
            const rows = design.meritOperands;
            const look = designMaterialLookup(design);
            const engine = new DLSOptimizer(rows, design, look, { fdStep: 1e-3 });
            assert.ok(engine._groups?.count === 2, 'scored over two groups');
            const x = engine.thicknesses;
            const free = x.map((_, i) => i).filter(i => !engine.lockedMask[i]);
            const J = engine._analyticJacobian(x, free);
            assert.ok(J, 'every row has an analytic chain rule');
            const F = engine._fdJacobian(x, free, J.length);
            const largest = Math.max(...J.flat().map(Math.abs));
            const worst = Math.max(...J.flatMap((r, i) => r.map((v, c) => Math.abs(v - F[i][c]))));
            assert.ok(worst <= 1e-6 * largest, `Jacobian: worst ${worst} of ${largest}`);
            const g = engine.gradMF(x);
            const top = Math.max(...g.map(Math.abs));
            for (const i of free) {
                const up = x.slice(); up[i] += 1e-3;
                const down = x.slice(); down[i] -= 1e-3;
                const fd = (engine.mfAt(up) - engine.mfAt(down)) / 2e-3;
                assert.ok(Math.abs(g[i] - fd) <= 1e-6 * top, `gradient, variable ${i}: ${g[i]} vs ${fd}`);
            }
            assert.ok(relative(engine.mf, evaluateForDisplay(design, rows).mf) <= 1e-12, 'and the MF is the table\'s');
        });
    }
}

// ── 10. SQP's thickness box over environments ──────────────────────────────
// An MNT or MXT row scored in an environment bounds the layer as that
// environment deposits it, f·d, so it bounds the variable d at target / f.
{
    const design = (rows, factor) => ({
        ...BASE, meritOperands: rows,
        environments: [{ id: 'base' }, { id: 'env2', thicknessFactors: { TiO2: factor } }],
    });
    const optical = row({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 });
    const boxOf = (rows, factor) => {
        const engine = makeEngine('sqp', rows, design(rows, factor), lookup);
        return { engine, ...engine._thicknessBounds([0, 1, 2, 3]) };
    };
    check('an MXT row of environment 2 bounds a TiO2 layer 0.8 times as thick there at target / 0.8', () => {
        const { boxHi } = boxOf([optical, row({ type: 'MXT', lambdaStart: 1, lambdaEnd: 4, target: 100, weight: 1 }, 'env2')], 0.8);
        assert.deepEqual(boxHi, [125, 100, 125, 100]);
    });
    check('an MNT row of environment 2 bounds a TiO2 layer 1.25 times as thick there at target / 1.25', () => {
        const { boxLo } = boxOf([optical, row({ type: 'MNT', lambdaStart: 1, lambdaEnd: 4, target: 120, weight: 1 }, 'env2')], 1.25);
        assert.deepEqual(boxLo, [96, 120, 96, 120]);
    });
    check('a row of every environment takes its tightest bound across them, and SQP keeps every layer in the box', () => {
        const { engine, boxLo, boxHi } = boxOf([optical, row({ type: 'MXT', lambdaStart: 1, lambdaEnd: 4, target: 100, weight: 1 })], 0.8);
        assert.deepEqual(boxHi, [100, 100, 100, 100]);
        for (let i = 0; i < 6 && !engine.isConverged(); i++) engine.step();
        engine.thicknesses.forEach((d, i) => assert.ok(d >= boxLo[i] && d <= boxHi[i], `layer ${i}: ${d}`));
    });
}

// ── 11. A PPEF row on a curve block of one environment ─────────────────────
{
    const lambdas = Array.from({ length: 21 }, (_, i) => 500 + 10 * i);
    const block = { ...makeMeasuredCurveOperand({ quantity: 'TDB', sampleLambdas: lambdas, sampleTargets: lambdas.map((_, i) => -0.2 - 0.01 * i) }), env: 'env2' };
    const ppef = makeOperand({ type: 'PPEF', refId: block.id, target: 0.1, weight: 1 });
    const ceiling = makeOperand({ type: 'OPLT', refId: ppef.id, target: 0.5, weight: 1 });
    const rows = [row({ type: 'R', lambdaStart: 600, target: 0, weight: 1 }, 'base'), block, ppef, ceiling];
    const design = withEnvironments([WATER], rows);
    check('a PPEF row without env, and a math row reading it, are scored where the block is', () => {
        const shownHere = evaluateForDisplay(design, rows);
        assert.deepEqual(shownHere.errors, [null, null, null, null], JSON.stringify(shownHere.errors));
        assert.deepEqual(shownHere.environments.map(e => [e.id, e.rows]), [['base', [0]], ['env2', [1, 2, 3]]]);
        assert.ok(Number.isFinite(shownHere.mf));
        const engine = new DLSOptimizer(rows, design, lookup);
        assert.ok(relative(engine.mf, shownHere.mf) <= 1e-12, `${engine.mf} vs ${shownHere.mf}`);
    });
    const result = await runRefinement(design, rows, { method: 'dls', maxIter: 4 }, { makeWorker: () => new InThreadOptimizerWorker() });
    check('and a refinement runs on them', () => assert.equal(result.completed, true, `${result.stopReason} ${result.message ?? ''}`));
}

// ── 12. The parallel DE evaluator ──────────────────────────────────────────
// Differential Evolution's pool workers (mfEvalWorker.js) score the vectors
// they are sent on the run's payload and tables, as the engine does.
{
    const rows = densifyForRun(ROWS.filter(op => op.enabled), DESIGN);
    const payload = buildPayload(DESIGN);
    const materials = presampleMaterials(DESIGN, rows);
    const engine = new DLSOptimizer(rows, payload, makeResolveMat(materials, 'test'));
    const vectors = [engine.thicknesses, engine.thicknesses.map(d => d * 1.05), engine.thicknesses.map((d, i) => d + 3 * i)];
    const worker = new NodeModuleWorker(new URL('../src/utils/workers/mfEvalWorker.js', import.meta.url));
    const answer = await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => (data.type === 'result' ? resolve(data) : reject(new Error(data.message)));
        worker.onerror = reject;
        worker.postMessage({ type: 'wasmInit', wasmBytes: readFileSync(TMMCORE_WASM_PATH) });
        worker.postMessage({ type: 'evalBatch', sid: 'environments', operands: rows, design: payload, materials, vectors, idx: 0 });
    });
    worker.terminate();
    check('its MF and OMF over every environment are the engine\'s', () => {
        assert.deepEqual(answer.mfs, vectors.map(v => engine.meritsAt(v).mf));
        assert.deepEqual(answer.omfs, vectors.map(v => engine.meritsAt(v).omf));
        assert.ok(relative(answer.mfs[0], shown.mf) <= 1e-12, 'the first vector is the design the table shows');
    });
}

console.log(`${pass} passed`);
