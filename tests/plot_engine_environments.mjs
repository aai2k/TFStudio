/**
 * Plot Engine on a design with environments: each curve, and the heatmap and
 * 3D surface, computed in the environment its own Environment field names.
 *
 *   1. Without environments no curve and no surface draws the field, and a
 *      curve or a surface kept from when the design had environments computes
 *      as one without.
 *   2. The field offers Current and each environment, no All; a choice naming
 *      an environment the design no longer has reads as Current; the choice is
 *      kept with the curve's and the surface's settings.
 *   3. A curve in environment k is that environment's design computed apart:
 *      T, R, A, the phase, GDD, Ψ and Δ along wavelength and angle in an
 *      environment with a thickness factor, a swap, another medium and the
 *      whole part, and in one at another temperature; along a layer's
 *      thickness, the design apart with that layer as thick as the environment
 *      deposits it. The window draws curves of two environments together,
 *      sends a curve under its environment's cone to the worker, and draws a
 *      curve naming an environment the design it computes lacks empty. A
 *      surface likewise, a layer on either axis, on the main thread and on the
 *      surface workers; a map is drawn only in the environment it was computed
 *      in.
 *   4. MF under Current is the merit tables' total, the number Refinement
 *      minimizes, at the design and along a layer's thickness, on a curve and
 *      on a surface, in every surface mode, under a cone of an environment that
 *      is on, with a math row and a row of an environment that is off; under
 *      one environment it is that environment's own MF, whether the
 *      environment is on or off. An MF curve on Current keeps its line when the
 *      current environment changes. With no row to score it says why.
 *   5. The material range notice reads the environments the plot computes in.
 *
 * Run: node tests/plot_engine_environments.mjs
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
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { oneEnvironmentDesign } = await import('../src/utils/environments/environments.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { rangeMaterials } = await import('../src/utils/materials/materialRange.js');
const { meritTable } = await import('../src/utils/physics/meritDisplay.js');
const { computeSurface, makeDefaultCurve, makeDefaultSurfaceSpec } = await import('../src/utils/physics/plotQuantities.js');
const { currentEnvironmentSession, useCurrentEnvironment } = await import('../src/components/windows/design/environments/currentEnvironment.js');
const P = '../src/components/windows/analysis/plotEngine';
const { computeCurveResults, curveKey, mergeCurveResults } = await import(`${P}/curveResults.js`);
const { useCurvePlot } = await import(`${P}/curveState.js`);
const { patchSurfaceSpec, useSurfacePlot } = await import(`${P}/surfaceState.js`);
const { editCurve } = await import(`${P}/curveEdits.js`);
const { curveIn, surfaceIn } = await import(`${P}/environmentField.js`);
const { CurveRow } = await import(`${P}/CurveRow.js`);
const { SurfacePanel } = await import(`${P}/SurfacePanel.js`);
const { PlotEngine, evaluatedMaterials } = await import(`${P}/PlotEngine.js`);
const { plotEngineSession } = await import(`${P}/sessionState.js`);
const { runSurfaceSweep } = await import(`${P}/surfaceRunner.js`);
const { standInSurfaceWorker } = await import('./_surfaceWorker.mjs');

const h = React.createElement;
const c = makeTheme();
const en = makeLocale('en');
const clone = value => JSON.parse(JSON.stringify(value));
const close = (a, b, what, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)),
    `${what}: ${a} against ${b}`);

// A glass that expands and whose index moves with temperature, the substrate
// of environment 3, so the environment at 80 °C changes its thickness and its
// index (environmentTemperature.js).
const GLASS = { name: 'Expanding glass', formulaNum: -1, tabData: [[300, 1.53, 0], [1500, 1.50, 0]], mechanical: { linearExpansionPerK: 9e-6, dnDtPerK: 3e-6 } };
// Environment 1 on BK7; 2 the dome edge under water, its TiO2 0.9 times as
// thick, its MgF2 deposited as SiO2, scored as the whole part; 3 at 80 °C on
// the expanding glass; 4 switched off, its TiO2 0.95 times as thick; 5
// switched off, under a cone of incidence.
const ENVIRONMENTS = [
    { id: 'base', name: 'BK7' },
    { id: 'env2', name: 'Dome edge', incidentMedium: 'builtin:H2O', thicknessFactors: { 'builtin:TiO2': 0.9 }, materialSwaps: { 'builtin:MgF2': 'builtin:SiO2' }, mfEvalMode: 'total' },
    { id: 'env3', name: 'Hot', temperatureC: 80, substrate: { material: 'user_heat:Glass' } },
    { id: 'env4', name: 'Edge', thicknessFactors: { 'builtin:TiO2': 0.95 }, enabled: false },
    { id: 'env5', name: 'Coned', cone: { enabled: true, halfAngleDeg: 12 }, enabled: false },
];
const lone = { ...arDesign(), id: 'plot-env-lone', materials: { 'user_heat:Glass': GLASS } };
// The AR's rows (an RAV band, R at 30°, a constant, MXT), R at 600 nm of the
// dome edge alone, a DIFF row reading it, which is scored where it is, and R
// at 500 nm of environment 4, which is off.
const row = (spec, id, env) => ({ ...makeOperand(spec), id, ...(env ? { env } : {}) });
const EXTRA_ROWS = [
    row({ type: 'R', lambdaStart: 600, aoi: 0, pol: 'avg', target: 0.01, weight: 1 }, 'r3', 'env2'),
    row({ type: 'DIFF', refId1: 'r3', refId2: 'r2', target: 0, weight: 0.5 }, 'm1'),
    row({ type: 'R', lambdaStart: 500, aoi: 0, pol: 'avg', target: 0, weight: 1 }, 'r4', 'env4'),
];
const five = { ...lone, id: 'plot-env', environments: ENVIRONMENTS, meritOperands: [...lone.meritOperands, ...EXTRA_ROWS] };
// The same rows without the band, whose samples follow the fringes of the
// design they are taken on, for the merit away from the design's thicknesses.
const pointRows = { ...five, id: 'plot-env-points', meritOperands: five.meritOperands.filter(op => op.type !== 'RAV') };
const d0 = five.frontLayers[0].thickness;
const d1 = five.frontLayers[1].thickness;

const axis = (quantity, side = 'front', polarization = 'avg') => ({ quantity, side, polarization });
const curve = fields => makeDefaultCurve({ x: axis('sweep'), ...fields });
const resultOf = (design, one) => computeCurveResults([one], design)[one.id];
// The merit tables' MF of environment `id`, as the Environments window lists it.
const ownMerit = (design, id) => meritTable(design, design.meritOperands).environments.find(entry => entry.id === id).mf;

const ALONG = [
    { sweep: 'wavelength', rangeFrom: 420, rangeTo: 680, rangeStep: 20, y: axis('T') },
    { sweep: 'aoi', rangeFrom: 0, rangeTo: 60, rangeStep: 15, lambdaFixed_nm: 550, y: axis('R', 'total', 's') },
    { sweep: 'wavelength', rangeFrom: 420, rangeTo: 680, rangeStep: 20, y: axis('A', 'total', 'p') },
    { sweep: 'wavelength', rangeFrom: 480, rangeTo: 640, rangeStep: 20, y: axis('phaseT', 'total') },
    { sweep: 'wavelength', rangeFrom: 480, rangeTo: 640, rangeStep: 20, y: axis('gddR') },
    { sweep: 'wavelength', rangeFrom: 420, rangeTo: 680, rangeStep: 20, aoiFixed_deg: 60, y: axis('psi') },
    { sweep: 'aoi', rangeFrom: 40, rangeTo: 80, rangeStep: 10, lambdaFixed_nm: 633, y: axis('delta') },
];
// T over the thickness of L4, the outer TiO2 layer, and wavelength.
const LAYER_MAP = { ...makeDefaultSurfaceSpec(five), z: 'T', xVar: 'thk:0', xFrom: 8, xTo: 16, xSteps: 3, yVar: 'wavelength', yFrom: 500, yTo: 600, ySteps: 3 };

// The current environment and the curves the window's session holds.
function plotState(design, { current = 'base', curves = [] } = {}) {
    currentEnvironmentSession.write(design, { current });
    plotEngineSession.write(design, { curves, curveResults: null, curvesStoppedFor: null, surfaceSpec: null, surfaceResult: null });
}
// What a hook gives for `design`, with the current environment the window reads, as PlotEngine passes it.
function hooked(design, useHook) {
    let got = null;
    const Probe = () => { got = useHook(useCurrentEnvironment(design).id); return null; };
    renderToStaticMarkup(withDesign(h(Probe), design));
    return got;
}
const curvesOf = (design, state) => {
    plotState(design, state);
    return hooked(design, current => useCurvePlot(design, 'front', en, current));
};
// The surface the window shows for `design` with `current` the current environment.
function mapShownIn(design, current) {
    currentEnvironmentSession.write(design, { current });
    return hooked(design, id => useSurfacePlot(design, 'front', id));
}
// Compute pressed on the map `spec` the window's session holds, `current` the
// current environment, on the surface workers: what the window keeps.
async function computedMap(design, spec, current) {
    plotEngineSession.write(design, { surfaceSpec: spec, surfaceResult: null, plotMode: 'heatmap' });
    const stub = globalThis.Worker;
    globalThis.Worker = standInSurfaceWorker([]);
    try {
        mapShownIn(design, current).computeSurfaceNow();
        for (let turn = 0; turn < 500 && !plotEngineSession.read(design).surfaceResult; turn++) await new Promise(resolve => setImmediate(resolve));
    } finally {
        globalThis.Worker = stub;
    }
    return plotEngineSession.read(design).surfaceResult;
}

const optionsOf = html => [...html.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)]
    .map(([, value, selected, label]) => ({ value, selected: Boolean(selected), label }));
const ENV_LABEL = `>${en.environments.environment}</span>`;
function curveRowHtml(design, one, current = 'base') {
    currentEnvironmentSession.write(design, { current });
    return renderToStaticMarkup(withDesign(h(CurveRow, { curve: one, design, onUpdate: () => {}, onDelete: () => {}, c, t: en }), design));
}
function surfacePanelHtml(design, spec, current = 'base') {
    currentEnvironmentSession.write(design, { current });
    return renderToStaticMarkup(withDesign(h(SurfacePanel, { spec, onUpdate: () => {}, design, result: null, c, t: en }), design));
}
// The Environment field's options, the first select of the markup.
const fieldOptions = html => optionsOf(html.slice(html.indexOf(ENV_LABEL), html.indexOf('</select>', html.indexOf(ENV_LABEL))));

let pass = 0;
const check = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

// ── 1. Without environments ─────────────────────────────────────────────────
await check('without environments no curve and no surface draws the Environment field', () => {
    assert.ok(!curveRowHtml(lone, curve(ALONG[0])).includes(ENV_LABEL));
    assert.ok(!surfacePanelHtml(lone, makeDefaultSurfaceSpec(lone)).includes(ENV_LABEL));
    assert.ok(curveRowHtml(five, curve(ALONG[0])).includes(ENV_LABEL));
    assert.ok(surfacePanelHtml(five, makeDefaultSurfaceSpec(five)).includes(ENV_LABEL));
});
await check('without environments the curves and the surface compute as they are kept', () => {
    const kept = curve(ALONG[0]);
    assert.equal(curveIn(kept, lone, 'base'), kept, 'the curve itself');
    const spec = makeDefaultSurfaceSpec(lone);
    assert.equal(surfaceIn(spec, lone, 'base'), spec, 'the surface itself');
    const plot = curvesOf(lone, { curves: [kept] });
    assert.equal(plot.computed, plot.curves, 'the window computes the list it keeps');
    // A choice kept from when the design had environments computes environment 1.
    const left = { ...kept, env: 'env2' };
    assert.deepEqual(curveIn(left, lone, 'base'), kept);
    assert.deepEqual(resultOf(lone, left), resultOf(lone, kept));
    assert.deepEqual(surfaceIn({ ...spec, env: 'env2' }, lone, 'base'), spec);
});

// ── 2. The field ────────────────────────────────────────────────────────────
await check('the field offers Current and each environment, no All, and shows the choice kept', () => {
    const one = curve(ALONG[0]);
    const offered = fieldOptions(curveRowHtml(five, one, 'env2'));
    assert.deepEqual(offered.map(option => option.label),
        ['Current (2)', '1 · BK7', '2 · Dome edge', '3 · Hot', '4 · Edge', '5 · Coned']);
    assert.deepEqual(offered.filter(option => option.selected).map(option => option.value), ['current']);
    const named = fieldOptions(curveRowHtml(five, { ...one, env: 'env3' }));
    assert.deepEqual(named.filter(option => option.selected).map(option => option.value), ['env3']);
    const surface = fieldOptions(surfacePanelHtml(five, { ...makeDefaultSurfaceSpec(five), env: 'env4' }));
    assert.deepEqual(surface.map(option => option.label), offered.map(option => option.label).with(0, 'Current (1)'));
    assert.deepEqual(surface.filter(option => option.selected).map(option => option.value), ['env4']);
});
await check('a choice naming an environment the design no longer has reads as Current', () => {
    const gone = { ...curve(ALONG[0]), env: 'env9' };
    const offered = fieldOptions(curveRowHtml(five, gone, 'env3'));
    assert.deepEqual(offered.filter(option => option.selected).map(option => option.label), ['Current (3)']);
    assert.deepEqual(resultOf(five, curveIn(gone, five, 'env3')), resultOf(five, curveIn({ ...gone, env: 'current' }, five, 'env3')));
    assert.equal(curveIn(gone, five, 'env3').env, 'env3');
    const mf = { ...gone, sweep: 'thk:0', y: axis('MF') };
    assert.equal(curveIn(mf, five, 'env3').meritEnv, 'all', 'an MF curve reads the total');
    const spec = { ...makeDefaultSurfaceSpec(five), env: 'env9' };
    assert.equal(surfaceIn(spec, five, 'env3').env, 'env3');
    assert.equal(surfaceIn({ ...spec, z: 'MF' }, five, 'env3').env, 'all');
});
await check('the choice is kept with the curve and with the surface settings', () => {
    const one = curve(ALONG[0]);
    const edited = editCurve(one, { env: 'env3' }, five, () => one.label);
    assert.deepEqual(edited, { ...one, env: 'env3' }, 'only the choice changes');
    assert.equal(patchSurfaceSpec(makeDefaultSurfaceSpec(five), { env: 'env3' }, five).env, 'env3');
    const plot = curvesOf(five, { curves: [one] });
    plot.updateCurve(one.id, { env: 'env2' });
    assert.equal(plotEngineSession.read(five).curves[0].env, 'env2', 'kept in the window session with the curve');
});

// ── 3. A curve in an environment ────────────────────────────────────────────
await check('a curve in an environment is that environment\'s design computed apart', () => {
    for (const env of ['env2', 'env3']) {
        const apart = oneEnvironmentDesign(five, env);
        for (const fields of ALONG) {
            const one = curve(fields);
            assert.deepEqual(resultOf(five, { ...one, env }), resultOf(apart, one), `${fields.y.quantity} in ${env}`);
        }
    }
    const t = curve(ALONG[0]);
    assert.deepEqual(resultOf(five, t), resultOf(oneEnvironmentDesign(five), t), 'environment 1 without a choice');
    assert.notDeepEqual(resultOf(five, { ...t, env: 'env2' }).y, resultOf(five, t).y, 'the dome edge is not the centre');
});
await check('along a layer\'s thickness the axis is the recipe\'s and the layer is as thick as the environment deposits it', () => {
    for (const [env, layer, quantity] of [['env2', 0, 'T'], ['env2', 2, 'psi'], ['env3', 0, 'gdR'], ['env2', 1, 'R']]) {
        const apart = oneEnvironmentDesign(five, env);
        const f = apart.frontLayers[layer].thickness / five.frontLayers[layer].thickness;
        const recipe = five.frontLayers[layer].thickness;
        const along = curve({ sweep: `thk:${layer}`, rangeFrom: recipe, rangeTo: recipe + 30, rangeStep: 10,
            lambdaFixed_nm: 560, aoiFixed_deg: quantity === 'psi' ? 60 : 0, y: axis(quantity) });
        const got = resultOf(five, { ...along, env });
        assert.deepEqual(got.x, [0, 10, 20, 30].map(step => Number((recipe + step).toPrecision(12))), 'the recipe thickness');
        got.x.forEach((value, i) => {
            const at = clone(apart);
            at.frontLayers[layer].thickness = f * value;
            const point = resultOf(at, curve({ sweep: 'wavelength', rangeFrom: 560, rangeTo: 560, rangeStep: 1,
                aoiFixed_deg: along.aoiFixed_deg, y: axis(quantity) }));
            close(got.y[i], point.y[0], `${quantity} in ${env} at L${layer} = ${value} nm`, quantity === 'gdR' ? 1e-9 : 1e-12);
        });
        if (env === 'env2' && layer === 0) assert.ok(f < 1, 'the dome edge thins TiO2');
    }
});
await check('the window draws curves of two environments together, each in its own', () => {
    const centre = curve(ALONG[0]);
    const edge = { ...curve(ALONG[0]), env: 'env2' };
    const plot = curvesOf(five, { curves: [centre, edge], current: 'base' });
    assert.equal(plot.busy, false, 'computed where the window runs');
    assert.deepEqual(plot.results[centre.id], resultOf(oneEnvironmentDesign(five), centre));
    assert.deepEqual(plot.results[edge.id], resultOf(oneEnvironmentDesign(five, 'env2'), centre));
    // Current follows the current environment.
    const moved = curvesOf(five, { curves: [centre], current: 'env3' });
    assert.deepEqual(moved.results[centre.id], resultOf(oneEnvironmentDesign(five, 'env3'), centre));
    assert.deepEqual(moved.computed.map(one => one.env), ['env3']);
});
await check('the window computes a curve on Current in the current environment, as its Results table shows', () => {
    const one = curve({ sweep: 'wavelength', rangeFrom: 500, rangeTo: 520, rangeStep: 10, y: axis('T') });
    const tabled = (current, curves) => {
        currentEnvironmentSession.write(five, { current });
        plotEngineSession.write(five, { curves, showTable: true, plotMode: '2d', curveResults: null, curvesStoppedFor: null });
        const html = renderToStaticMarkup(withDesign(h(PlotEngine, { c, theme: c, t: en }), five));
        return [...html.matchAll(/>(\d\.\d{6})</g)].map(match => match[1]);
    };
    const values = env => resultOf(oneEnvironmentDesign(five, env), one).y.map(value => value.toFixed(6));
    for (const current of ['base', 'env2', 'env3']) assert.deepEqual(tabled(current, [one]), values(current), `Current in ${current}`);
    assert.deepEqual(tabled('env2', [{ ...one, env: 'env3' }]), values('env3'), 'a named environment whichever is current');
});
await check('a curve under the cone of its environment goes to the worker, as one under the design\'s cone does', () => {
    const plain = curve(ALONG[0]);
    assert.equal(curvesOf(five, { curves: [plain] }).busy, false);
    const coned = curvesOf(five, { curves: [{ ...plain, env: 'env5' }] });
    assert.equal(coned.busy, true, 'waiting on the analysis worker');
    assert.equal(coned.results[plain.id], undefined);
});
await check('a curve naming an environment the design it is computed on lacks is drawn empty, the others drawn', () => {
    const t = curve(ALONG[0]);
    const lost = { ...curve(ALONG[0]), env: 'env7' };
    const errors = console.error;
    console.error = () => {};
    let got;
    try {
        got = computeCurveResults([lost, t], five);
    } finally {
        console.error = errors;
    }
    assert.deepEqual(got[lost.id], { x: [], y: [] });
    assert.deepEqual(got[t.id], resultOf(five, t));
    // A current environment the design does not have reads as environment 1.
    assert.equal(curveIn(t, five, 'env7').env, 'base');
});
await check('a surface in an environment is that environment\'s design computed apart, a layer on either axis, on the surface workers too', async () => {
    const lookup = designMaterialLookup(five);
    const angles = { ...makeDefaultSurfaceSpec(five), z: 'R', surfaceMode: 'total', xVar: 'wavelength', xFrom: 450, xTo: 650, xSteps: 5, yVar: 'aoi', yFrom: 0, yTo: 40, ySteps: 3 };
    for (const env of ['env2', 'env3']) {
        const apart = oneEnvironmentDesign(five, env);
        assert.deepEqual(computeSurface({ ...angles, env }, five, lookup), computeSurface(angles, apart, designMaterialLookup(apart)), `R in ${env}`);
    }
    const apart = oneEnvironmentDesign(five, 'env2');
    const apartLookup = designMaterialLookup(apart);
    const f = apart.frontLayers[0].thickness / d0;
    const got = computeSurface({ ...LAYER_MAP, env: 'env2' }, five, lookup);
    assert.deepEqual(got.x, [8, 12, 16], 'the recipe thickness');
    got.x.forEach((value, i) => {
        const point = computeSurface({ ...LAYER_MAP, xFrom: f * value, xTo: f * value, xSteps: 2 }, apart, apartLookup);
        got.y.forEach((lambda, j) => close(got.z[j][i], point.z[j][0], `T at L4 = ${value} nm, ${lambda} nm`));
    });
    const onY = { ...LAYER_MAP, xVar: 'wavelength', xFrom: 500, xTo: 600, xSteps: 3, yVar: 'thk:2', yFrom: 12, yTo: 20, ySteps: 3 };
    const f2 = apart.frontLayers[2].thickness / five.frontLayers[2].thickness;
    const gotY = computeSurface({ ...onY, env: 'env2' }, five, lookup);
    assert.deepEqual(gotY.y, [12, 16, 20], 'the recipe thickness on Y');
    gotY.y.forEach((value, j) => {
        const point = computeSurface({ ...onY, yFrom: f2 * value, yTo: f2 * value, ySteps: 2 }, apart, apartLookup);
        gotY.x.forEach((lambda, i) => close(gotY.z[j][i], point.z[0][i], `T at L2 = ${value} nm, ${lambda} nm`));
    });
    const warnings = [];
    const stub = globalThis.Worker;
    globalThis.Worker = standInSurfaceWorker(warnings);
    try {
        for (const spec of [{ ...LAYER_MAP, env: 'env3' }, { ...LAYER_MAP, z: 'gddR', env: 'env2' }]) {
            let swept = null;
            await runSurfaceSweep({ surfaceSpec: spec, design: five, poolRef: { current: null }, setProgress: () => {},
                setSurfaceResult: result => { swept = result; }, setComputing: () => {}, computeMainThread: () => null });
            const here = computeSurface(spec, five, lookup);
            assert.deepEqual(swept.z, here.z, `${spec.z} in ${spec.env} on the workers`);
            assert.deepEqual([swept.x, swept.y], [here.x, here.y]);
        }
    } finally {
        globalThis.Worker = stub;
    }
    assert.deepEqual(warnings, []);
});
await check('the window computes the surface in the environment its field names', async () => {
    plotState(five, { current: 'env2' });
    plotEngineSession.write(five, { surfaceSpec: { ...makeDefaultSurfaceSpec(five), env: 'current' } });
    assert.equal(hooked(five, current => useSurfacePlot(five, 'front', current)).computedSpec.env, 'env2');
    plotEngineSession.write(five, { surfaceSpec: { ...makeDefaultSurfaceSpec(five), z: 'MF', env: 'current' } });
    assert.equal(hooked(five, current => useSurfacePlot(five, 'front', current)).computedSpec.env, 'all');
    plotEngineSession.write(five, { surfaceSpec: { ...makeDefaultSurfaceSpec(five), z: 'MF', env: 'env3' } });
    assert.equal(hooked(five, current => useSurfacePlot(five, 'front', current)).computedSpec.env, 'env3');
    const kept = await computedMap(five, { ...LAYER_MAP, env: 'current' }, 'env2');
    assert.deepEqual(kept?.z, computeSurface({ ...LAYER_MAP, env: 'env2' }, five, designMaterialLookup(five)).z,
        'Compute keeps the map of the current environment');
});
await check('a map is drawn only in the environment it was computed in; the MF total in every current environment', async () => {
    await computedMap(five, { ...LAYER_MAP, env: 'current' }, 'base');
    assert.ok(mapShownIn(five, 'base').surfaceResult, 'drawn where it was computed');
    assert.equal(mapShownIn(five, 'env2').surfaceResult, null, 'not drawn once Current is environment 2');
    assert.ok(mapShownIn(five, 'base').surfaceResult, 'drawn again back in environment 1');
    await computedMap(five, { ...LAYER_MAP, env: 'env3' }, 'base');
    const withoutHot = { ...five, environments: ENVIRONMENTS.filter(env => env.id !== 'env3') };
    assert.equal(mapShownIn(withoutHot, 'env2').surfaceResult, null, 'not drawn once its environment is deleted');
    const mf = { ...LAYER_MAP, z: 'MF', yVar: 'thk:1', yFrom: d1, yTo: d1 + 4, ySteps: 2, env: 'current' };
    await computedMap(five, mf, 'base');
    assert.ok(mapShownIn(five, 'env3').surfaceResult, 'the total is drawn whichever environment is current');
});

// ── 4. The merit function ───────────────────────────────────────────────────
const mfCurve = (design, env, rows = design) => {
    const along = curve({ sweep: 'thk:0', rangeFrom: d0, rangeTo: d0 + 6, rangeStep: 3, y: axis('MF') });
    return resultOf(rows, curveIn({ ...along, env }, design, 'base'));
};
await check('MF under Current is the merit tables\' total, under one environment that environment\'s own', () => {
    const tables = meritTable(five, five.meritOperands);
    assert.equal(mfCurve(five, 'current').y[0], tables.mf, 'the total at the design');
    for (const id of ['base', 'env2', 'env3']) assert.equal(mfCurve(five, id).y[0], ownMerit(five, id), `environment ${id}'s own`);
    // Environment 4 is off: its own MF is the one the tables list once it is on.
    const fourOn = { ...five, environments: ENVIRONMENTS.map(env => (env.id === 'env4' ? { ...env, enabled: true } : env)) };
    assert.equal(mfCurve(five, 'env4').y[0], ownMerit(fourOn, 'env4'), 'environment 4 switched off');
    assert.notEqual(tables.mf, ownMerit(five, 'base'), 'the total is not environment 1\'s');
    assert.notEqual(tables.mf, meritTable(fourOn, fourOn.meritOperands).mf, 'environment 4\'s row counts only while it is on');
});
await check('MF reads the tables in every surface mode and under the cone of an environment that is on', () => {
    const variants = {
        'back only': { ...five, id: 'plot-env-back', surfaceMode: 'back_only', frontLayers: [], backLayers: five.frontLayers },
        symmetric: { ...five, id: 'plot-env-symmetric', surfaceMode: 'symmetric' },
        'both sides': { ...five, id: 'plot-env-both', surfaceMode: 'both_independent', mfEvalMode: 'total', backLayers: five.frontLayers.slice(0, 2) },
        'a cone': { ...five, id: 'plot-env-coned', environments: ENVIRONMENTS.map(env => (env.id === 'env5' ? { ...env, enabled: true } : env)) },
    };
    for (const [name, design] of Object.entries(variants)) {
        assert.equal(mfCurve(design, 'current').y[0], meritTable(design, design.meritOperands).mf, `the total, ${name}`);
        assert.equal(mfCurve(design, 'env2').y[0], ownMerit(design, 'env2'), `environment 2's own, ${name}`);
    }
});
await check('MF along a layer\'s thickness is the total of the design with that layer at each thickness', () => {
    const along = mfCurve(pointRows, 'current');
    along.x.forEach((value, i) => {
        const at = clone(pointRows);
        at.frontLayers[0].thickness = value;
        assert.equal(along.y[i], meritTable(at, at.meritOperands).mf, `MF at L4 = ${value} nm`);
    });
    const own = mfCurve(pointRows, 'env2');
    own.x.forEach((value, i) => {
        const at = clone(pointRows);
        at.frontLayers[0].thickness = value;
        assert.equal(own.y[i], ownMerit(at, 'env2'), `environment 2's MF at L4 = ${value} nm`);
    });
});
await check('an MF curve on Current keeps its line when the current environment changes', () => {
    const mf = curve({ sweep: 'thk:0', rangeFrom: d0, rangeTo: d0 + 6, rangeStep: 3, y: axis('MF') });
    const first = curveIn(mf, five, 'base');
    assert.equal(curveKey(curveIn(mf, five, 'env2')), curveKey(first), 'the same settings whichever environment is current');
    plotState(five, { current: 'env2', curves: [mf] });
    plotEngineSession.write(five, { curveResults: mergeCurveResults(null, five, [first], computeCurveResults([first], five), [first]) });
    const plot = hooked(five, current => useCurvePlot(five, 'front', en, current));
    assert.equal(plot.busy, false, 'nothing computed again');
    assert.deepEqual(plot.results[mf.id], resultOf(five, first));
    // A curve that reads T beside MF follows the current environment.
    const mixed = { ...mf, x: axis('T') };
    assert.notEqual(curveKey(curveIn(mixed, five, 'env2')), curveKey(curveIn(mixed, five, 'base')));
});
await check('the MF surface reads the same, on the main thread and on the surface workers', async () => {
    const lookup = designMaterialLookup(five);
    const spec = { ...makeDefaultSurfaceSpec(five), z: 'MF', xVar: 'thk:0', xFrom: d0, xTo: d0 + 4, xSteps: 3, yVar: 'thk:1', yFrom: d1, yTo: d1 + 4, ySteps: 2 };
    assert.equal(computeSurface({ ...spec, env: 'all' }, five, lookup).z[0][0], meritTable(five, five.meritOperands).mf);
    assert.equal(computeSurface(spec, five, lookup).z[0][0], meritTable(five, five.meritOperands).mf, 'the total when no environment is named');
    assert.equal(computeSurface({ ...spec, env: 'env3' }, five, lookup).z[0][0], ownMerit(five, 'env3'));
    const stub = globalThis.Worker;
    globalThis.Worker = standInSurfaceWorker([]);
    try {
        for (const env of ['all', 'env3']) {
            let swept = null;
            await runSurfaceSweep({ surfaceSpec: { ...spec, env }, design: five, poolRef: { current: null }, setProgress: () => {},
                setSurfaceResult: result => { swept = result; }, setComputing: () => {}, computeMainThread: () => null });
            assert.deepEqual(swept.z, computeSurface({ ...spec, env }, five, lookup).z, `MF in ${env} on the workers`);
        }
    } finally {
        globalThis.Worker = stub;
    }
});
await check('with no row scored where the MF is read it says so', () => {
    const off = { ...five, environments: ENVIRONMENTS.map(env => ({ ...env, enabled: false })) };
    assert.equal(mfCurve(off, 'current').errorKey, 'errNoRowsOn', 'no environment that is on scores a row');
    const surface = { ...makeDefaultSurfaceSpec(five), z: 'MF', xVar: 'thk:0', xFrom: d0, xTo: d0, xSteps: 2, yVar: 'thk:1', yFrom: d1, yTo: d1, ySteps: 2, env: 'all' };
    assert.equal(computeSurface(surface, off, designMaterialLookup(off)).errorKey, 'errNoRowsOn');
    const bare = { ...five, meritOperands: [EXTRA_ROWS[0]] };
    assert.equal(mfCurve(bare, 'env3').errorKey, 'errNoRowsHere', 'environment 3 scores no row');
    assert.equal(mfCurve(bare, 'env2').y[0], ownMerit(bare, 'env2'));
    assert.equal(mfCurve({ ...five, meritOperands: [] }, 'current').errorKey, 'errNoOperands', 'no row at all');
    for (const key of ['errNoRowsOn', 'errNoRowsHere']) {
        for (const code of ['en', 'ru', 'zh', 'it']) assert.ok(makeLocale(code).plotEngine[key], `${key} in ${code}`);
    }
});

// ── 5. The material range notice ────────────────────────────────────────────
await check('the range notice reads the environments the plot computes in', () => {
    const ids = materials => [...new Set(materials.map(material => material.id))].sort();
    const t = curve(ALONG[0]);
    const centre = ids(evaluatedMaterials(five, '2d', [curveIn(t, five, 'base')], null));
    const edge = ids(evaluatedMaterials(five, '2d', [curveIn({ ...t, env: 'env2' }, five, 'base')], null));
    assert.ok(!centre.includes('builtin:H2O') && edge.includes('builtin:H2O') && edge.includes('builtin:SiO2'), 'water and the swap at the dome edge');
    const mf = curveIn({ ...t, env: 'env2', sweep: 'thk:0', y: axis('MF') }, five, 'base');
    assert.deepEqual(evaluatedMaterials(five, '2d', [mf], null), [], 'MF reads each operand\'s wavelengths, not the plot\'s');
    const map = ids(evaluatedMaterials(five, 'heatmap', [], surfaceIn({ ...LAYER_MAP, env: 'env2' }, five, 'base')));
    assert.ok(map.includes('builtin:H2O'), 'a map in environment 2 reads its water');
    assert.deepEqual(evaluatedMaterials(five, 'heatmap', [], surfaceIn({ ...LAYER_MAP, z: 'MF' }, five, 'base')), [],
        'an MF map reads each operand\'s wavelengths, as an MF curve does');
    assert.deepEqual(ids(evaluatedMaterials(lone, '2d', [t], null)), ids(evaluatedMaterials(five, '2d', [curveIn(t, five, 'base')], null)),
        'environment 1 reads the design\'s own');
});
await check('an MF map raises no notice from the fixed wavelength it hides', () => {
    // Two thicknesses on the axes, so a T map sits at the fixed wavelength,
    // 20 µm, outside the data of the design's materials.
    const map = { ...makeDefaultSurfaceSpec(lone), xVar: 'thk:0', xFrom: 8, xTo: 16, xSteps: 3, yVar: 'thk:1', yFrom: 40, yTo: 60, ySteps: 3, fixedLambda_nm: 20000 };
    const markup = spec => {
        plotState(lone);
        plotEngineSession.write(lone, { plotMode: 'heatmap', surfaceSpec: spec });
        return renderToStaticMarkup(withDesign(h(PlotEngine, { c, theme: c, t: en }), lone));
    };
    // The range notice is the window's one notice, behind its badge.
    const badge = `title="${en.analysisChrome.notices}"`;
    assert.ok(markup({ ...map, z: 'T' }).includes(badge), 'a T map at 20 µm warns');
    assert.ok(!markup({ ...map, z: 'MF' }).includes(badge), 'an MF map does not');
});

console.log(`PASS: plot_engine_environments (${pass} checks)`);
