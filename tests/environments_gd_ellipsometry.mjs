/**
 * GD/GDD and Ellipsometry on a design with environments, each with the
 * Environment droplist in the row under its plot (chrome/environmentChoice.js).
 *
 *   1. Without environments each window computes what it computes for the
 *      design apart, a stored All aside, and draws it in its own colours with
 *      no legend and no Environment column; a design shown in environment 1
 *      renders the markup it renders without environments, the row under the
 *      plot aside.
 *   2. One environment: each window computes the design of the environment
 *      current or chosen, one that is off computed when chosen.
 *   3. GD/GDD under All: a curve per environment in its colour, named after it,
 *      the reference wavelength's line on the first and the legend above naming
 *      them; the automatic range takes in every curve and counts the samples
 *      of every curve it leaves off; the table and the CSV list each
 *      environment's rows in turn after an Environment column, with every
 *      column any environment needs.
 *   4. GD/GDD targets: the rows scored in the environment shown, every row
 *      under All; a drawn or dragged target snaps to those rows alone; a drawn
 *      target is scored in every environment and a dragged one keeps its own.
 *   5. Ellipsometry under All: Ψ solid and Δ dashed in each environment's
 *      colour, the axes named Ψ (°) and Δ (°) in the text colour, the readout
 *      and the legend naming the environments; the table and the CSV give Ψ
 *      and Δ of each environment in columns named after it; measured curves
 *      drawn as with one environment.
 *   6. Both windows draw the droplist with Current, each environment and All
 *      between the plot and the Results strip on a design with environments,
 *      and none without; the range notice reads the materials of every
 *      environment shown, over a range and at Ellipsometry's one wavelength.
 *
 * Run: node tests/environments_gd_ellipsometry.mjs
 */
