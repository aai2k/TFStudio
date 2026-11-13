/**
 * The Specification, Monte Carlo, Layer Sensitivity and Systematic Deviations
 * windows on a design with environments:
 *
 *   1. Without environments no window draws an Env field, an Environment
 *      droplist or a note naming an environment; and a design whose only
 *      environment on is environment 1 renders the markup it renders without
 *      environments, those aside.
 *   2. Specification: each check has an Env field, All or one environment;
 *      its value and mark are those of the current environment, each computed
 *      apart on the design that environment sees; a check of another
 *      environment, and every check while the current environment is off,
 *      shows a dash and says why; the verdict counts every environment that is
 *      on and names the environments a failing check fails in; the Env field
 *      writes env and All takes it away.
 *   3. Monte Carlo: the droplist offers Current and each environment, no All;
 *      a run computes environment 1, every environment that is on and the one
 *      shown, environment 1's spread being the run's own; the window shows the
 *      spread of the environment chosen from the run it holds, and none where
 *      the run did not compute it; the statistics list each environment's own
 *      yield; the range notice reads the environment shown.
 *   4. Layer Sensitivity: the droplist with All in a row of its own between
 *      the table and the chart; the ranking probes the environment shown, or
 *      under All the merit over every environment that is on.
 *   5. Systematic Deviations: the droplist without All; the deviation made on
 *      the recipe and seen in the environment chosen equals the coating built
 *      by hand there, in every evaluation mode; a sweep the same at each step;
 *      the window computes the environment shown, and draws a sweep only in
 *      the environment it was run in.
 *   6. A check that passes in environment 1 and fails in environment 2: the
 *      tolerance verdict, with a deviation and with Layer Sensitivity's ±Δd
 *      designs, the Report's Detail and a Monte Carlo trial's record and chip
 *      name environment 2 and give its value.
 *
 * Run: node tests/environments_tolerance_windows.mjs
 */
