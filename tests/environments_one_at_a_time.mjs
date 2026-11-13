/**
 * The six windows that show one environment at a time, on a design with
 * environments: Pulse Analysis, Inhomogeneities, Roughness / Scattering,
 * Layer Thicknesses, Stress and the wavelength-angle map.
 *
 *   1. Without environments none draws an Environment droplist, and Pulse
 *      Analysis and Layer Thicknesses draw no row under the plot; a design
 *      whose only environment on is environment 1 renders what it renders
 *      without environments, the droplist and its row aside.
 *   2. The droplist offers Current and each environment, no All, and a choice
 *      naming an environment the design no longer has reads as Current.
 *   3. Each window computes the environment shown, on what that environment
 *      is scored on: its result equals the same computed on that
 *      environment's design apart, with a thickness factor, a swap, another
 *      medium, the whole part and a temperature. Pulse Analysis gives the
 *      worker that design and reads the GDD rows scored there; the map's
 *      surface workers draw an environment at another temperature as the
 *      main thread draws it; the interlayer and roughness editors name the
 *      environment's media and substrate; the material range notice reads
 *      the environment shown.
 *   4. Stress: a field the environment shown holds a value of its own for
 *      shows that value to five figures, is not editable and says why; the
 *      others edit the design's own, the stress temperature included while
 *      the design states no stress run.
 *
 * Run: node tests/environments_one_at_a_time.mjs
 */