import assert from 'node:assert/strict';
import './_kernel.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { oneEnvironmentDesign, threeEnvironmentDesign } = await import('./_environmentDesign.mjs');
const { environmentChoiceSession, useEnvironmentChoice } = await import('../src/components/windows/analysis/chrome/environmentChoice.js');
const { BadgeRow } = await import('../src/components/windows/analysis/chrome/badgeRow.js');
const { currentEnvironmentSession } = await import('../src/components/windows/design/environments/currentEnvironment.js');
const { environmentDesign } = await import('../src/utils/environments/environments.js');
const { uncoveredMaterialRegions } = await import('../src/utils/materials/materialRange.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { ANALYSIS_DEFAULTS, environmentColor } = await import('../src/constants/analysisDefaults.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');
const GD_DIR = '../src/components/windows/analysis/gdGddEvaluation';
const { GDGDDEvaluation } = await import(`${GD_DIR}/GDGDDEvaluation.js`);
const { useGDGDDState } = await import(`${GD_DIR}/useGDGDDState.js`);
const { useGdGddTargetEditor } = await import(`${GD_DIR}/useGdGddTargetEditor.js`);
const { computeGdGddSpectrum } = await import(`${GD_DIR}/spectrum.js`);
const { buildGdGddView } = await import(`${GD_DIR}/viewModel.js`);
const { buildGDChartOption } = await import(`${GD_DIR}/chartModel.js`);
const { gdGddSession } = await import(`${GD_DIR}/sessionState.js`);
const { SamplingNote } = await import(`${GD_DIR}/GDControls.js`);
const EL_DIR = '../src/components/windows/analysis/ellipsometryEvaluation';
const { EllipsometryEvaluation } = await import(`${EL_DIR}/EllipsometryEvaluation.js`);
const { useEllipsometryEvaluation } = await import(`${EL_DIR}/useEllipsometryEvaluation.js`);
const { computeEllipsometrySweep } = await import(`${EL_DIR}/spectrum.js`);
const { buildEllipsometryOption } = await import(`${EL_DIR}/EllipsometryChart.js`);
const { buildEllipsometryTable } = await import(`${EL_DIR}/EllipsometryResults.js`);
const { ellipsometrySession } = await import(`${EL_DIR}/sessionState.js`);

const h = React.createElement;
const c = makeTheme();
const en = makeLocale('en');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const literal = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const GD_COLORS = ANALYSIS_DEFAULTS.gdGddEvaluation.colors;
const EL_COLORS = ANALYSIS_DEFAULTS.ellipsometryEvaluation.colors;
const CHART = { background: c.bg, paper: c.panel, grid: c.border, text: c.text };
const ENV = en.environments.environment;
const LAMBDA = en.spectralAxis.lambdaShort;

// GD rows at 0° in the average polarization, as the window plots GDD in
// reflection: one scored in every environment, one on sapphire alone, and one
// in environment 3 alone at 503 nm and 43 fs², which a target drawn near it
// would snap to were it on the plot.
const gdd = (lambda, target) => ({ type: 'GDD', lambdaStart: lambda, lambdaEnd: lambda, aoi: 0, pol: 'avg', target, weight: 1 });
const g1 = { ...makeOperand(gdd(550, 10)), id: 'g1' };
const g2 = { ...makeOperand(gdd(600, 20)), id: 'g2', env: 'env2' };
const g3 = { ...makeOperand(gdd(503, 43)), id: 'g3', env: 'env3' };
const plainDesign = oneEnvironmentDesign();
const lone = { ...plainDesign, meritOperands: [...plainDesign.meritOperands, g1] };
const threeDesign = threeEnvironmentDesign();
const design = { ...threeDesign, meritOperands: [...threeDesign.meritOperands, g1, g2, g3] };
const env2 = environmentDesign(design, 'env2');
const env3 = environmentDesign(design, 'env3');

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

function render(Window, one, state) {
    shown(one, state);
    return renderToStaticMarkup(withDesign(h(Window, { c, theme: c, t: en }), one));
}

// The row under the plot as a window draws it for `one`.
function badgeRow(one) {
    const Row = () => h(BadgeRow, { c, t: en, environment: useEnvironmentChoice(one, { overlay: true }), evalBadge: false });
    return renderToStaticMarkup(withDesign(h(Row), one));
}

// ── GD/GDD ──────────────────────────────────────────────────────────────────
const GD = {
    side: 'front', target: 'R', quantity: 'gdd', pol: 'avg', theta: 0, lamStart: 450, lamEnd: 650,
    refLam: 550, showRef: true, yAuto: true, showTargets: true, showTable: false,
};
gdGddSession.write(design, GD);
const GD_OPTIONS = { side: 'front', target: 'R', polarization: 'avg', thetaDeg: 0, preview: false, lambdaStart: 450, lambdaEnd: 650 };
const gdOf = one => computeGdGddSpectrum(one, GD_OPTIONS);
const gdState = (one, state) => hooked(() => useGDGDDState(one), one, state);
const VIEW_OPTIONS = {
    quantity: 'gdd', referenceLambda: 550, showReference: true,
    outsideLabel: en.materialRange.outsideColumn, units: en.units, environmentLabel: ENV,
};
const viewOf = (raw, sets = null) => buildGdGddView(raw, { ...VIEW_OPTIONS, sets }, en.gdgdd, GD_COLORS, LAMBDA);
const chartOf = (view, targets = []) => buildGDChartOption({
    data: view.plotData, sets: view.sets, meta: view.meta, referenceLambda: 550, showReference: true,
    colors: CHART, curveColors: GD_COLORS, targets, yRange: view.autoRange?.range,
    yInterval: view.autoRange?.interval, xLabel: en.spectralAxis.nm,
});
const csvOf = view => csvFromRows(view.tableColumns, view.tableRows);

// 1. Without environments.
{
    const got = gdState(lone, { choice: 'all' });
    const raw = gdOf(lone);
    assert.ok(same(got.raw, raw) && got.sets === null, 'GD/GDD: a design without environments computes as itself, a stored All aside');
    const view = viewOf(got.raw, got.sets);
    const option = chartOf(view);
    assert.deepEqual([view.sets, option.legend.show, option.series[0].name, option.series[0].lineStyle.color, view.tableColumns[0].key],
        [undefined, false, view.meta.label, GD_COLORS.curve, 'lambda'], 'GD/GDD: one curve in the curve colour, no legend, no Environment column');
}
{
    const withEnvironments = { ...lone, environments: threeDesign.environments };
    gdGddSession.write(lone, { showTable: true });
    const first = render(GDGDDEvaluation, withEnvironments);
    const row = badgeRow(withEnvironments);
    assert.ok(row.includes(`>${ENV}</span>`) && first.includes(row), 'GD/GDD: a design with environments draws the row under the plot');
    assert.equal(first.replace(row, ''), render(GDGDDEvaluation, lone),
        'GD/GDD: and shown in environment 1 renders the markup it renders without environments, the row aside');
    gdGddSession.write(lone, { showTable: false });
}

// 2. One environment.
{
    assert.ok(!same(gdOf(design), gdOf(env2)) && !same(gdOf(design), gdOf(env3)), 'the environments compute three different spectra');
    assert.ok(same(gdState(design).raw, gdOf(design)), 'GD/GDD: Current on environment 1 is the design itself');
    assert.ok(same(gdState(design, { current: 'env2' }).raw, gdOf(env2)), 'GD/GDD: Current follows the current environment');
    const chosen = gdState(design, { choice: 'env3' });
    assert.ok(same(chosen.raw, gdOf(env3)) && chosen.sets === null, 'GD/GDD: an environment chosen by its id, though off, is computed apart');
}

// 3. All.
{
    const all = gdState(design, { choice: 'all' });
    assert.deepEqual(all.sets.map(set => [set.env.number, set.env.label]), [[1, '1 · BK7'], [2, '2 · Sapphire']],
        'GD/GDD: All computes every environment that is on');
    assert.ok(same(all.raw, gdOf(design)) && same(all.sets[1].raw, gdOf(env2)), 'GD/GDD: each environment\'s spectrum is its design\'s');
    const view = viewOf(all.raw, all.sets);
    const option = chartOf(view);
    const label = view.meta.label;
    const curves = option.series.filter(s => s.name?.startsWith(`${label} (`));
    assert.deepEqual(curves.map(s => [s.name, s.lineStyle.color, s.data.length > 0]), [
        [`${label} (1 · BK7)`, environmentColor(GD_COLORS, 1), true], [`${label} (2 · Sapphire)`, environmentColor(GD_COLORS, 2), true],
    ], 'GD/GDD: under All each environment\'s curve in its colour, named after it');
    assert.deepEqual(curves.map(s => s.markLine?.data ?? []), [[{ xAxis: 550 }], []], 'GD/GDD: the reference wavelength\'s line on the first');
    assert.ok(option.legend.show && same(option.legend.data.map(d => d.name ?? d), ['1 · BK7', '2 · Sapphire']),
        'GD/GDD: the legend above the plot names the environments');

    const parts = all.sets.map(set => viewOf(set.raw).tableRows);
    assert.deepEqual([view.tableColumns[0].key, view.tableColumns[0].label, view.tableColumns[1].key], ['env', ENV, 'lambda'],
        'GD/GDD: the table starts with an Environment column');
    assert.deepEqual(view.tableRows.map(r => r.env), [...parts[0].map(() => '1 · BK7'), ...parts[1].map(() => '2 · Sapphire')],
        'GD/GDD: and lists each environment\'s rows in turn');
    // eslint-disable-next-line no-unused-vars
    assert.ok(same(view.tableRows.slice(parts[0].length).map(({ env, ...r }) => r), parts[1]), 'GD/GDD: on that environment\'s own grid');
    assert.ok(csvOf(view).startsWith(`${ENV},${LAMBDA},`), 'GD/GDD: and so does the CSV');
    gdGddSession.write(design, { showTable: true });
    const html = render(GDGDDEvaluation, design, { choice: 'all' });
    assert.ok(html.includes(`>${ENV}</th>`), 'GD/GDD: the window\'s table has the Environment column under All');
    assert.ok(!render(GDGDDEvaluation, design, { choice: 'env2' }).includes(`>${ENV}</th>`), 'GD/GDD: and none with one environment');
    gdGddSession.write(design, { showTable: false });

    // The sampling note in Settings speaks for every curve drawn: each
    // environment's dispersion models once, sapphire's beside BK7's, and the
    // points added to all of them.
    const note = renderToStaticMarkup(h(SamplingNote, { c, text: en.gdgdd, raw: all.raw, sets: all.sets }));
    const ownModels = all.sets[0].raw.models;
    const wetOnly = all.sets[1].raw.models.filter(model => !ownModels.includes(model));
    const added = all.sets.reduce((sum, set) => sum + (set.raw.adaptivePointCount || 0), 0);
    assert.ok(wetOnly.length > 0 && [...ownModels, ...wetOnly].every(model => note.includes(esc(model)))
        && note.includes(esc(en.gdgdd.samplingNote(added))),
        'GD/GDD: under All the sampling note names every environment\'s models and the points added to all');
}
{
    // The automatic range over curves made up for it: 0 to 9.8 fs in
    // environment 1 alone, 20 to 29.8 fs in the other.
    const curve = ys => ({ lambda: ys.map((_, i) => 500 + i), gd: ys });
    const env = (number, label) => ({ number, label });
    const low = Array.from({ length: 50 }, (_, i) => i / 5);
    const high = low.map(v => v + 20);
    const spiked = low.map((v, i) => (i === 10 || i === 30 ? 1e4 : v));
    const viewOver = sets => buildGdGddView(curve(low), { quantity: 'gd', sets, environmentLabel: ENV }, en.gdgdd);
    const alone = buildGdGddView(curve(low), { quantity: 'gd' }, en.gdgdd);
    const both = viewOver([{ env: env(1, '1'), raw: curve(low) }, { env: env(2, '2'), raw: curve(high) }]);
    assert.ok(alone.autoRange.range[1] < 20 && both.autoRange.range[0] <= 0 && both.autoRange.range[1] >= 29.8,
        'GD/GDD: the automatic range takes in every curve');
    const spikes = viewOver([{ env: env(1, '1'), raw: curve(low) }, { env: env(2, '2'), raw: curve(spiked) }]);
    assert.deepEqual([alone.autoRange.outside, spikes.autoRange.outside], [0, 2], 'GD/GDD: and the off-scale count counts the samples of every curve');

    // Ten environments of 20 001 samples each are more values than a call
    // takes as arguments; the plot's own range still spans every curve.
    const long = Array.from({ length: 20001 }, (_, i) => Math.sin(i / 500));
    const ten = viewOver(Array.from({ length: 10 }, (_, k) => ({ env: env(k + 1, `${k + 1}`), raw: curve(long.map(v => v + k)) })));
    const tall = chartOf({ ...ten, autoRange: null });
    assert.ok(tall.yAxis.min <= -1 && tall.yAxis.max >= 10, 'GD/GDD: ten long environments draw, the range over every curve');

    // A knot in one environment, a material read outside its data in the other.
    const knotted = { lambda: [500, 501, 502], gd: [1, 1.5, 2], knotSamples: [{ index: 1, gd: [1.2, 1.8] }] };
    const outside = { lambda: [500.5, 501.5], gd: [3, 4], outsideRange: ['TiO2', null] };
    const mixed = buildGdGddView(knotted, {
        quantity: 'gd', outsideLabel: 'Outside', environmentLabel: ENV,
        sets: [{ env: env(1, 'A'), raw: knotted }, { env: env(2, 'B'), raw: outside }],
    }, en.gdgdd);
    assert.deepEqual(mixed.tableColumns.map(col => col.key), ['env', 'lambda', 'knot', 'outside', 'gd'],
        'GD/GDD: under All the table has every column any environment needs');
    assert.deepEqual(mixed.tableRows.map(r => [r.env, r.lambda, r.knot ?? '', r.outside ?? '', r.gd]), [
        ['A', 500, '', '', 1], ['A', 501, 'λ−', '', 1.2], ['A', 501, 'λ+', '', 1.8], ['A', 502, '', '', 2],
        ['B', 500.5, '', 'TiO2', 3], ['B', 501.5, '', '', 4],
    ], 'GD/GDD: each environment\'s rows with its own knots and materials');
}

// 4. Targets.
{
    const ids = got => got.targets.map(op => op.id);
    assert.deepEqual(ids(gdState(lone)), ['g1'], 'GD/GDD: a design without environments draws its rows');
    assert.deepEqual(ids(gdState(design)), ['g1'], 'GD/GDD: environment 1 draws its rows, not the sapphire row');
    assert.deepEqual(ids(gdState(design, { current: 'env2' })), ['g1', 'g2'], 'GD/GDD: the current environment 2 draws the sapphire row');
    assert.deepEqual(ids(gdState(design, { choice: 'env3' })), ['g1', 'g3'], 'GD/GDD: environment 3 chosen draws its own');
    assert.deepEqual(ids(gdState(design, { choice: 'all' })), ['g1', 'g2', 'g3'], 'GD/GDD: All draws every row');

    // What the target editor writes for a gesture, on a plot ruled from -100
    // to 100 fs², a level grid of 10 fs².
    const edit = (state, gesture) => {
        shown(design, state);
        const written = [];
        let editor = null;
        const Probe = () => {
            const got = useGDGDDState(design);
            editor = useGdGddTargetEditor({ design, updateDesign: patch => written.push(patch), state: got, yRange: [-100, 100] });
            return null;
        };
        renderToStaticMarkup(withDesign(h(Probe), design));
        assert.equal(editor.levelStep, 10);
        gesture(editor);
        return written[0].meritOperands;
    };
    const draw = state => {
        const rows = edit(state, editor => editor.onCreate({ x0: 506, y0: 44, x1: 506, y1: 44 }));
        const added = rows[rows.length - 1];
        return [rows.length, added.type, added.lambdaStart, added.target, 'env' in added];
    };
    assert.deepEqual(draw({ choice: 'env2' }), [9, 'GDD', 510, 40, false],
        'GD/GDD: in 2 · Sapphire a drawn target snaps to the grid, not to a row of environment 3, and is scored in every environment');
    assert.deepEqual(draw({ choice: 'env3' }), [9, 'GDD', 503, 43, false], 'GD/GDD: and to that row where it is drawn');
    assert.deepEqual(draw({ current: 'env3' }), [9, 'GDD', 503, 43, false], 'GD/GDD: as it does when environment 3 is the current one');
    const drag = state => {
        const rows = edit(state, editor => editor.onEdit({ opId: 'g2', kind: 'point', type: 'GDD' }, { x0: 501, y0: 44, x1: 501, y1: 44 }));
        const moved = rows.find(op => op.id === 'g2');
        return [rows.length, rows[7] === g3, moved.lambdaStart, moved.target, moved.env];
    };
    assert.deepEqual(drag({ choice: 'env2' }), [8, true, 500, 40, 'env2'],
        'GD/GDD: a dragged target snaps to the rows shown, keeps its environment and leaves every row in the list');
    assert.deepEqual(drag({ choice: 'all' }).slice(2, 4), [503, 43], 'GD/GDD: under All it snaps to every row');
}

// ── Ellipsometry ────────────────────────────────────────────────────────────
const EL = {
    mode: 'spectral', side: 'front', lambdaStart: 400, lambdaEnd: 800, lambdaStep: 50, thetaDeg: 65,
    deltaConvention: 'azzam', showPsi: true, showDelta: true, showTable: false,
};
ellipsometrySession.write(design, EL);
const sweepOf = one => computeEllipsometrySweep(one, EL);
const elState = (one, state) => hooked(() => useEllipsometryEvaluation(one), one, state);
const LABELS = { lambda: LAMBDA, aoi: en.spectrumExchange.aoiLabel };
const elChart = (got, extra = {}) => buildEllipsometryOption(got.data, CHART, en.spectralAxis.nm, {
    curve: EL_COLORS, spectral: true, sets: got.sets, ...extra,
});
const tableOf = got => buildEllipsometryTable('spectral', got.data, LABELS, got.sets);

// 1. Without environments.
{
    const got = elState(lone, { choice: 'all' });
    const data = sweepOf(lone);
    assert.ok(same(got.data, data) && got.sets === null, 'Ellipsometry: a design without environments computes as itself, a stored All aside');
    const option = elChart(got);
    assert.deepEqual([option.legend.show, option.series.map(s => s.name), option.yAxis.map(axis => [axis.name, axis.nameTextStyle.color])],
        [false, ['Ψ', 'Δ'], [['°', EL_COLORS.psi], ['°', EL_COLORS.delta]]], 'Ellipsometry: Ψ and Δ in their own colours, the axes in theirs');
    const table = tableOf(got);
    assert.equal(csvFromRows(table.columns, table.rows).split('\n')[0], `${LAMBDA},Ψ (°),Δ (°)`, 'Ellipsometry: the CSV keeps today\'s columns');
}
{
    const withEnvironments = { ...lone, environments: threeDesign.environments };
    ellipsometrySession.write(lone, { showTable: true });
    const first = render(EllipsometryEvaluation, withEnvironments);
    const row = badgeRow(withEnvironments);
    assert.ok(first.includes(row), 'Ellipsometry: a design with environments draws the row under the plot');
    assert.equal(first.replace(row, ''), render(EllipsometryEvaluation, lone),
        'Ellipsometry: and shown in environment 1 renders the markup it renders without environments, the row aside');
    ellipsometrySession.write(lone, { showTable: false });
}

// 2. One environment.
{
    assert.ok(!same(sweepOf(design), sweepOf(env2)) && !same(sweepOf(design), sweepOf(env3)), 'the environments compute three different sweeps');
    assert.ok(same(elState(design).data, sweepOf(design)), 'Ellipsometry: Current on environment 1 is the design itself');
    assert.ok(same(elState(design, { current: 'env2' }).data, sweepOf(env2)), 'Ellipsometry: Current follows the current environment');
    const chosen = elState(design, { choice: 'env3' });
    assert.ok(same(chosen.data, sweepOf(env3)) && chosen.sets === null, 'Ellipsometry: an environment chosen by its id, though off, is computed apart');
}

// 5. All.
{
    const all = elState(design, { choice: 'all' });
    assert.deepEqual(all.sets.map(set => [set.env.number, set.env.label]), [[1, '1 · BK7'], [2, '2 · Sapphire']],
        'Ellipsometry: All computes every environment that is on');
    assert.ok(same(all.sets[0].data, sweepOf(design)) && same(all.sets[1].data, sweepOf(env2)), 'Ellipsometry: each its design\'s sweep');
    const option = elChart(all);
    const [one, two] = [environmentColor(EL_COLORS, 1), environmentColor(EL_COLORS, 2)];
    assert.deepEqual(option.series.filter(s => s.data.length).map(s => [s.name, s.lineStyle.color, s.lineStyle.type, s.yAxisIndex]), [
        ['Ψ (1 · BK7)', one, 'solid', 0], ['Δ (1 · BK7)', one, 'dashed', 1], ['Ψ (2 · Sapphire)', two, 'solid', 0], ['Δ (2 · Sapphire)', two, 'dashed', 1],
    ], 'Ellipsometry: Ψ solid and Δ dashed in each environment\'s colour, named after it');
    assert.deepEqual(option.yAxis.map(axis => [axis.name, axis.nameTextStyle.color, axis.axisLabel.color]),
        [['Ψ (°)', c.text, c.text], ['Δ (°)', c.text, c.text]], 'Ellipsometry: the axes named Ψ (°) and Δ (°) in the text colour');
    assert.ok(option.legend.show && same(option.legend.data.map(d => d.name ?? d), ['1 · BK7', '2 · Sapphire']),
        'Ellipsometry: the legend above the plot names the environments');
    const readout = option.tooltip.formatter([{ axisValue: 600, seriesIndex: 0, value: [600, all.data.psi[4]], marker: '' }]);
    assert.ok(['Ψ (1 · BK7)', 'Δ (1 · BK7)', 'Ψ (2 · Sapphire)', 'Δ (2 · Sapphire)'].every(name => readout.includes(name)),
        'Ellipsometry: the readout names each curve\'s environment');

    const overlays = [{ id: 'm', name: 'witness', psi: true, aoi: 65, x: [500, 600], y: [20, 30], fitTarget: false, color: null }];
    const measured = got => elChart(got, { overlays }).series.find(s => s.name === 'witness');
    assert.ok(same(measured(all), measured({ data: all.data, sets: null })) && measured(all).lineStyle.color === EL_COLORS.psi,
        'Ellipsometry: a measured curve is drawn under All as with one environment');

    const table = tableOf(all);
    assert.deepEqual(table.columns.map(col => col.label),
        [LAMBDA, 'Ψ (°) (1 · BK7)', 'Δ (°) (1 · BK7)', 'Ψ (°) (2 · Sapphire)', 'Δ (°) (2 · Sapphire)'],
        'Ellipsometry: the table gives Ψ and Δ of each environment in columns named after it');
    assert.deepEqual([table.rows.length, Object.values(table.rows[2])],
        [all.data.x.length, [all.data.x[2], all.sets[0].data.psi[2], all.sets[0].data.delta[2], all.sets[1].data.psi[2], all.sets[1].data.delta[2]]],
        'Ellipsometry: a row per point of the one grid');
    assert.equal(csvFromRows(table.columns, table.rows).split('\n')[0], `${LAMBDA},Ψ (°) (1 · BK7),Δ (°) (1 · BK7),Ψ (°) (2 · Sapphire),Δ (°) (2 · Sapphire)`,
        'Ellipsometry: and so does the CSV');
    ellipsometrySession.write(design, { showTable: true });
    assert.ok(render(EllipsometryEvaluation, design, { choice: 'all' }).includes('>Ψ (°) (2 · Sapphire)</th>'), 'Ellipsometry: and the window\'s table');
    ellipsometrySession.write(design, { showTable: false });

    // The Ψ and Δ switches show each curve's line: in its colour for one
    // environment, under All in the text colour, Δ dashed as it is drawn.
    const swatches = html => [...html.matchAll(/border-top:2px (solid|dashed) ([^;"]+)/g)].map(match => `${match[1]} ${match[2]}`);
    assert.deepEqual(swatches(render(EllipsometryEvaluation, design)), [`solid ${EL_COLORS.psi}`, `solid ${EL_COLORS.delta}`],
        'Ellipsometry: one environment\'s switches show Ψ and Δ in their colours');
    assert.deepEqual(swatches(render(EllipsometryEvaluation, design, { choice: 'all' })), [`solid ${c.text}`, `dashed ${c.text}`],
        'Ellipsometry: under All the switches show Ψ solid and Δ dashed in the text colour');
}

// ── Both windows: the droplist and the range notice ─────────────────────────
{
    const tip = literal(esc(en.analysisChrome.environmentTip));
    const droplist = html => {
        const match = html.match(new RegExp(`<label[^>]*><span[^>]*>${ENV}</span>(<select[^>]*title="[^"]*${tip}"[^>]*>.*?</select>)</label>`));
        return match && { select: match[1], at: match.index };
    };
    const optionsOf = html => [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1]);
    for (const [name, Window] of [['GD/GDD', GDGDDEvaluation], ['Ellipsometry', EllipsometryEvaluation]]) {
        const html = render(Window, design, { current: 'env2' });
        const select = droplist(html);
        assert.ok(select, `${name}: the Environment droplist on a design with environments`);
        assert.deepEqual(optionsOf(select.select), ['Current (2)', '1 · BK7', '2 · Sapphire', '3', 'All'], `${name}: Current, each environment and All`);
        assert.ok(select.at < html.indexOf('<section'), `${name}: under the plot, over the Results strip`);
        assert.equal(droplist(render(Window, lone)), null, `${name}: and none without environments`);
    }
    const ids = materials => materials.map(m => m.id);
    for (const [name, materialsOf] of [
        ['GD/GDD', state => gdState(design, state).materials],
        ['Ellipsometry', state => elState(design, state).materials],
    ]) {
        assert.ok(!ids(materialsOf()).includes('builtin:Al2O3'), `${name}: the range notice reads environment 1's own materials`);
        assert.ok(ids(materialsOf({ choice: 'env2' })).includes('builtin:Al2O3'), `${name}: environment 2's sapphire when it is chosen`);
        const every = ids(materialsOf({ choice: 'all' }));
        assert.ok(every.includes('builtin:Al2O3') && every.includes('builtin:BK7'), `${name}: every environment shown under All`);
    }

    // Environment 2 glued under NOA 61, whose data start at 450 nm: the notice
    // over GD/GDD's range and at Ellipsometry's one wavelength, and the band
    // GD/GDD shades, in environment 2 and under All, never in environment 1.
    const [base, , third] = design.environments;
    const glued = { ...design, environments: [base, { id: 'env2', name: 'Glued', incidentMedium: 'builtin:NOA61' }, third] };
    gdGddSession.write(glued, { quantity: 'phase', lamStart: 420, lamEnd: 650 });
    ellipsometrySession.write(glued, { mode: 'angular', lambdaNm: 420, angleStart: 40, angleEnd: 70, angleStep: 5 });
    const notice = (Window, state) => render(Window, glued, state).includes('⚠');
    for (const [name, Window] of [['GD/GDD', GDGDDEvaluation], ['Ellipsometry', EllipsometryEvaluation]]) {
        assert.deepEqual([{}, { choice: 'env2' }, { choice: 'all' }].map(state => notice(Window, state)), [false, true, true],
            `${name}: the range notice names a material of every environment shown`);
    }
    const bands = state => uncoveredMaterialRegions(gdState(glued, state).materials, [420, 650]).flatMap(band => band.materials);
    assert.deepEqual([bands(), bands({ choice: 'all' })], [[], ['NOA 61 (optical adhesive, cured)']],
        'GD/GDD: and the shaded band where its data stop');
    gdGddSession.write(glued, GD);
    ellipsometrySession.write(glued, EL);
    shown(design);
}

console.log('environments_gd_ellipsometry: ALL PASS');
