/**
 * The specification, Monte Carlo and Layer Sensitivity of a design with
 * environments (utils/environments/environmentSpecification.js,
 * physics/errorAnalysis):
 *
 *   1. Each check is judged in each environment it is judged in, on the design
 *      that environment sees: a check without env in every environment that
 *      is on, one with env there alone while it is on, nowhere when it is off.
 *      A check of every environment that fails in one fails; its value is the
 *      first environment's. A design without environments is judged by
 *      evaluateQualifiers alone. With no environment on, environment 1 judges.
 *   2. A tolerance window's recipe in each environment: a systematic deviation
 *      made on the recipe and seen in the environment, f·(d·s + o) thick, of the
 *      environment's material moved by the recipe material's Δn and Δk;
 *      interlayers between the environment's materials; environment 1 as before.
 *   3. Every route judges the same: the analysis worker's specification pass,
 *      with and without a recipe, the Report and the Coating Library.
 *   4. File rule 5 covers checks; Generate MF writes a check's env on its rows;
 *      deleting an environment deletes its checks in the same edit, and the
 *      last one gone drops env from every check.
 *   5. Monte Carlo: environment 1's spread on a design with environments is
 *      that of environment 1 without them; a trial in another environment is
 *      the trial coating built by hand there, f·(d + Δd) thick, of the
 *      environment's material moved by the same Δn and Δk; one run's spreads
 *      are those of separate runs with the same seed; the yield is the share of
 *      trials passing in every environment, and each environment's own yield
 *      counts its checks alone; a run on the analysis worker gives the result
 *      it gives here, a substrate only environment 2 names included.
 *   6. Layer Sensitivity: environment 1 on a design with environments is
 *      environment 1 without them, over its own rows; another environment's
 *      merit changes are those of the recipe step seen there as f·(d ± Δd);
 *      'all' is the merit over every environment that is on, MF² = (1/N) Σ
 *      MF_k², its starting value the optical merit the merit table shows; a
 *      design without environments takes no notice of env.
 *
 * Run: node tests/environments_specification_tolerance.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';
import designFile from '../src/main/designFile.js';

// WASM on this thread, its bytes kept for the worker, so both run one kernel.
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
await initTmmWasmMainThread(fs.readFileSync(TMMCORE_WASM_PATH), true);

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { oneEnvironmentDesign: loneDesign } = await import('./_environmentDesign.mjs');
const { environmentDesign, oneEnvironmentDesign } = await import('../src/utils/environments/environments.js');
const { evaluateSpecification } = await import('../src/utils/environments/environmentSpecification.js');
const { meanSquareMerit, rowsScoredIn } = await import('../src/utils/environments/environmentMerit.js');
const { removeEnvironment } = await import('../src/utils/environments/environmentEdits.js');
const { designMaterialLookup, embedDesignMaterials } = await import('../src/utils/materials/designMaterials.js');
const { evaluateQualifier, evaluateQualifiers, makeQualifier, qualifiersToMFOperands } = await import('../src/utils/synthesis/qualifiers.js');
const { emptyDeviation, deviatedDesignForSpec } = await import('../src/utils/physics/systematicDeviations.js');
const { wrapMaterial } = await import('../src/utils/misc/variator.js');
const { toleranceSpecInputs } = await import('../src/components/windows/analysis/toleranceSpecInputs.js');
const { buildSpecificationInputs } = await import('../src/components/windows/analysis/inhomogeneities/model.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { computeQualifiers } = await import('../src/utils/report/reportData/sectionData.js');
const { entrySpecResults, entryFromDesign, entryDesign, entryQualifiers } = await import('../src/utils/coatingLibrary/entryModel.js');
const { environmentPatch } = await import('../src/components/windows/design/environments/environmentFields.js');
const { runErrorAnalysisMC, computeLayerSensitivity } = await import('../src/utils/physics/errorAnalysis.js');
const { makeShiftedMaterial } = await import('../src/utils/physics/errorAnalysis/spectrumEval.js');
const { evaluateSpectrum } = await import('../src/utils/physics/thinFilmMath.js');
const { buildEvalContext, evaluateOperands, calcMF, withFringeSampleCounts } = await import('../src/utils/physics/optimizer.js');
const { meritTable } = await import('../src/utils/physics/meritDisplay.js');
const { startMonteCarloRun } = await import('../src/components/windows/analysis/errorAnalysis/monteCarloRun.js');

let pass = 0;
const check = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };
const relative = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

// A glass only environment 2 names, carried by the design and in no catalog.
const GLASS = { id: 'Glass', name: 'Glass', formulaNum: -1, tabData: [[300, 1.62, 0], [2000, 1.58, 0]] };
const lone = loneDesign();
const ENVIRONMENTS = [
    { id: 'base', name: 'BK7' },
    { id: 'env2', name: 'Under water', incidentMedium: 'builtin:H2O', substrate: { material: 'user_t:Glass' } },
    { id: 'env3', name: 'Dome edge', thicknessFactors: { 'builtin:TiO2': 0.95 }, materialSwaps: { 'builtin:MgF2': 'builtin:SiO2' } },
    { id: 'env4', name: 'Off', enabled: false, substrate: { material: 'builtin:Al2O3' } },
];
const withEnvironments = (qualifiers = [], environments = ENVIRONMENTS) => ({
    ...lone, materials: { 'user_t:Glass': GLASS }, environments, qualifiers,
});
const ON = ['base', 'env2', 'env3'];

const Q = {
    every: makeQualifier({ kind: 'R_AVG', lambdaStart: 420, lambdaEnd: 680, cmp: 'le', target: 0.05, label: 'every' }),
    water: makeQualifier({ kind: 'R_AT', lambda: 550, aoi: 30, cmp: 'le', target: 0.05, env: 'env2', label: 'water' }),
    off: makeQualifier({ kind: 'T_AVG', lambdaStart: 450, lambdaEnd: 650, cmp: 'ge', target: 0.9, env: 'env4', label: 'off' }),
    budget: makeQualifier({ kind: 'THICKNESS_BUDGET', side: 'front', cmp: 'ge', target: 198, label: 'budget' }),
    disabled: makeQualifier({ kind: 'R_AT', lambda: 600, cmp: 'le', target: 0.1, enabled: false }),
};
const design = withEnvironments(Object.values(Q));

// Check `q` judged apart on the design environment `id` sees.
const apart = (one, q, id) => {
    const seen = environmentDesign(one, id);
    return evaluateQualifier(q, seen, designMaterialLookup(seen));
};

// ── 1. Each check in each environment it is judged in ───────────────────────
{
    const results = evaluateSpecification(design.qualifiers, design);
    const [every, water, off, budget, disabled] = results;
    await check('a check without env is judged in every environment that is on, each on the design that environment sees', () => {
        assert.deepEqual(every.environments.map(({ number, id, name }) => [number, id, name]), [[1, 'base', 'BK7'], [2, 'env2', 'Under water'], [3, 'env3', 'Dome edge']]);
        every.environments.forEach(({ id, result }) => assert.deepStrictEqual(result, apart(design, Q.every, id), id));
        assert.ok(new Set(every.environments.map(({ result }) => result.value)).size === 3, 'and each environment reads its own value');
        assert.equal(every.value, apart(design, Q.every, 'base').value, 'its value is the first environment\'s');
    });
    await check('a check of environment 2 is judged on environment 2\'s design alone', () => {
        assert.deepEqual(water.environments.map(({ id }) => id), ['env2']);
        assert.deepStrictEqual({ ...water, environments: undefined }, { ...apart(design, Q.water, 'env2'), environments: undefined });
        assert.notEqual(water.value, apart(design, Q.water, 'base').value, 'not on environment 1\'s');
    });
    await check('a check of an environment that is off is judged nowhere and counts in no verdict', () => {
        assert.deepEqual(off, { value: null, pass: null, deviation: null, unit: '', summaryKey: 'environmentOff', environments: [] });
        assert.deepEqual(disabled, { value: null, pass: null, deviation: null, unit: '', summaryKey: 'disabled', environments: [] });
    });
    await check('a check of every environment that fails in one environment fails, with the first environment\'s value', () => {
        const values = budget.environments.map(({ result }) => [result.value, result.pass]);
        assert.deepEqual(values.map(([, passed]) => passed), [true, true, false], JSON.stringify(values));
        assert.ok(Math.abs(values[2][0] - (0.95 * (11.92 + 16.68) + 51.81 + 118.58)) < 1e-9, 'environment 3 adds up its layers f times as thick');
        assert.equal(budget.pass, false);
        assert.equal(budget.value, values[0][0]);
    });
}
await check('a design without environments is judged by evaluateQualifiers alone', () => {
    const checks = [Q.every, Q.budget, Q.disabled];
    const plain = { ...lone, qualifiers: checks };
    const results = evaluateSpecification(checks, plain);
    assert.deepStrictEqual(results, evaluateQualifiers(checks, plain, designMaterialLookup(plain)));
    assert.ok(results.every(result => !('environments' in result)));
});
await check('environment 1 off: a check of every environment is judged in those that are on, and one of environment 1 nowhere', () => {
    const base = makeQualifier({ kind: 'R_AT', lambda: 550, cmp: 'le', target: 0.05, env: 'base' });
    const firstOff = withEnvironments([Q.every, base], [{ ...ENVIRONMENTS[0], enabled: false }, ...ENVIRONMENTS.slice(1)]);
    const [every, ofBase] = evaluateSpecification(firstOff.qualifiers, firstOff);
    assert.deepEqual(every.environments.map(({ id }) => id), ['env2', 'env3']);
    assert.equal(every.value, apart(firstOff, Q.every, 'env2').value);
    assert.equal(ofBase.summaryKey, 'environmentOff');
});
await check('no environment on: a check of every environment is judged in environment 1', () => {
    const allOff = withEnvironments([Q.every], ENVIRONMENTS.map(env => ({ ...env, enabled: false })));
    const [every] = evaluateSpecification(allOff.qualifiers, allOff);
    assert.deepEqual(every.environments.map(({ id }) => id), ['base']);
});

// ── 2. A tolerance window's recipe in each environment ──────────────────────
const DEV = {
    ...emptyDeviation(), globalThicknessScale: 1.02, globalThicknessOffset: 1.5,
    perMaterial: { 'builtin:MgF2': { dn: 0.01, dk: 0.001, dScale: 1, dOffset: 0, dOffsetUnit: 'nm' } },
};
await check('a deviation in environment 3 is made on the recipe and seen there: f·(d·s + o), the swapped material moved by the recipe material\'s Δn and Δk', () => {
    const lookup = designMaterialLookup(design);
    const materials = new Map();
    const frontLayers = design.frontLayers.map((layer, i) => {
        const titania = layer.material === 'builtin:TiO2';
        const id = `hand:${i}`;
        materials.set(id, titania ? lookup('builtin:TiO2') : wrapMaterial(lookup('builtin:SiO2'), 0.01, 0.001));
        return { ...layer, material: id, thickness: (titania ? 0.95 : 1) * Math.max(0, layer.thickness * 1.02 + 1.5) };
    });
    const hand = { ...design, frontLayers };
    const resolve = id => materials.get(id) || lookup(id);
    const results = evaluateSpecification(design.qualifiers, design, {}, id => toleranceSpecInputs(design, { deviation: DEV }, id));
    for (const [i, q] of [[0, Q.every], [3, Q.budget]]) {
        const found = results[i].environments.find(({ id }) => id === 'env3').result;
        assert.deepStrictEqual(found, evaluateQualifier(q, hand, resolve), q.label);
    }
    const plain = { ...lone, qualifiers: [Q.every] };
    const before = deviatedDesignForSpec(plain, DEV, designMaterialLookup(plain));
    assert.deepStrictEqual(evaluateSpecification(plain.qualifiers, plain, {}, id => toleranceSpecInputs(plain, { deviation: DEV }, id)),
        evaluateQualifiers(plain.qualifiers, before.design, before.resolve), 'and a design without environments is judged as before');
});
await check('interlayers in environment 2 go between the materials that meet there', () => {
    const inh = { interlayers: [{ afterIndex: 1, thickness: 5, profile: 'linear', slices: 4, enabled: true }], backInterlayers: [] };
    const results = evaluateSpecification(design.qualifiers, design, {}, id => toleranceSpecInputs(design, { interlayers: inh }, id));
    const { specDesign, resolve } = buildSpecificationInputs(environmentDesign(design, 'env2'), inh);
    assert.deepStrictEqual(results[1].environments[0].result, evaluateQualifier(Q.water, specDesign, resolve));
});

// ── 3. Every route judges the same ──────────────────────────────────────────
await check('the analysis worker\'s specification pass, the Report and the Coating Library judge every environment', () => {
    const here = evaluateSpecification(design.qualifiers, design);
    const [worked] = dispatchAnalysisEvaluation('specification', { designs: [embedDesignMaterials(design)] });
    assert.deepStrictEqual(worked, here, 'the worker, on the design as it receives it');
    const [deviated] = dispatchAnalysisEvaluation('specification', { designs: [embedDesignMaterials(design)], deviation: DEV });
    assert.deepStrictEqual(deviated, evaluateSpecification(design.qualifiers, design, {}, id => toleranceSpecInputs(design, { deviation: DEV }, id)), 'and with a recipe');
    assert.deepStrictEqual(computeQualifiers(design).results, evaluateSpecification(design.qualifiers, design, { coarse: true }), 'the Report');
    const entry = { ...entryFromDesign(lone, 'front', { name: 'AR', band: [420, 680], spec: [{ kind: 'R_AVG', cmp: 'le', target: 0.05 }] }) };
    const coating = entryDesign(entry);
    assert.deepStrictEqual(entrySpecResults(entry).results, evaluateQualifiers(entryQualifiers(entry), coating, designMaterialLookup(coating)), 'the Coating Library, whose coatings have one environment');
});

// ── 4. The file, Generate MF and the environment edits ──────────────────────
await check('a check of environment 2 or later is written switched off with its switch in envEnabled, and read back on', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-env-spec-'));
    try {
        const ofBase = makeQualifier({ kind: 'R_AT', lambda: 500, env: 'base' });
        const offInTwo = { ...Q.water, id: 'q-off', enabled: false };
        const stored = withEnvironments([Q.every, Q.water, offInTwo, ofBase]);
        const file = path.join(tmp, 'checks.tfs');
        fs.writeFileSync(file, designFile.serializeDesign(stored));
        const written = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(written.qualifiers.map(q => [q.label, q.enabled, q.envEnabled]),
            [['every', true, undefined], ['water', false, true], ['water', false, false], ['', true, undefined]]);
        assert.deepEqual(designFile.readDesignFile(fs, file).design.qualifiers, stored.qualifiers);
        const plain = { ...lone, qualifiers: [Q.every] };
        assert.deepEqual(JSON.parse(designFile.serializeDesign(plain)).qualifiers, plain.qualifiers, 'a design without environments is written as before');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
await check('Generate MF writes a check\'s env on every row it gives', () => {
    const rows = qualifiersToMFOperands([Q.water, Q.every]);
    assert.deepEqual(rows.map(op => [op.type, op.env]), [['R', 'env2'], ['OPLT', 'env2'], ['RAV', undefined], ['OPLT', undefined]]);
});
await check('deleting an environment deletes its checks in the same edit, and the last one gone drops env from every check', () => {
    const ofBase = { ...Q.every, id: 'q-base', label: 'base', env: 'base' };
    const edited = withEnvironments([Q.every, Q.water, ofBase, Q.off]);
    const two = removeEnvironment(edited, 'env2');
    assert.deepEqual(two.qualifiers.map(q => q.label), ['every', 'base', 'off']);
    assert.deepEqual(environmentPatch(edited, two).qualifiers, two.qualifiers, 'the window writes them with the environments');
    const one = removeEnvironment(removeEnvironment(two, 'env3'), 'env4');
    assert.deepEqual(one.qualifiers.map(q => [q.label, 'env' in q]), [['every', false], ['base', false]], 'no check names an environment');
    assert.equal('environments' in one, false);
});

// ── 5. Monte Carlo ──────────────────────────────────────────────────────────
const PARAMS = { lambdaStart: 420, lambdaEnd: 680, lambdaStep: 20, theta: 0, polarization: 'avg' };
const SPREAD = ['lambda', 'theory', 'mean', 'stdev', 'lower', 'upper', 'envLower', 'envUpper'];
const spreadOf = result => Object.fromEntries(SPREAD.map(key => [key, result[key]]));
const mc = (one, opts) => runErrorAnalysisMC(one, PARAMS, designMaterialLookup(one), {
    char: 'R', evalMode: 'front', nTrials: 12, seed: 777, rmsRelPct: 3, rmsAbsNm: 0.5, rmsReN: 0.01, rmsImN: 0.002, ...opts,
});

await check('environment 1\'s spread on a design with environments is that of environment 1 without them, bit for bit', async () => {
    const run = await mc(withEnvironments());
    const alone = await mc(oneEnvironmentDesign(withEnvironments()));
    assert.deepStrictEqual(spreadOf(run), spreadOf(alone));
    assert.equal(alone.environments, null, 'a design without environments has no spreads of its own');
    assert.deepStrictEqual(run.environments, [{ number: 1, id: 'base', name: 'BK7', ...spreadOf(alone) }]);
});
await check('a trial in another environment is the trial coating built by hand there: f·(d + Δd), the environment\'s material moved by the same Δn and Δk', async () => {
    const one = withEnvironments();
    const lookup = designMaterialLookup(one);
    // Each environment's medium and substrate, and what it does to a layer of
    // `material`: its factor and the material it deposits.
    const BY_HAND = {
        env2: { medium: 'builtin:H2O', substrate: 'user_t:Glass', layer: material => [1, material] },
        env3: {
            medium: 'builtin:Air', substrate: 'builtin:BK7',
            layer: material => [material === 'builtin:TiO2' ? 0.95 : 1, material === 'builtin:MgF2' ? 'builtin:SiO2' : material],
        },
    };
    for (const [id, { medium, substrate, layer: seenAs }] of Object.entries(BY_HAND)) {
        const run = await mc(one, { nTrials: 1, recordTrials: true, environments: [id] });
        const [{ dThkF, dnF, dkF }] = run.trials;
        const layers = one.frontLayers.map((layer, i) => {
            const [factor, material] = seenAs(layer.material);
            return { material: makeShiftedMaterial(lookup(material), dnF[i], dkF[i]), thickness: factor * Math.max(0, layer.thickness + dThkF[i]) };
        }).filter(layer => layer.thickness > 0);
        const hand = evaluateSpectrum(PARAMS, lookup(medium), lookup(substrate), layers);
        assert.deepStrictEqual(run.mean, Array.from(hand.R), id);
        assert.notDeepStrictEqual(run.mean, (await mc(one, { nTrials: 1 })).mean, `${id} is not environment 1`);
    }
});
await check('one run\'s spreads in several environments are those of separate runs with the same seed', async () => {
    const one = withEnvironments();
    const run = await mc(one, { environments: ON });
    for (const [k, id] of ON.entries()) {
        const apartRun = await mc(one, { environments: [id] });
        const { number, id: listed, name, ...spread } = run.environments[k];
        assert.deepEqual([number, listed, name], [k + 1, id, ENVIRONMENTS[k].name]);
        assert.deepStrictEqual(spread, spreadOf(apartRun), id);
    }
    assert.deepStrictEqual(spreadOf(run), spreadOf(await mc(one)), 'the top-level spread is the first one\'s');
});
await check('the yield is the share of trials passing in every environment, and each environment\'s own yield counts its checks alone', async () => {
    const nominal = evaluateSpecification(design.qualifiers, design);
    // Targets at the design's own values, so the trials split.
    const every = { ...Q.every, target: Math.max(...nominal[0].environments.map(({ result }) => result.value)) };
    const water = { ...Q.water, target: nominal[1].value };
    const budget = { ...Q.budget, target: nominal[3].environments[2].result.value };
    const one = withEnvironments([every, water, budget]);
    const run = await mc(one, { nTrials: 40, rmsReN: 0, rmsImN: 0, evaluateSpec: true, qualifiers: one.qualifiers, recordTrials: true });
    const lookup = designMaterialLookup(one);
    const tally = { all: 0, base: 0, env2: 0, env3: 0 };
    for (const { dThkF } of run.trials) {
        const trial = { ...one, frontLayers: one.frontLayers.map((layer, i) => ({ ...layer, thickness: Math.max(0, layer.thickness + dThkF[i]) })) };
        const passes = {};
        for (const id of ON) {
            const seen = environmentDesign(trial, id);
            const judged = one.qualifiers.filter(q => q.env == null || q.env === id);
            passes[id] = evaluateQualifiers(judged, seen, lookup).every(result => result.pass === true);
            if (passes[id]) tally[id]++;
        }
        if (ON.every(id => passes[id])) tally.all++;
    }
    assert.ok(tally.all > 0 && tally.all < 40, `the trials split: ${tally.all}`);
    assert.equal(run.spec.passCount, tally.all);
    assert.equal(run.spec.yield, tally.all / 40);
    assert.deepEqual(run.spec.environments.map(({ number, id, name, passCount, evaluated, yield: share }) => [number, id, name, passCount, evaluated, share]),
        ON.map((id, k) => [k + 1, id, ENVIRONMENTS[k].name, tally[id], 40, tally[id] / 40]));
});
await check('a run on the analysis worker gives the result it gives here, a substrate only environment 2 names included', async () => {
    const one = withEnvironments([Q.every, Q.water]);
    const options = { char: 'R', evalMode: 'front', nTrials: 6, seed: 99, rmsRelPct: 2, rmsReN: 0.005, evaluateSpec: true, qualifiers: one.qualifiers, environments: ['env2', 'base'] };
    globalThis.Worker = NodeModuleWorker;
    const worked = await startMonteCarloRun(one, PARAMS, options).done;
    delete globalThis.Worker;
    assert.deepStrictEqual(worked, await runErrorAnalysisMC(one, PARAMS, designMaterialLookup(one), options));
    assert.deepEqual(worked.environments.map(({ id }) => id), ['env2', 'base']);
});

// ── 6. Layer Sensitivity ────────────────────────────────────────────────────
const ROWS = [...lone.meritOperands, { ...lone.meritOperands[1], id: 'r-water', lambdaStart: 500, lambdaEnd: 600, env: 'env2' }];
const sensitive = { ...withEnvironments(), meritOperands: ROWS };
const lookup = designMaterialLookup(sensitive);
const ABSOLUTE = { mode: 'absolute', absDeltaNm: 2 };
const OPTICAL = { skipConstraints: true };
const sampled = withFringeSampleCounts(ROWS, buildEvalContext(sensitive, lookup));

// Environment `id`'s merit over its rows with front layer `j` of the recipe
// `thickness` thick (none: as it is), seen in the environment.
function meritIn(id, j = -1, thickness = 0) {
    const recipe = { ...sensitive, frontLayers: sensitive.frontLayers.map((layer, i) => (i === j ? { ...layer, thickness } : layer)) };
    const rows = rowsScoredIn(sampled, id);
    return calcMF(rows, evaluateOperands(rows, buildEvalContext(oneEnvironmentDesign(recipe, id), lookup)), OPTICAL);
}
// The ranking's merit changes from `merit(j, thickness)`.
const changes = merit => sensitive.frontLayers.map((layer, j) => {
    const mf0 = merit(-1, 0);
    return (Math.abs(merit(j, layer.thickness + 2) - mf0) + Math.abs(merit(j, Math.max(0, layer.thickness - 2)) - mf0)) / 2;
});
const near = (got, want) => got.every((value, i) => relative(value, want[i]) < 1e-12);

await check('environment 1 on a design with environments is environment 1 without them, over its own rows', () => {
    const ranked = computeLayerSensitivity(sensitive, ROWS, lookup, ABSOLUTE);
    const alone = oneEnvironmentDesign(sensitive);
    assert.deepStrictEqual(ranked, computeLayerSensitivity(alone, rowsScoredIn(ROWS, 'base'), designMaterialLookup(alone), ABSOLUTE));
});
await check('another environment\'s merit changes are those of the recipe step seen there as f·(d ± Δd)', () => {
    const ranked = computeLayerSensitivity(sensitive, ROWS, lookup, { ...ABSOLUTE, env: 'env3' });
    assert.ok(relative(ranked.mf0, meritIn('env3')) < 1e-12);
    const want = changes((j, d) => meritIn('env3', j, d));
    assert.ok(near(ranked.rows.map(row => row.deltaMFAbs), want), JSON.stringify([ranked.rows.map(row => row.deltaMFAbs), want]));
    assert.deepEqual(ranked.rows.map(row => [row.thickness, row.deltaNm]), sensitive.frontLayers.map(layer => [layer.thickness, 2]), 'each row names the recipe thickness and step');
});
await check('\'all\' is the merit over every environment that is on, its starting value the optical merit the merit table shows', () => {
    const ranked = computeLayerSensitivity(sensitive, ROWS, lookup, { ...ABSOLUTE, env: 'all' });
    assert.ok(relative(ranked.mf0, meritTable(sensitive, ROWS).omf) < 1e-12, `${ranked.mf0} vs ${meritTable(sensitive, ROWS).omf}`);
    const want = changes((j, d) => meanSquareMerit(ON.map(id => meritIn(id, j, d))));
    assert.ok(near(ranked.rows.map(row => row.deltaMFAbs), want));
});
await check('a design without environments takes no notice of env', () => {
    const plain = loneDesign();
    const plainLookup = designMaterialLookup(plain);
    assert.deepStrictEqual(computeLayerSensitivity(plain, plain.meritOperands, plainLookup, { ...ABSOLUTE, env: 'all' }),
        computeLayerSensitivity(plain, plain.meritOperands, plainLookup, ABSOLUTE));
});

console.log(`${pass} passed`);