import assert from 'node:assert/strict';
import './_kernel.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { oneEnvironmentDesign } = await import('./_environmentDesign.mjs');
const { environmentChoiceSession } = await import('../src/components/windows/analysis/chrome/environmentChoice.js');
const { currentEnvironmentSession } = await import('../src/components/windows/design/environments/currentEnvironment.js');
const { environmentDesign } = await import('../src/utils/environments/environments.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { designRangeCoverage } = await import('../src/utils/materials/materialRange.js');
const { makeQualifier, evaluateQualifier, qualifierSummary, qualifierValueText } = await import('../src/utils/synthesis/qualifiers.js');
const { SpecVerdict } = await import('../src/components/SpecVerdict.js');
const { toleranceSpecInputs } = await import('../src/components/windows/analysis/toleranceSpecInputs.js');
const { buildSpecDesigns } = await import('../src/components/windows/analysis/layerSensitivity/viewModel.js');
const { reportLocale } = await import('../src/components/windows/information/report/useReportWindow.js');
const { newBlock } = await import('../src/utils/report/blocks.js');
const { gatherDesignData } = await import('../src/utils/report/reportData.js');
const { composeReport } = await import('../src/utils/report/template.js');
const { atDefaultSteps } = await import('../src/utils/physics/meritDisplay.js');
const { runErrorAnalysisMC, computeLayerSensitivity } = await import('../src/utils/physics/errorAnalysis.js');
const { emptyDeviation, computeDeviatedSpectrum, deviatedSpectrumIn, runDeviationSweep, applyParamValue, cloneDeviation } = await import('../src/utils/physics/systematicDeviations.js');
// The deviated spectrum of `one` in environment `envId`.
const deviatedIn = (one, deviation, evalMode, resolveMat, envId) => deviatedSpectrumIn({ design: one, params: SD_PARAMS, deviation, evalMode, resolveMat, envId });
const { evaluateSpectrum, evaluateSpectrumTotal } = await import('../src/utils/physics/thinFilmMath.js');
const { wrapMaterial } = await import('../src/utils/misc/variator.js');
const SPEC = '../src/components/windows/design/specification';
const { Specification } = await import(`${SPEC}/Specification.js`);
const { setQualifierEnvIn } = await import(`${SPEC}/useSpecificationState.js`);
const EA = '../src/components/windows/analysis/errorAnalysis';
const { ErrorAnalysis } = await import(`${EA}/ErrorAnalysis.js`);
const { useErrorAnalysis, runEnvironments, shownSpread } = await import(`${EA}/useErrorAnalysis.js`);
const { errorAnalysisSession } = await import(`${EA}/sessionState.js`);
const { TrialsModal } = await import(`${EA}/TrialsModal.js`);
const { TrialDetailsPanel } = await import(`${EA}/TrialDetailsPanel.js`);
const LS = '../src/components/windows/analysis/layerSensitivity';
const { LayerSensitivity } = await import(`${LS}/LayerSensitivity.js`);
const { useLayerSensitivity, probedEnvironment } = await import(`${LS}/useLayerSensitivity.js`);
const { layerSensitivitySession } = await import(`${LS}/sessionState.js`);
const SD = '../src/components/windows/analysis/systematicDeviations';
const { SystematicDeviations } = await import(`${SD}/SystematicDeviations.js`);
const { useSystematicDeviations } = await import(`${SD}/useSystematicDeviations.js`);
const { systematicDeviationsSession } = await import(`${SD}/sessionState.js`);

const h = React.createElement;
const c = makeTheme();
const en = makeLocale('en');
const ts = en.specification;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const ENV = `>${en.environments.environment}</span>`;
// Whether `html` holds the option of `value`, labelled `label`, chosen.
const chosen = (html, value, label) => html.split('<option ').some(option => option.startsWith(`value="${value}"`)
    && option.includes(' selected=""') && option.includes(`>${label}</option>`));

// Environment 1 on BK7; 2 on sapphire; 3 switched off; 4 under water, its
// TiO2 0.9 times as thick and its MgF2 deposited as SiO2.
const ENVIRONMENTS = [
    { id: 'base', name: 'BK7' },
    { id: 'env2', name: 'Sapphire', substrate: { material: 'builtin:Al2O3' } },
    { id: 'env3', thicknessFactors: { 'builtin:TiO2': 0.95 }, enabled: false },
    { id: 'env4', name: 'Dome edge', incidentMedium: 'builtin:H2O', thicknessFactors: { 'builtin:TiO2': 0.9 }, materialSwaps: { 'builtin:MgF2': 'builtin:SiO2' } },
];
// The band check passes on BK7 and under water and fails on sapphire; the
// sapphire check passes there; the budget fails at the dome edge, where the
// TiO2 is thinner; a check of environment 3, which is off, is judged nowhere.
const CHECKS = [
    { ...makeQualifier({ kind: 'R_AVG', lambdaStart: 420, lambdaEnd: 680, cmp: 'le', target: 0.11, label: 'band' }), id: 'q-band' },
    { ...makeQualifier({ kind: 'R_AT', lambda: 550, aoi: 30, cmp: 'le', target: 0.2, env: 'env2', label: 'sapphire' }), id: 'q-sapphire' },
    { ...makeQualifier({ kind: 'THICKNESS_BUDGET', side: 'front', cmp: 'ge', target: 198, label: 'budget' }), id: 'q-budget' },
    { ...makeQualifier({ kind: 'T_AVG', lambdaStart: 450, lambdaEnd: 650, cmp: 'ge', target: 0.9, env: 'env3', label: 'off' }), id: 'q-off' },
    { ...makeQualifier({ kind: 'R_AT', lambda: 600, cmp: 'le', target: 0.1, enabled: false, label: 'disabled' }), id: 'q-disabled' },
];
const plainChecks = CHECKS.filter(q => q.env == null);
const lone = { ...oneEnvironmentDesign(), qualifiers: plainChecks };
const three = { ...oneEnvironmentDesign(), id: 'env-tolerance', environments: ENVIRONMENTS, qualifiers: CHECKS };
// Environment 1 the only one on: it computes and judges as the design without
// environments.
const firstOnly = {
    ...lone, id: 'env-first-only',
    environments: ENVIRONMENTS.map((env, i) => (i === 0 ? env : { ...env, enabled: false })),
};

// The current environment and the droplist's choice.
function shown(one, { current = 'base', choice = 'current' } = {}) {
    currentEnvironmentSession.write(one, { current });
    environmentChoiceSession.write(one, { choice });
}
// What a window's hook gives for `one` in the state `state`.
function hooked(useHook, one, state) {
    shown(one, state);
    let got = null;
    const Probe = () => { got = useHook(); return null; };
    renderToStaticMarkup(withDesign(h(Probe), one));
    return got;
}
function render(Window, one, state, t = en) {
    shown(one, state);
    return renderToStaticMarkup(withDesign(h(Window, { c, theme: c, t, setInputDialog: () => {} }), one));
}

// Check `q` judged apart in environment `id`, at the default steps the
// window's first pass reads.
function apart(one, q, id) {
    const seen = environmentDesign(one, id);
    return evaluateQualifier(q, seen, designMaterialLookup(seen), { coarse: true });
}
const badge = (mark, result) => `>${mark}  ${qualifierValueText(result, en.units)}</div>`;
const DASH = `>—  —</div>`;
const notJudged = n => `title="${esc(ts.notJudgedIn(n))}"`;

// The Env fields and the note naming the environment, which a design with
// environments adds to the Specification window.
const withoutEnvironmentParts = html => html
    .replace(/<label style="[^"]*"><span>Env<\/span><select[\s\S]*?<\/select><\/label>/g, '')
    .replace(/<div title="[^"]*" style="[^"]*">Values in environment [^<]*<\/div>/g, '');
// The Environment droplist, in the row under a plot.
const withoutDroplist = html => html.replace(/<label style="[^"]*"><span style="[^"]*">Environment<\/span>[\s\S]*?<\/select><\/label>/g, '');

let pass = 0;
const check = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

// ── 1. Without environments ─────────────────────────────────────────────────
const MC_PARAMS = { lambdaStart: 400, lambdaEnd: 700, lambdaStep: 10, theta: 0, polarization: 'avg' };
const mcOptions = (one, environments) => ({
    char: 'R', evalMode: 'front', nTrials: 8, seed: 31, rmsRelPct: 2, rmsReN: 0.003,
    evaluateSpec: true, qualifiers: one.qualifiers, recordTrials: true, ...(environments ? { environments } : {}),
});
const mcOf = (one, environments) => runErrorAnalysisMC(one, MC_PARAMS, designMaterialLookup(one), mcOptions(one, environments));

await check('without environments no window draws an Env field, a droplist or a note naming an environment', async () => {
    errorAnalysisSession.write(lone, { result: await mcOf(lone), showTable: true });
    for (const Window of [Specification, ErrorAnalysis, LayerSensitivity, SystematicDeviations]) {
        const html = render(Window, lone);
        assert.ok(!html.includes('<span>Env</span>') && !html.includes(ENV) && !html.includes('Values in environment') && !html.includes('Failing in'), Window.name);
    }
});
await check('a design whose only environment on is environment 1 renders the markup it renders without environments, those parts aside', async () => {
    const spec = render(Specification, firstOnly);
    assert.ok(spec.includes('<span>Env</span>') && spec.includes('Values in environment 1 · BK7'), 'the Specification window draws them');
    assert.equal(withoutEnvironmentParts(spec), render(Specification, lone), 'Specification');
    const ru = render(Specification, firstOnly, {}, makeLocale('ru'));
    assert.ok(ru.includes('<span>Окр.</span>') && ru.includes('Значения в окружении 1 · BK7'), 'in Russian, in its own words');
    const result = await mcOf(firstOnly, runEnvironments(firstOnly, 'base'));
    errorAnalysisSession.write(firstOnly, { result, seed: 31, showTable: true });
    errorAnalysisSession.write(lone, { result: await mcOf(lone), seed: 31, showTable: true });
    for (const Window of [ErrorAnalysis, LayerSensitivity, SystematicDeviations]) {
        const html = render(Window, firstOnly);
        assert.ok(html.includes(ENV), `${Window.name} draws the droplist`);
        assert.equal(withoutDroplist(html).replace('<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;row-gap:3px;padding:0 10px 3px;background-color:#252526;flex-shrink:0;user-select:none"><div style="margin-left:auto;display:flex;align-items:center;gap:6px"></div></div>', ''),
            render(Window, lone), Window.name);
    }
});

// ── 2. Specification ────────────────────────────────────────────────────────
const [band, sapphire, budget] = CHECKS;
await check('each check has an Env field: All, or one environment by its number and name', () => {
    const html = render(Specification, three);
    assert.equal(html.split('<span>Env</span>').length - 1, CHECKS.length);
    for (const label of ['All', '1 · BK7', '2 · Sapphire', '3', '4 · Dome edge']) assert.ok(html.includes(`>${label}</option>`), label);
    assert.ok(chosen(html, 'env2', '2 · Sapphire'), 'the sapphire check names its environment');
    assert.ok(!html.includes('<option value="all"'), 'and no window droplist');
    const gone = render(Specification, { ...three, qualifiers: [{ ...sapphire, env: 'env9' }] });
    assert.ok(chosen(gone, 'env9', ts.envGone) && /<option value="env9" disabled=""/.test(gone), 'a check naming an environment the design does not have says so');
});
await check('the values and marks are those of the current environment, each computed apart there', () => {
    const one = render(Specification, three);
    assert.ok(one.includes(badge('✓', apart(three, band, 'base'))) && one.includes(badge('✓', apart(three, budget, 'base'))), 'environment 1');
    const two = render(Specification, three, { current: 'env2' });
    assert.ok(two.includes(badge('✗', apart(three, band, 'env2'))) && two.includes(badge('✓', apart(three, sapphire, 'env2'))), 'environment 2');
    const four = render(Specification, three, { current: 'env4' });
    assert.ok(four.includes(badge('✓', apart(three, band, 'env4'))) && four.includes(badge('✗', apart(three, budget, 'env4'))), 'environment 4');
    assert.notEqual(apart(three, band, 'env2').value, apart(three, band, 'env4').value, 'each environment reads its own value');
});
await check('a check of another environment, and every check while the current environment is off, shows a dash and says why', () => {
    const one = render(Specification, three);
    assert.equal(one.split(`${notJudged(1)} style`).length - 1, 2, 'the sapphire check and the check of environment 3, which is off');
    const off = render(Specification, three, { current: 'env3' });
    assert.equal(off.split(`${notJudged(3)} style`).length - 1, CHECKS.length - 1, 'every enabled check while environment 3, which is off, is current');
    assert.equal(off.split(DASH).length - 1, CHECKS.length, 'each with no value and no mark');
    assert.ok(off.includes('Values in environment 3<'), 'the note names the environment');
});
await check('the verdict counts every environment that is on and names the environments a failing check fails in', () => {
    const html = render(Specification, three);
    assert.ok(html.includes(`1/3 ${ts.passingSuffix}`), 'band and budget fail, sapphire passes; off and disabled count nowhere');
    assert.ok(html.includes(`>${ts.failingIn(['2 · Sapphire', '4 · Dome edge'])}</div>`), 'band fails on sapphire, budget at the dome edge');
    assert.ok(html.includes('Values in environment 1 · BK7<'), 'and says which environment the values are read in');
    const onlyBudget = render(Specification, { ...three, qualifiers: [budget] });
    assert.ok(onlyBudget.includes(`>${ts.failingIn(['4 · Dome edge'])}</div>`) && onlyBudget.includes('Failing in environment 4 · Dome edge'), 'one environment by name');
});
await check('the Env field writes env, and All takes it away', () => {
    let written = null;
    const write = next => { written = next; };
    setQualifierEnvIn(CHECKS, write, 'q-band', 'env4');
    assert.deepEqual(written.map(q => q.env), ['env4', 'env2', undefined, 'env3', undefined]);
    setQualifierEnvIn(written, write, 'q-sapphire', null);
    assert.ok(!('env' in written[1]), 'All leaves no env key');
    assert.deepEqual({ ...written[1] }, (({ env, ...rest }) => rest)(sapphire)); // eslint-disable-line no-unused-vars
});

// ── 3. Monte Carlo ──────────────────────────────────────────────────────────
const SPREAD = ['lambda', 'theory', 'mean', 'stdev', 'lower', 'upper', 'envLower', 'envUpper'];
const run = await mcOf(three, runEnvironments(three, 'base'));
await check('a run computes every environment that is on and the one shown', () => {
    assert.deepEqual(runEnvironments(three, 'base'), ['base', 'env2', 'env4']);
    assert.deepEqual(runEnvironments(three, 'env3'), ['base', 'env2', 'env3', 'env4']);
    assert.equal(runEnvironments(lone, 'base'), undefined, 'a design without environments names none');
    assert.deepEqual(run.environments.map(({ id }) => id), ['base', 'env2', 'env4']);
});
await check('the window shows the spread of the environment chosen from the run it holds, and none where the run did not compute it', () => {
    errorAnalysisSession.write(three, { result: run, seed: 31, showTable: true });
    for (const [state, id] of [[{}, 'base'], [{ choice: 'env2' }, 'env2'], [{ current: 'env4' }, 'env4']]) {
        const got = hooked(() => useErrorAnalysis({ design: three, evalMode: 'front' }), three, state).shown;
        const spread = run.environments.find(entry => entry.id === id);
        assert.deepEqual(SPREAD.map(key => got[key]), SPREAD.map(key => spread[key]), id);
        assert.equal(got.spec, run.spec, `${id}: the yield is the run's`);
        assert.equal(got.trials, run.trials, `${id}: and so are the trials`);
    }
    assert.notDeepEqual(run.environments[1].mean, run.environments[0].mean, 'the environments spread apart');
    const html = render(ErrorAnalysis, three, { choice: 'env2' });
    assert.ok(html.includes(`>${(run.environments[1].mean[0] * 100).toFixed(4)}<`) && !html.includes(`>${(run.environments[0].mean[0] * 100).toFixed(4)}<`), 'the table reads environment 2');
    assert.equal(shownSpread(run, 'env3'), null, 'environment 3 was not computed');
    assert.ok(render(ErrorAnalysis, three, { choice: 'env3' }).includes(en.errorAnalysis.clickRun), 'so the window draws no spread for it');
    assert.equal(shownSpread({ ...run, environments: null }, 'base').mean, run.mean, 'a run without spreads of its own is environment 1\'s');
    assert.equal(shownSpread({ ...run, environments: null }, 'env2'), null);
});
await check('the droplist offers Current and each environment, no All', () => {
    const html = render(ErrorAnalysis, three);
    for (const label of ['Current (1)', '1 · BK7', '2 · Sapphire', '3', '4 · Dome edge']) assert.ok(html.includes(`>${label}</option>`), label);
    assert.ok(!html.includes(`>${en.analysisChrome.environmentAll}</option>`));
});
await check('the statistics list each environment\'s own yield', () => {
    const html = renderToStaticMarkup(withDesign(h(TrialsModal, {
        result: run, design: three, c, t: en, corridorSigma: 1, updateDesign: () => {}, checkpoint: () => {}, onClose: () => {},
    }), three));
    assert.equal(run.spec.environments.length, 3);
    for (const env of run.spec.environments) {
        const label = env.name ? `${env.number} · ${env.name}` : String(env.number);
        assert.ok(html.includes(`>${en.errorAnalysis.environmentYield(label)}<`), label);
        assert.ok(html.includes(`>${(env.yield * 100).toFixed(1)}%  (${env.passCount}/${env.evaluated})<`), `${label}: its share`);
    }
    const plain = renderToStaticMarkup(withDesign(h(TrialsModal, {
        result: errorAnalysisSession.read(lone).result, design: lone, c, t: en, corridorSigma: 1, updateDesign: () => {}, checkpoint: () => {}, onClose: () => {},
    }), lone));
    assert.ok(!plain.includes('Yield in environment'), 'none without environments');
});
await check('a run starts with environment 1, so its own curves, which the Report prints, are the design\'s', async () => {
    const firstOff = { ...three, id: 'env-first-off', environments: ENVIRONMENTS.map(env => (env.id === 'base' ? { ...env, enabled: false } : env)) };
    assert.deepEqual(runEnvironments(firstOff, 'env2'), ['base', 'env2', 'env4'], 'environment 1 though it is off and not shown');
    const off = await mcOf(firstOff, runEnvironments(firstOff, 'env2'));
    assert.deepEqual(SPREAD.map(key => off[key]), SPREAD.map(key => off.environments[0][key]));
    assert.deepEqual(off.mean, (await mcOf(firstOff, ['base'])).mean, 'environment 1\'s spread');
    assert.deepEqual(off.spec.environments.map(({ id }) => id), ['env2', 'env4'], 'while the yield judges the environments that are on');
});
await check('the range notice reads the environment shown', () => {
    const got = hooked(() => useErrorAnalysis({ design: three, evalMode: 'front' }), three, { choice: 'env2' });
    assert.deepEqual(got.shownDesign, environmentDesign(three, 'env2'));
    assert.deepEqual([designRangeCoverage(got.shownDesign, [300, 400]).offenders.length, designRangeCoverage(three, [300, 400]).offenders.length], [1, 2],
        'sapphire covers 300 nm, BK7 does not');
});

// ── 4. Layer Sensitivity ────────────────────────────────────────────────────
const SENSITIVITY = { mode: 'relative', relPct: 1, absDeltaNm: 1, includeLocked: false };
const rankingIn = env => computeLayerSensitivity(three, atDefaultSteps(three.meritOperands), designMaterialLookup(three), { ...SENSITIVITY, env });
await check('the droplist with All sits in a row of its own between the table and the chart', () => {
    layerSensitivitySession.write(three, { ...SENSITIVITY, showChart: true });
    const html = render(LayerSensitivity, three, { choice: 'all' });
    assert.ok(chosen(html, 'all', en.analysisChrome.environmentAll));
    const row = html.indexOf(ENV);
    assert.ok(row > html.indexOf('<table') && row < html.indexOf('<section'), 'under the table, over the chart strip');
});
await check('the ranking probes the environment shown, or under All the merit over every environment that is on', () => {
    layerSensitivitySession.write(three, SENSITIVITY);
    for (const [state, env] of [[{}, 'base'], [{ choice: 'env4' }, 'env4'], [{ current: 'env2' }, 'env2'], [{ choice: 'all' }, 'all']]) {
        const got = hooked(useLayerSensitivity, three, state);
        assert.equal(probedEnvironment(got.environment), env);
        const want = rankingIn(env);
        assert.deepEqual([got.result.mf0, got.result.rows], [want.mf0, want.rows], env);
    }
    assert.notDeepEqual(rankingIn('all').rows.map(row => row.deltaMFAbs), rankingIn('base').rows.map(row => row.deltaMFAbs), 'All is not environment 1');
    assert.equal(probedEnvironment(hooked(useLayerSensitivity, lone, { choice: 'all' }).environment), null, 'a design without environments probes none');
});

// ── 5. Systematic Deviations ────────────────────────────────────────────────
const DEV = {
    ...emptyDeviation(), globalThicknessScale: 1.02, globalThicknessOffset: 1.5,
    perMaterial: {
        'builtin:MgF2': { dn: 0.01, dk: 0.001, dScale: 1, dOffset: 0, dOffsetUnit: 'nm' },
        'builtin:BK7': { dn: 0.002, dk: 0, dScale: 1, dOffset: 0, dOffsetUnit: 'nm' },
    },
};
const SD_PARAMS = { lambdaStart: 400, lambdaEnd: 700, lambdaStep: 5, theta: 20, polarization: 'avg' };
const lookup = designMaterialLookup(three);
// The coating environment `id` deposits with DEV made on the recipe, by hand:
// each layer f·(d·s + o) thick, of the material the environment deposits for
// it, moved by the Δn and Δk of the recipe's material; the media each moved by
// their own entry.
function deviatedByHand(id) {
    const env = ENVIRONMENTS.find(entry => entry.id === id);
    const factor = material => env.thicknessFactors?.[material] ?? 1;
    const layers = three.frontLayers.map(layer => {
        const own = DEV.perMaterial[layer.material] || { dn: 0, dk: 0 };
        const material = env.materialSwaps?.[layer.material] ?? layer.material;
        return { material: wrapMaterial(lookup(material), own.dn, own.dk), thickness: factor(layer.material) * (layer.thickness * 1.02 + 1.5) };
    });
    const medium = material => wrapMaterial(lookup(material), DEV.perMaterial[material]?.dn ?? 0, DEV.perMaterial[material]?.dk ?? 0);
    const incident = medium(env.incidentMedium ?? three.incidentMedium);
    const substrate = medium(env.substrate?.material ?? three.substrate.material);
    return {
        front: evaluateSpectrum(SD_PARAMS, incident, substrate, layers),
        total: evaluateSpectrumTotal(SD_PARAMS, incident, substrate, medium(three.exitMedium), layers, [], three.substrate.thickness),
    };
}
await check('the deviation made on the recipe and seen in the environment equals the coating built by hand there', () => {
    for (const id of ['env2', 'env4', 'env3']) {
        const hand = deviatedByHand(id);
        assert.deepStrictEqual(deviatedIn(three, DEV, 'front', lookup, id), hand.front, `${id}, the coated side`);
        assert.deepStrictEqual(deviatedIn(three, DEV, 'total', lookup, id), hand.total, `${id}, the whole part`);
    }
    assert.deepStrictEqual(deviatedIn(three, DEV, 'front', lookup, 'base'),
        computeDeviatedSpectrum(lone, SD_PARAMS, DEV, 'front', designMaterialLookup(lone)), 'environment 1 is the design itself');
    assert.notDeepStrictEqual(deviatedByHand('env4').front.R, deviatedIn(three, DEV, 'front', lookup).R, 'and environment 4 is not');
});
await check('a sweep in an environment is the deviated spectrum there at each step', () => {
    const sweep = { param: 'mat:builtin:MgF2:dn', from: -0.02, to: 0.02, steps: 3 };
    const result = runDeviationSweep({ design: three, params: SD_PARAMS, baseDev: DEV, sweep, evalMode: 'front', resolveMat: lookup, envId: 'env4' });
    result.paramValues.forEach((value, k) => {
        const dev = cloneDeviation(DEV);
        applyParamValue(dev, sweep.param, value);
        assert.deepStrictEqual(result.R2D[k], deviatedIn(three, dev, 'front', lookup, 'env4').R, `step ${k}`);
    });
});
await check('the window computes the environment shown, offers no All, and draws a sweep only in the environment it was run in', () => {
    systematicDeviationsSession.write(three, { dev: DEV, mode: 'single', lambdaStart: 400, lambdaEnd: 700, lambdaStep: 5, aoi: 20, pol: 'avg' });
    const got = hooked(useSystematicDeviations, three, { choice: 'env4' });
    assert.deepStrictEqual(got.deviated, deviatedIn(three, DEV, 'front', lookup, 'env4'));
    assert.deepStrictEqual(got.baseline, deviatedIn(three, emptyDeviation(), 'front', lookup, 'env4'));
    assert.deepEqual(got.shownDesign, environmentDesign(three, 'env4'));
    const html = render(SystematicDeviations, three, { choice: 'env4' });
    assert.ok(chosen(html, 'env4', '4 · Dome edge') && !html.includes(`>${en.analysisChrome.environmentAll}</option>`));
    const swept = { ...runDeviationSweep({ design: three, params: SD_PARAMS, baseDev: emptyDeviation(), sweep: { param: 'globalThicknessScale', from: 0.98, to: 1.02, steps: 3 }, evalMode: 'front', resolveMat: lookup, envId: 'env4' }), param: 'globalThicknessScale', offsetUnit: 'nm', envId: 'env4' };
    systematicDeviationsSession.write(three, { mode: 'sweep', sweepResult: swept });
    assert.equal(hooked(useSystematicDeviations, three, { choice: 'env4' }).sweepResult, swept, 'the sweep in its own environment');
    assert.equal(hooked(useSystematicDeviations, three, {}).sweepResult, null, 'none in environment 1');
    assert.equal(systematicDeviationsSession.read(three).sweepResult, swept, 'kept for when environment 4 is shown again');
    systematicDeviationsSession.write(three, { mode: 'single', sweepResult: null });
});

// ── 6. A check that fails in a later environment alone ──────────────────────
// R ≥ 5 % across the band: about 9.5 % on BK7 in air, 4.5 % under water. Its
// own value is environment 1's, which passes; what explains its failure is
// environment 2's.
const wet = {
    ...oneEnvironmentDesign(), id: 'env-wet',
    environments: [{ id: 'base', name: 'BK7' }, { id: 'env2', name: 'Under water', incidentMedium: 'builtin:H2O' }],
    qualifiers: [{ ...makeQualifier({ kind: 'R_AVG', lambdaStart: 420, lambdaEnd: 680, cmp: 'ge', target: 0.05, label: 'band' }), id: 'q-wet' }],
};
const [wetCheck] = wet.qualifiers;
const failingText = result => `${ts.failingIn(['2 · Under water'])}: ${qualifierSummary(result, ts.summaries, en.units)}`;
// Check `q` on `one` in environment `id` with the tolerance window's `recipe`,
// at the default steps.
const recipeIn = (one, q, recipe, id) => {
    const { design: judged, resolve } = toleranceSpecInputs(one, recipe, id);
    return evaluateQualifier(q, judged, resolve, { coarse: true });
};
await check('the tolerance verdict names the environment a check fails in, with that environment\'s value', () => {
    const inAir = apart(wet, wetCheck, 'base');
    const underWater = apart(wet, wetCheck, 'env2');
    assert.ok(inAir.pass && !underWater.pass, 'it passes in air and fails under water');
    const html = renderToStaticMarkup(withDesign(h(SpecVerdict, { design: wet, c, t: en, label: 'Spec:' }), wet));
    assert.ok(html.includes(`title="${esc(failingText(underWater))}"`), 'the failing chip speaks for environment 2');
    assert.ok(html.includes(esc(`✗ band: ${qualifierValueText(underWater, en.units)} (2 · Under water)`)), 'and so does the verdict\'s list');
    const DEVIATED = { ...emptyDeviation(), globalThicknessScale: 1.01 };
    const deviated = renderToStaticMarkup(withDesign(h(SpecVerdict, { design: wet, deviation: DEVIATED, c, t: en, label: 'Spec:' }), wet));
    assert.ok(deviated.includes(`title="${esc(failingText(recipeIn(wet, wetCheck, { deviation: DEVIATED }, 'env2')))}"`), 'with a deviation, made on the recipe and seen under water');
    const probed = buildSpecDesigns(wet, 'relative', 1, 1);
    const ranked = renderToStaticMarkup(withDesign(h(SpecVerdict, { designs: probed, c, t: en, label: 'Spec:' }), wet));
    assert.ok(ranked.includes(`title="${esc(failingText(apart(probed[0], wetCheck, 'env2')))}"`), 'and Layer Sensitivity\'s ±Δd designs, judged in every environment');
});
await check('the Report\'s Detail names the environment a check fails in, with that environment\'s value', () => {
    const blocks = [newBlock('qualifiers')];
    const html = composeReport({ lang: 'en', tr: reportLocale('en'), blocks, designs: [{ design: wet, data: gatherDesignData(wet, blocks) }] });
    assert.ok(html.includes(esc(failingText(apart(wet, wetCheck, 'env2')))), 'Detail');
    const plain = { ...lone, qualifiers: [wetCheck] };
    const plainHtml = composeReport({ lang: 'en', tr: reportLocale('en'), blocks, designs: [{ design: plain, data: gatherDesignData(plain, blocks) }] });
    assert.ok(!plainHtml.includes('Failing in'), 'and names none without environments');
});
await check('a Monte Carlo trial records the value of the environment a check fails in, and that environment', async () => {
    const mc = await runErrorAnalysisMC(wet, MC_PARAMS, designMaterialLookup(wet), {
        char: 'R', evalMode: 'front', nTrials: 3, seed: 5, rmsRelPct: 0.5,
        evaluateSpec: true, qualifiers: wet.qualifiers, recordTrials: true, environments: ['base', 'env2'],
    });
    for (const trial of mc.trials) {
        const [record] = trial.spec.results;
        assert.deepEqual([record.pass, record.env], [false, { number: 2, name: 'Under water' }]);
        assert.ok(record.value < 0.05, `the value under water, not the passing one in air: ${record.value}`);
    }
    const [first] = mc.trials;
    const html = renderToStaticMarkup(h(TrialDetailsPanel, {
        trials: mc.trials, selected: 0, setSelected: () => {}, trial: first, loaded: null, loadThicknesses: () => {},
        rows: [], c, t: en, ea: en.errorAnalysis,
    }));
    assert.ok(html.includes(esc(`✗ band = ${qualifierValueText(first.spec.results[0], en.units)} (2 · Under water)`)), 'and the trial\'s chip names it');
});

console.log(`${pass} passed`);