import assert from 'node:assert/strict';
import './_kernel.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { oneEnvironmentDesign: arDesign } = await import('./_environmentDesign.mjs');
const { environmentChoiceSession } = await import('../src/components/windows/analysis/chrome/environmentChoice.js');
const { currentEnvironmentSession } = await import('../src/components/windows/design/environments/currentEnvironment.js');
const { environmentDesign, oneEnvironmentDesign } = await import('../src/utils/environments/environments.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { designRangeCoverage, rangeMaterials } = await import('../src/utils/materials/materialRange.js');
const { resolveEvalMode } = await import('../src/utils/physics/optimizer.js');
const { computeSurface } = await import('../src/utils/physics/plotQuantities.js');
const { designInterfaces } = await import('../src/components/windows/analysis/designInterfaces.js');
const W = '../src/components/windows/analysis';
const { PulseAnalysis } = await import(`${W}/pulseAnalysis/PulseAnalysis.js`);
const { usePulseAnalysis } = await import(`${W}/pulseAnalysis/usePulseAnalysis.js`);
const { pulseSession } = await import(`${W}/pulseAnalysis/sessionState.js`);
const { Inhomogeneities } = await import(`${W}/inhomogeneities/Inhomogeneities.js`);
const { useInhomogeneities } = await import(`${W}/inhomogeneities/useInhomogeneities.js`);
const { inhomogeneitySpectraState } = await import(`${W}/inhomogeneities/model.js`);
const { inhomogeneityDesignSession, inhomogeneityViewSession } = await import(`${W}/inhomogeneities/sessionState.js`);
const { RoughnessScattering } = await import(`${W}/roughnessScattering/RoughnessScattering.js`);
const { useRoughnessScattering } = await import(`${W}/roughnessScattering/useRoughnessScattering.js`);
const { calculateRoughness } = await import(`${W}/roughnessScattering/model.js`);
const { roughnessDesignSession, roughnessViewSession } = await import(`${W}/roughnessScattering/sessionState.js`);
const { LayerThicknesses } = await import(`${W}/layerThicknesses/LayerThicknesses.js`);
const { useThicknessState } = await import(`${W}/layerThicknesses/useThicknessState.js`);
const { computeThicknessRows } = await import(`${W}/layerThicknesses/thicknessModel.js`);
const { StressAnalysis } = await import(`${W}/stressAnalysis/StressAnalysis.js`);
const { useStressAnalysis } = await import(`${W}/stressAnalysis/useStressAnalysis.js`);
const { computeStress } = await import(`${W}/stressAnalysis/model.js`);
const { WavelengthAngleMap } = await import(`${W}/wavelengthAngleMap/WavelengthAngleMap.js`);
const { useWavelengthAngleMap } = await import(`${W}/wavelengthAngleMap/useWavelengthAngleMap.js`);
const { runSurfaceSweep } = await import(`${W}/plotEngine/surfaceRunner.js`);
const { standInSurfaceWorker } = await import('./_surfaceWorker.mjs');

const h = React.createElement;
const c = makeTheme();
const en = makeLocale('en');
const ENV = `>${en.environments.environment}</span>`;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const chosen = (html, value, label) => html.split('<option ').some(option => option.startsWith(`value="${value}"`)
    && option.includes(' selected=""') && option.includes(`>${label}</option>`));

// A glass that expands and whose index moves with temperature, the
// substrate of environment 3, so the environment at 80 °C changes its
// thickness and its index (environmentTemperature.js).
const GLASS = { name: 'Expanding glass', formulaNum: -1, tabData: [[300, 1.53, 0], [1500, 1.50, 0]], mechanical: { linearExpansionPerK: 9e-6, dnDtPerK: 3e-6 } };
// Environment 1 on BK7; 2 the dome edge under water, its TiO2 0.9 times as
// thick, its MgF2 deposited as SiO2, scored as the whole part; 3 at 80 °C on
// the expanding glass; 4 switched off.
const ENVIRONMENTS = [
    { id: 'base', name: 'BK7' },
    { id: 'env2', name: 'Dome edge', incidentMedium: 'builtin:H2O', thicknessFactors: { 'builtin:TiO2': 0.9 }, materialSwaps: { 'builtin:MgF2': 'builtin:SiO2' }, mfEvalMode: 'total' },
    { id: 'env3', name: 'Hot', temperatureC: 80, substrate: { material: 'user_heat:Glass' } },
    { id: 'env4', name: 'Edge', thicknessFactors: { 'builtin:TiO2': 0.95 }, enabled: false },
];
// GDD rows: one of every environment, one of environment 2 alone.
const GDD_ROWS = [
    { id: 'g1', type: 'GDD', lambdaStart: 550, target: 20, weight: 1, enabled: true },
    { id: 'g2', type: 'GDD', lambdaStart: 550, target: 40, weight: 1, enabled: true, env: 'env2' },
];
const lone = {
    ...arDesign(), id: 'one-at-a-time-lone', meritOperands: [GDD_ROWS[0]],
    stress: { temperatureC: 20, depositionTemperatureC: 250 }, materials: { 'user_heat:Glass': GLASS },
};
const four = { ...lone, id: 'one-at-a-time', environments: ENVIRONMENTS, meritOperands: GDD_ROWS };
// Environment 1 the only one on: it computes as the design without environments.
const firstOnly = { ...lone, id: 'one-at-a-time-first', environments: ENVIRONMENTS.map((env, i) => (i === 0 ? env : { ...env, enabled: false })) };

const INTERLAYERS = { interlayers: [{ afterIndex: 3, thickness: 4, profile: 'linear', slices: 10, enabled: true }], backInterlayers: [] };
const ROUGH = { mode: 'uniform', sigma: 2, range: 'short', sigmas: [], backSigmas: [], ranges: [], backRanges: [] };
const RANGE = { lambdaStart: 450, lambdaEnd: 650, lambdaStep: 10, aoi: 0 };
const PARAMS = { lambdaStart: 450, lambdaEnd: 650, lambdaStep: 10, theta: 0, polarization: 'avg' };
function sessions(one) {
    inhomogeneityDesignSession.write(one, { inh: INTERLAYERS });
    inhomogeneityViewSession.write(one, RANGE);
    roughnessDesignSession.write(one, { rough: ROUGH });
    roughnessViewSession.write(one, RANGE);
    pulseSession.write(one, { centerWavelength: 550, duration: 20, side: 'front', target: 'R' });
}
for (const one of [lone, four, firstOnly]) sessions(one);

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

const WINDOWS = [PulseAnalysis, Inhomogeneities, RoughnessScattering, LayerThicknesses, StressAnalysis, WavelengthAngleMap];
// The row under the plot that holds the droplist alone, in a window with no
// badge of its own.
const ROW_ALONE = '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;row-gap:3px;padding:0 10px 3px;background-color:#252526;flex-shrink:0;user-select:none"><div style="margin-left:auto;display:flex;align-items:center;gap:6px"></div></div>';
const withoutDroplist = html => html.replace(/<label style="[^"]*"><span style="[^"]*">Environment<\/span>[\s\S]*?<\/select><\/label>/g, '').replace(ROW_ALONE, '');

let pass = 0;
const check = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

// ── 1. Without environments ─────────────────────────────────────────────────
await check('without environments no window draws a droplist, and Pulse Analysis and Layer Thicknesses no row under the plot', () => {
    for (const Window of WINDOWS) {
        const html = render(Window, lone);
        assert.ok(!html.includes(ENV), Window.name);
    }
    for (const Window of [PulseAnalysis, LayerThicknesses]) assert.ok(!render(Window, lone).includes('padding:0 10px 3px'), Window.name);
});
await check('a design whose only environment on is environment 1 renders what it renders without environments, the droplist and its row aside', () => {
    for (const Window of WINDOWS) {
        const html = render(Window, firstOnly);
        assert.ok(html.includes(ENV), `${Window.name} draws the droplist`);
        assert.equal(withoutDroplist(html), render(Window, lone), Window.name);
    }
});

// ── 2. The droplist ─────────────────────────────────────────────────────────
await check('the droplist offers Current and each environment, no All', () => {
    for (const Window of WINDOWS) {
        const html = render(Window, four, { choice: 'env3' });
        for (const label of ['Current (1)', '1 · BK7', '2 · Dome edge', '3 · Hot', '4 · Edge']) assert.ok(html.includes(`>${label}</option>`), `${Window.name}: ${label}`);
        assert.ok(chosen(html, 'env3', '3 · Hot'), `${Window.name}: the choice`);
        assert.ok(!html.includes(`>${en.analysisChrome.environmentAll}</option>`), `${Window.name}: no All`);
    }
});
await check('a choice naming an environment the design no longer has reads as Current, which follows the current environment', () => {
    const stale = hooked(() => useThicknessState(four), four, { choice: 'env9', current: 'env2' }).environment;
    assert.deepEqual([stale.choice, stale.views[0].id], ['current', 'env2']);
    assert.ok(chosen(render(LayerThicknesses, four, { choice: 'env9', current: 'env2' }), 'current', 'Current (2)'));
});

// ── 3. Each window computes the environment shown ───────────────────────────
const apart = id => oneEnvironmentDesign(four, id);
await check('Pulse Analysis gives the worker the design the environment shown sees, and From target reads the GDD rows scored there', () => {
    for (const [state, id] of [[{}, 'base'], [{ choice: 'env2' }, 'env2'], [{ current: 'env3' }, 'env3'], [{ choice: 'env4' }, 'env4']]) {
        const got = hooked(() => usePulseAnalysis(four), four, state);
        assert.deepEqual(got.payload.design, environmentDesign(four, id), id);
        assert.deepEqual(rangeMaterials(got.shownDesign, 'front'), rangeMaterials(apart(id), 'front'), `${id}: the range notice`);
    }
    assert.equal(hooked(() => usePulseAnalysis(four), four, {}).gddTarget, 20, 'environment 1 has the row of every environment');
    assert.equal(hooked(() => usePulseAnalysis(four), four, { choice: 'env2' }).gddTarget, 30, 'environment 2 has its own row too');
    assert.equal(hooked(() => usePulseAnalysis(lone), lone, {}).payload.design, lone, 'a design without environments is the payload itself');
});
await check('Inhomogeneities computes the environment shown, on what it is scored on, its interfaces named by its own media and substrate', () => {
    for (const [state, id] of [[{ choice: 'env2' }, 'env2'], [{ choice: 'env3' }, 'env3'], [{}, 'base']]) {
        const got = hooked(() => useInhomogeneities(en.inhomogeneities), four, state);
        const mode = resolveEvalMode(apart(id));
        const want = inhomogeneitySpectraState({ design: apart(id), params: PARAMS, inh: INTERLAYERS, evalMode: mode });
        assert.deepStrictEqual([got.baseline, got.perturbed, got.evalMode], [want.baseline, want.perturbed, mode], id);
        assert.deepEqual(got.interfaces, designInterfaces(apart(id), en.inhomogeneities), `${id}: interfaces`);
        assert.deepEqual(got.shownDesign, environmentDesign(four, id), `${id}: the range notice`);
    }
    assert.equal(hooked(() => useInhomogeneities(en.inhomogeneities), four, { choice: 'env2' }).evalMode, 'total', 'environment 2 is scored as the whole part');
    // The editor numbers the layers and names the media and the substrate.
    const names = id => hooked(() => useInhomogeneities(en.inhomogeneities), four, { choice: id }).interfaces.front.map(i => i.label);
    assert.deepEqual([names('base')[0], names('env2')[0], names('env3').at(-1)], ['Air → L4', 'H2O (Water) → L4', 'L1 → Expanding glass'],
        'each environment\'s medium and substrate');
});
await check('Roughness / Scattering computes the environment shown, on what it is scored on, under its own names', () => {
    for (const [state, id] of [[{ choice: 'env2' }, 'env2'], [{ current: 'env3' }, 'env3'], [{}, 'base']]) {
        const got = hooked(() => useRoughnessScattering(en.roughnessScattering), four, state);
        const mode = resolveEvalMode(apart(id));
        assert.deepStrictEqual(got.calc, calculateRoughness({ design: apart(id), params: PARAMS, rough: ROUGH, evalMode: mode }).data, id);
        assert.deepEqual(got.labels, designInterfaces(apart(id), en.roughnessScattering), `${id}: interfaces`);
        assert.deepEqual(got.shownDesign, environmentDesign(four, id), `${id}: the range notice`);
    }
    assert.notDeepEqual(hooked(() => useRoughnessScattering(en.roughnessScattering), four, { choice: 'env2' }).calc.specular.R,
        hooked(() => useRoughnessScattering(en.roughnessScattering), four, {}).calc.specular.R, 'environment 2 is not environment 1');
});
await check('Layer Thicknesses lists each layer as the environment shown deposits it', () => {
    for (const [state, id] of [[{ choice: 'env2' }, 'env2'], [{ choice: 'env4' }, 'env4'], [{}, 'base']]) {
        const got = hooked(() => useThicknessState(four), four, state);
        assert.deepEqual(got.rows, computeThicknessRows(apart(id), 'front', 550), id);
    }
    // Numbered from the substrate: the front is stored air side first.
    const rows = hooked(() => useThicknessState(four), four, { choice: 'env2' }).rows;
    assert.deepEqual(rows.map(row => [row.layerNumber, row.materialId, row.d]),
        [[1, 'builtin:SiO2', 118.58], [2, 'builtin:TiO2', 16.68 * 0.9], [3, 'builtin:SiO2', 51.81], [4, 'builtin:TiO2', 11.92 * 0.9]],
        'the recipe\'s layers, TiO2 thinner and MgF2 deposited as SiO2');
    const html = render(LayerThicknesses, four, { choice: 'env2' });
    assert.ok(html.indexOf(ENV) > 0 && html.indexOf(ENV) < html.indexOf('<section'), 'the droplist sits over the Results strip');
});
await check('Stress computes the films and the substrate of the environment shown, at its temperature', () => {
    for (const [state, id] of [[{ choice: 'env3' }, 'env3'], [{ choice: 'env2' }, 'env2'], [{}, 'base']]) {
        const got = hooked(useStressAnalysis, four, state);
        const seen = apart(id);
        assert.deepStrictEqual(got.result, computeStress(seen, resolveEvalMode(seen)), id);
    }
    const hot = hooked(useStressAnalysis, four, { choice: 'env3' });
    assert.deepEqual([hot.temperatureC, hot.depositionTemperatureC, hot.result.run.temperatureC], [80, 250, 80], 'the stress temperature moves with the environment\'s, the deposition temperature stays');
    assert.ok(hot.thicknessMm > 1 && hot.thicknessMm < 1.001, `the glass expands: ${hot.thicknessMm} mm`);
});
await check('the wavelength-angle map maps the environment shown, on what it is scored on', () => {
    for (const [state, id] of [[{ choice: 'env2' }, 'env2'], [{ choice: 'env3' }, 'env3'], [{}, 'base']]) {
        const got = hooked(useWavelengthAngleMap, four, state);
        assert.deepEqual(got.shownDesign, environmentDesign(four, id), id);
        assert.equal(got.spec.surfaceMode, resolveEvalMode(apart(id)), `${id}: its mode`);
        const small = { ...got.spec, xSteps: 5, ySteps: 3 };
        assert.deepStrictEqual(computeSurface(small, got.shownDesign, designMaterialLookup(got.shownDesign)),
            computeSurface(small, apart(id), designMaterialLookup(apart(id))), `${id}: the map`);
    }
    assert.equal(hooked(useWavelengthAngleMap, four, { choice: 'env2' }).spec.surfaceMode, 'total');
});
await check('the map of an environment at another temperature from the surface workers is the map drawn here', async () => {
    const hot = environmentDesign(four, 'env3');
    assert.ok(hot.substrate.material.startsWith('thermal:'), 'the glass at 80 °C is a material of its own');
    const spec = { ...hooked(useWavelengthAngleMap, four, { choice: 'env3' }).spec, xSteps: 5, ySteps: 3 };
    const warnings = [];
    const browserWorker = globalThis.Worker;
    globalThis.Worker = standInSurfaceWorker(warnings);
    let published = null;
    try {
        await runSurfaceSweep({
            surfaceSpec: spec, design: hot, poolRef: { current: null },
            setProgress() {}, setSurfaceResult: result => { published = result; }, setComputing() {},
            computeMainThread: () => ({ ok: false, error: 'the workers failed' }),
        });
    } finally {
        globalThis.Worker = browserWorker;
    }
    assert.ok(published?.ok, `the workers' map: ${published?.error}`);
    const here = computeSurface(spec, hot, designMaterialLookup(hot));
    published.z.forEach((row, j) => row.forEach((value, i) => assert.ok(Math.abs(value - here.z[j][i]) <= 1e-12,
        `${here.x[i]} nm, ${here.y[j]}°: ${value} from the workers, ${here.z[j][i]} here`)));
    assert.deepEqual(warnings, [], 'every value a worker read was in its table');
});
await check('the range notice reads the environment shown', () => {
    const offenders = id => designRangeCoverage(hooked(() => useInhomogeneities(en.inhomogeneities), four, { choice: id }).shownDesign, [2400, 2600]).offenders.map(o => o.id);
    assert.ok(offenders('env2').includes('builtin:H2O') && !offenders('base').includes('builtin:H2O'), 'water stops at 2489 nm, under water alone');
});

// ── 4. Stress fields ────────────────────────────────────────────────────────
await check('a Stress field the environment shown holds a value of its own for is not editable and says why; the others edit the design\'s own', () => {
    const hot = hooked(useStressAnalysis, four, { choice: 'env3' });
    assert.deepEqual(hot.held, { temperatureC: true, thicknessMm: true });
    assert.deepEqual(hooked(useStressAnalysis, four, { choice: 'env2' }).held, { temperatureC: false, thicknessMm: false }, 'the dome edge takes the run and the part as they are');
    assert.deepEqual(hooked(useStressAnalysis, four, {}).held, { temperatureC: false, thicknessMm: false });
    const own = { ...four, environments: ENVIRONMENTS.map(env => (env.id === 'env2' ? { ...env, substrate: { thickness: 3 } } : env)) };
    sessions(own);
    assert.deepEqual(hooked(useStressAnalysis, own, { choice: 'env2' }).held, { temperatureC: false, thicknessMm: true }, 'a substrate thickness of its own');
    const html = render(StressAnalysis, four, { choice: 'env3' });
    const held = esc(`${en.stressAnalysis.temperatureTip}\n${en.stressAnalysis.environmentHeld('3 · Hot')}`);
    assert.ok(html.includes(`title="${held}"`), 'the hover says where the value comes from');
    const inputs = html.match(/<input[^>]*>/g) || [];
    assert.equal(inputs.filter(input => input.includes(' disabled=""')).length, 2, 'the temperature and the substrate thickness');
    assert.ok(inputs.some(input => input.includes('value="80"')), 'the temperature shown is the environment\'s');
    const plain = render(StressAnalysis, four, {}).match(/<input[^>]*>/g) || [];
    assert.ok(plain.every(input => !input.includes(' disabled=""')), 'environment 1 edits all four');
    for (const code of ['ru', 'zh', 'it']) assert.match(makeLocale(code).stressAnalysis.environmentHeld('3 · Hot'), /3 · Hot/, code);
});
await check('without a stress run an environment at another temperature has no stress temperature of its own, so T edits the design\'s', () => {
    const { stress: _run, ...noRun } = { ...four, id: 'one-at-a-time-no-run' };
    sessions(noRun);
    const hot = hooked(useStressAnalysis, noRun, { choice: 'env3' });
    assert.deepEqual([hot.temperatureC, hot.held], [null, { temperatureC: false, thicknessMm: true }]);
    const inputs = render(StressAnalysis, noRun, { choice: 'env3' }).match(/<input[^>]*>/g) || [];
    assert.equal(inputs.filter(input => input.includes(' disabled=""')).length, 1, 'the substrate thickness alone');
});
await check('a held substrate thickness is shown to five figures, what the field holds', () => {
    const exact = apart('env3').substrate.thickness;
    assert.ok(String(exact).length > 6, `the glass at 80 °C is ${exact} mm`);
    assert.equal(hooked(useStressAnalysis, four, { choice: 'env3' }).thicknessMm, 1.0005);
    assert.ok(render(StressAnalysis, four, { choice: 'env3' }).includes('value="1.0005"'));
});

console.log(`${pass} passed`);
