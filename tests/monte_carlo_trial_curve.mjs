/**
 * The Trial inspector's curve of one Monte Carlo trial (errorAnalysis/mcTrial.js
 * trialCurve), computed from the trial's record.
 *
 * Checks:
 *   1. It is the curve the run added for that trial, bit for bit: a run of one
 *      trial has it as its mean, and a run of two the mean of the first and
 *      second trials' curves; the design's curve given beside it is the run's
 *      theory. With thickness and index errors per material and n·d kept, and
 *      with per-layer index errors on a design with environments, in
 *      environment 1 and in environment 3, which is off and has its TiO2
 *      thinner.
 *   2. The analysis worker's evaluation gives the same curve.
 *   3. The inspector lists the trial's layers from the substrate, draws the
 *      Load button with its icon and splits the table from the plot.
 *
 * Run: node tests/monte_carlo_trial_curve.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { threeEnvironmentDesign } from './_environmentDesign.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { BUILTIN_COATINGS } = await import('../src/utils/coatingLibrary/builtin/index.js');
const { entryDesign } = await import('../src/utils/coatingLibrary/entryModel.js');
const { designMaterialLookup, embedDesignMaterials } = await import('../src/utils/materials/designMaterials.js');
const { runErrorAnalysisMC } = await import('../src/utils/physics/errorAnalysis.js');
const { trialCurve } = await import('../src/utils/physics/errorAnalysis/mcTrial.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { buildTrialDetailRows } = await import('../src/components/windows/analysis/errorAnalysis/trialModel.js');
const { TrialDetailsPanel } = await import('../src/components/windows/analysis/errorAnalysis/TrialDetailsPanel.js');
const { buildTrialOption } = await import('../src/components/windows/analysis/errorAnalysis/TrialPlot.js');

const entry = BUILTIN_COATINGS.find(e => e.materials && Object.keys(e.materials).length > 0);
const [a, b] = entry.bands[0];
const library = entryDesign(entry);
const libraryParams = { lambdaStart: a, lambdaEnd: b, lambdaStep: (b - a) / 40, theta: 0, polarization: 'avg' };
const ar = threeEnvironmentDesign();
const arParams = { lambdaStart: 420, lambdaEnd: 680, lambdaStep: 5, theta: 20, polarization: 'p' };
const CASES = [
    ['per material, n·d kept', library, libraryParams, {
        char: 'T', evalMode: 'front', seed: 31, rmsRelPct: 2, rmsReN: 0.004, rmsImN: 0.001,
        perMaterialErrors: true, keepOpticalThickness: true,
    }, ['base']],
    ['per layer, environment 1 and 3', ar, arParams, {
        char: 'R', evalMode: 'front', seed: 8, rmsRelPct: 1, rmsAbsNm: 0.5, rmsReN: 0.003, distribution: 'uniform',
        environments: ['base', 'env3'],
    }, ['base', 'env3']],
];
const run = (design, params, options, nTrials) =>
    runErrorAnalysisMC(design, params, designMaterialLookup(design), { ...options, nTrials, recordTrials: true });
const spreadOf = (result, id) => (result.environments ? result.environments.find(env => env.id === id) : result);

// ── 1. The run's own curve of the trial ─────────────────────────────────────
for (const [label, design, params, options, ids] of CASES) {
    const one = await run(design, params, options, 1);
    const two = await run(design, params, options, 2);
    for (const id of ids) {
        const curve = record => trialCurve(design, params, designMaterialLookup(design), { ...options, record, environment: id });
        const first = curve(two.trials[0]);
        const second = curve(two.trials[1]);
        assert.deepEqual(first.lambda, spreadOf(one, id).lambda, `${label}, ${id}: on the run's grid`);
        assert.deepStrictEqual(Array.from(first.values), spreadOf(one, id).mean, `${label}, ${id}: trial 1 is the curve a run of one trial has as its mean`);
        assert.deepStrictEqual(Array.from(first.values, (x, i) => x + (second.values[i] - x) / 2), spreadOf(two, id).mean,
            `${label}, ${id}: trial 2 is the curve a run of two adds after trial 1`);
        assert.deepStrictEqual(Array.from(first.design), spreadOf(one, id).theory, `${label}, ${id}: and beside it the design's own curve, the run's theory`);
    }
}

// ── 2. On the analysis worker ───────────────────────────────────────────────
{
    const [, design, params, options] = CASES[0];
    const { trials: [record] } = await run(design, params, options, 1);
    const payload = { design: embedDesignMaterials(design), params, char: options.char, evalMode: options.evalMode, record, environment: undefined };
    assert.deepStrictEqual(dispatchAnalysisEvaluation('trialCurve', payload),
        trialCurve(design, params, designMaterialLookup(design), { ...options, record }), 'the worker gives the same curve');
}

// ── 3. The inspector ────────────────────────────────────────────────────────
{
    const c = makeTheme();
    const t = makeLocale();
    const ea = t.errorAnalysis;
    const [, design, params, options] = CASES[0];
    const { trials } = await run(design, params, options, 1);
    const front = design.frontLayers;
    const rows = buildTrialDetailRows({ design, front, back: [], trial: trials[0], hasFront: true, hasBack: false });
    assert.deepEqual(rows.map(row => row.label), front.map((_, i) => `F${i + 1}`), 'the layers from the substrate, F1 first');
    assert.equal(rows[0].dThk, trials[0].dThkF[front.length - 1], 'each with its own error: F1 is the last layer stored');
    const html = renderToStaticMarkup(h(TrialDetailsPanel, {
        trials, selected: 0, setSelected: () => {}, trial: trials[0], loaded: null, loadThicknesses: () => {}, rows, c, t, ea,
        plotInputs: { design, params, char: options.char, evalMode: options.evalMode },
    }));
    assert.ok(/<button[^>]*>\s*<svg[\s\S]*?<\/svg>\s*Load thicknesses into design<\/button>/.test(html), 'the Load button draws its icon before its label');
    assert.equal((html.match(/row-resize/g) || []).length, 1, 'and a divider splits the table from the plot');

    const curve = trialCurve(design, params, designMaterialLookup(design), { ...options, record: trials[0] });
    const option = buildTrialOption({ curve, name: `${ea.trialN} 1`, designName: ea.chartTheoretical('T'), color: '#4fc3f7', c, lambdaAxis: 'λ (nm)' });
    assert.deepEqual(option.series.map(series => [series.name, series.lineStyle.type]), [['Trial 1', 'solid'], ['T theoretical', 'dashed']],
        'the plot draws the trial and, dashed, the design');
}

function h(...args) { return React.createElement(...args); }

console.log('PASS: monte_carlo_trial_curve');
