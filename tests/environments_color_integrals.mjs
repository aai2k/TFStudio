/**
 * Color Evaluation and Integral Values on a design with environments, each
 * with the Environment droplist in the row under its plot
 * (chrome/environmentChoice.js).
 *
 *   1. One environment: each window computes the design of the environment
 *      chosen or current, environment 1's being the design itself and one that
 *      is off computed when chosen; a design without environments computes as
 *      itself, and its tables and CSV keep today's columns.
 *   2. Color Evaluation under All: the colour at each angle in every
 *      environment that is on, each report naming its environment; the
 *      Differences measure each environment against the first one at the same
 *      angle; the tables and the CSV start with the environment, one angle
 *      under All being a row per environment; the diagram draws a path per
 *      environment, named after it and ringed in its colour; the lines under
 *      the diagram and the note over the Differences name the environments.
 *   3. Integral Values under All: each environment's spectrum and integrals,
 *      no Min and Max marks on the plot, a curve per environment in its colour,
 *      the table listing every integral in each environment with an
 *      Environment column, the CSV the same.
 *   4. Both windows draw the droplist with Current, each environment and All
 *      on a design with environments, and none without; the range notice reads
 *      the materials of every environment shown.
 *   5. Color Evaluation's patches under All, its Differences measured against
 *      the first environment shown when environment 1 is off, and against the
 *      first angle when All holds one environment; a custom integral's rows
 *      under All, its buttons and the note on a band the spectrum does not
 *      span on its first row alone.
 *
 * Under a cone, analysis_evaluation_worker.mjs checks what each window asks
 * the worker for.
 *
 * Run: node tests/environments_color_integrals.mjs
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
const { environmentChoiceSession } = await import('../src/components/windows/analysis/chrome/environmentChoice.js');
const { currentEnvironmentSession } = await import('../src/components/windows/design/environments/currentEnvironment.js');
const { environmentDesign } = await import('../src/utils/environments/environments.js');
const { ANALYSIS_DEFAULTS, environmentColor } = await import('../src/constants/analysisDefaults.js');
const { ciede2000 } = await import('../src/utils/physics/colorimetry.js');
const { ColorEvaluation } = await import('../src/components/windows/analysis/colorEvaluation/ColorEvaluation.js');
const { useColorReports } = await import('../src/components/windows/analysis/colorEvaluation/useColorReports.js');
const { computeColorReports } = await import('../src/components/windows/analysis/colorEvaluation/colorModel.js');
const { acrossEnvironments, differenceRows, exportTable, viewTable } = await import('../src/components/windows/analysis/colorEvaluation/resultsModel.js');
const { buildChromaticityOption } = await import('../src/components/windows/analysis/colorEvaluation/chartFigure.js');
const { colorEvaluationSession } = await import('../src/components/windows/analysis/colorEvaluation/sessionState.js');
const { IntegralValues } = await import('../src/components/windows/analysis/integralValues/IntegralValues.js');
const { useIntegralValues } = await import('../src/components/windows/analysis/integralValues/useIntegralValues.js');
const { exportColumns, exportRows } = await import('../src/components/windows/analysis/integralValues/exportModel.js');
const { buildOverlayOption } = await import('../src/components/windows/analysis/integralValues/overlayFigure.js');
const { computeSpectrumForMode } = await import('../src/components/windows/analysis/integralValues/spectrum.js');
const {
    INITIAL_BUILDER, buildIntegralDefinitions, integralTable, makeCustomDefinition, newCustomDraft,
} = await import('../src/components/windows/analysis/integralValues/integralModel.js');
const { ResultsTable } = await import('../src/components/windows/analysis/integralValues/ResultsTable.js');
const { integralValuesSession } = await import('../src/components/windows/analysis/integralValues/sessionState.js');

const h = React.createElement;
const c = makeTheme();
const en = makeLocale('en');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const count = (text, part) => text.split(part).length - 1;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const CE_COLORS = ANALYSIS_DEFAULTS.colorEvaluation.colors;
const IV_COLORS = ANALYSIS_DEFAULTS.integralValues.colors;
const WORDS = { ...en.colorEval, environmentColumn: en.environments.environment };

const lone = oneEnvironmentDesign();
const design = threeEnvironmentDesign();

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

// ── Color Evaluation ────────────────────────────────────────────────────────
const OPTIONS = {
    evalMode: 'front', characteristic: 'R', pol: 'avg', thetas: [0, 30],
    observer: '2', illuminant: 'D65', step: 5,
};
const reportsOf = one => computeColorReports({ ...OPTIONS, design: one, setError() {} });
const colorOf = (one, state) => hooked(() => useColorReports(one, OPTIONS), one, state);

// 1. One environment.
{
    const base = colorOf(design);
    assert.ok(same(base.reports, reportsOf(design)) && base.reports.every(entry => !('env' in entry)),
        'Color: Current on environment 1 is the design itself, its reports naming no environment');
    assert.ok(same(colorOf(design, { current: 'env2' }).reports, reportsOf(environmentDesign(design, 'env2'))),
        'Color: Current follows the current environment');
    assert.ok(same(colorOf(design, { choice: 'env3' }).reports, reportsOf(environmentDesign(design, 'env3'))),
        'Color: an environment chosen by its id, though off, is computed apart');
    assert.ok(same(colorOf(lone, { choice: 'all' }).reports, reportsOf(lone)),
        'Color: a design without environments computes as itself, a stored All aside');
    const rows = viewTable(base.reports, { resultsView: 'table', tableSpace: 'xyY' }, WORDS, en.units);
    assert.deepEqual(rows.columns.map(col => col.key), ['aoi', 'x', 'y', 'Y'], 'Color: one environment\'s Table keeps today\'s columns');
    const csv = exportTable(base.reports, WORDS, en.units);
    assert.ok(csv.columns[0].key === 'aoi' && csv.rows.every(row => !('env' in row)), 'Color: and its CSV');
    const [first, second] = base.reports.map(entry => entry.report.Lab);
    const [, shift] = differenceRows(base.reports);
    assert.ok(shift.dEab === Math.hypot(second.L - first.L, second.a - first.a, second.b - first.b) && shift.dE00 === ciede2000(first, second),
        'Color: one environment\'s Differences measure each angle against the first');
}

// 2. All.
const all = colorOf(design, { choice: 'all' });
{
    const { reports } = all;
    assert.deepEqual(reports.map(entry => [entry.env.number, entry.env.label, entry.theta]),
        [[1, '1 · BK7', 0], [1, '1 · BK7', 30], [2, '2 · Sapphire', 0], [2, '2 · Sapphire', 30]],
        'Color: All gives every angle in each environment that is on, in turn, each naming its environment');
    // eslint-disable-next-line no-unused-vars
    const apart = reports.map(({ env, ...entry }) => entry);
    assert.ok(same(apart, [...reportsOf(design), ...reportsOf(environmentDesign(design, 'env2'))]),
        'Color: each environment\'s colour is its design\'s, computed apart');

    const differences = differenceRows(reports);
    assert.ok(differences.slice(0, 2).every(row => row.dEab === 0 && row.dE00 === 0 && row.env === '1 · BK7'),
        'Color: under All the first environment\'s rows read zero');
    const lab = (number, theta) => reports.find(entry => entry.env.number === number && entry.theta === theta).report.Lab;
    const [base30, wet30] = [lab(1, 30), lab(2, 30)];
    const row = differences[3];
    assert.deepEqual([row.env, row.aoi, row.dL, row.dEab, row.dE00],
        ['2 · Sapphire', 30, wet30.L - base30.L, Math.hypot(wet30.L - base30.L, wet30.a - base30.a, wet30.b - base30.b), ciede2000(base30, wet30)],
        'Color: and every other row is measured against the first environment at the same angle');

    const table = viewTable(reports, { resultsView: 'table', tableSpace: 'xyY' }, WORDS, en.units);
    assert.deepEqual([table.columns.map(col => col.label).slice(0, 2), table.rows.map(r => r.env)],
        [['Environment', en.colorEval.aoi], ['1 · BK7', '1 · BK7', '2 · Sapphire', '2 · Sapphire']],
        'Color: the Table starts each row with its environment');
    const diff = viewTable(reports, { resultsView: 'differences' }, WORDS, en.units);
    assert.deepEqual(diff.columns.map(col => col.key).slice(0, 3), ['env', 'aoi', 'dL'], 'Color: and so do the Differences');
    const csv = exportTable(reports, WORDS, en.units);
    assert.deepEqual([csv.columns.slice(0, 2).map(col => col.key), csv.rows[2].env, csv.rows[3].dEab],
        [['env', 'aoi'], '2 · Sapphire', row.dEab], 'Color: and the CSV, with the Differences as the view gives them');
    const oneAngle = colorOf(design, { choice: 'all' }).reports.filter(entry => entry.theta === 0);
    const single = viewTable(oneAngle, { resultsView: 'table', tableSpace: 'lab' }, WORDS, en.units);
    assert.ok(single.columns && single.rows.length === 2, 'Color: one angle under All is a row per environment in one colour space');

    const option = buildChromaticityOption({
        reports, observer: '2', diagram: 'ab', exposure: 'fit', c, tr: en.colorEval, units: en.units, colors: CE_COLORS, fill: false,
        display: { showWavelengths: false, showWhite: true, showPlanckian: false, showSrgb: false },
    });
    const paths = option.series.filter(s => s.name === '1 · BK7' || s.name === '2 · Sapphire');
    assert.ok(paths.length === 4 && !option.series.some(s => s.name === en.colorEval.chartCoating),
        'Color: the diagram draws a path per environment, named after it, and no Coating path');
    assert.deepEqual([...new Set(paths.map(s => `${s.name} ${s.type === 'line' ? s.lineStyle.color : s.itemStyle.borderColor}`))],
        [`1 · BK7 ${environmentColor(CE_COLORS, 1)}`, `2 · Sapphire ${environmentColor(CE_COLORS, 2)}`],
        'Color: each ringed and joined in its environment\'s colour');
    assert.ok(['1 · BK7', '2 · Sapphire'].every(name => option.legend.data.includes(name)), 'Color: the legend names the environments');
    const plain = buildChromaticityOption({
        reports: reportsOf(design), observer: '2', diagram: 'ab', exposure: 'fit', c, tr: en.colorEval, units: en.units, colors: CE_COLORS, fill: false,
        display: { showWavelengths: false, showWhite: true, showPlanckian: false, showSrgb: false },
    });
    assert.ok(plain.series.some(s => s.name === en.colorEval.chartCoating && s.type === 'scatter' && s.itemStyle.borderColor === CE_COLORS.coating),
        'Color: one environment draws the Coating path as before');
}
{
    colorEvaluationSession.write(design, { angleMode: 'list', thetas: [0, 30], step: 5, showTable: false });
    shown(design, { choice: 'all' });
    const lines = renderToStaticMarkup(withDesign(h(ColorEvaluation, { c, t: en }), design));
    assert.ok(count(lines, '>1 · BK7</td>') === 2 && count(lines, '>2 · Sapphire</td>') === 2,
        'Color: each line under the diagram starts with its environment');
    colorEvaluationSession.write(design, { showTable: true, resultsView: 'differences' });
    const strip = renderToStaticMarkup(withDesign(h(ColorEvaluation, { c, t: en }), design));
    assert.ok(strip.includes(esc(en.colorEval.againstEnvironment('1 · BK7'))),
        'Color: the note over the Differences names the environment they are measured against');
    colorEvaluationSession.write(design, { showTable: false, resultsView: 'table' });
    shown(design);
}

// ── Integral Values ─────────────────────────────────────────────────────────
const PARAMS = { lambdaStart: 380, lambdaEnd: 780, lambdaStep: 5, theta: 0, polarization: 'avg' };
for (const one of [lone, design]) integralValuesSession.write(one, PARAMS);
const spectrumOf = one => computeSpectrumForMode(one, PARAMS, 'front');
const integralsOf = (one, state) => hooked(() => useIntegralValues(one, 'front'), one, state);

// 1. One environment.
{
    const base = integralsOf(design);
    assert.ok(same(base.spectrum, spectrumOf(design)) && base.sets === null, 'Integrals: Current on environment 1 is the design itself');
    assert.ok(same(base.results, integralTable(spectrumOf(design), []).results), 'Integrals: with its own results');
    assert.ok(base.selectedResult && base.selectedResult === base.results.Tvis, 'Integrals: the plot marks the selected integral\'s Min and Max');
    assert.ok(same(integralsOf(design, { current: 'env2' }).spectrum, spectrumOf(environmentDesign(design, 'env2'))),
        'Integrals: Current follows the current environment');
    assert.ok(same(integralsOf(design, { choice: 'env3' }).spectrum, spectrumOf(environmentDesign(design, 'env3'))),
        'Integrals: an environment chosen by its id, though off, is computed apart');
    const stale = integralsOf(lone, { choice: 'all' });
    assert.ok(same(stale.spectrum, spectrumOf(lone)) && stale.sets === null, 'Integrals: a design without environments computes as itself');
    assert.deepEqual(exportColumns(en).map(col => col.key), ['label', 'value', 'percent', 'min', 'lamAtMin', 'max', 'lamAtMax', 'band'],
        'Integrals: one environment\'s CSV keeps today\'s columns');
    assert.ok(exportRows(base.integrals, base.results, en.units).every(row => !('env' in row)), 'Integrals: and rows');
}

// 2. All.
{
    const model = integralsOf(design, { choice: 'all' });
    const wet = environmentDesign(design, 'env2');
    assert.deepEqual(model.sets.map(set => [set.env.number, set.env.label]), [[1, '1 · BK7'], [2, '2 · Sapphire']],
        'Integrals: All computes every environment that is on');
    assert.ok(same(model.sets[1].spectrum, spectrumOf(wet)) && same(model.sets[1].results, integralTable(spectrumOf(wet), []).results),
        'Integrals: each environment\'s spectrum and integrals are its design\'s');
    assert.equal(model.selectedResult, null, 'Integrals: under All the plot marks no Min and Max');

    const rows = exportRows(model.integrals, model.sets, en.units);
    assert.deepEqual(exportColumns(en, model.sets).map(col => col.key).slice(0, 3), ['label', 'env', 'value'],
        'Integrals: the CSV gives each row\'s environment after the integral');
    assert.deepEqual(rows.slice(0, 3).map(row => [row.label, row.env]), [['Tvis', '1 · BK7'], ['Tvis', '2 · Sapphire'], ['Rvis', '1 · BK7']],
        'Integrals: a row per integral and environment, each integral\'s environments together');
    assert.equal(rows[1].value, model.sets[1].results.Tvis.value);

    const option = buildOverlayOption({
        spectrum: model.spectrum, sets: model.sets, char: 'R', weighting: null, minMaxMarks: null,
        colors: { text: '#eeeeee', grid: '#333333' }, labels: en.integralValues, units: en.units, curve: IV_COLORS,
    });
    assert.deepEqual(option.series.map(s => [s.name, s.lineStyle.color]),
        [['1 · BK7', environmentColor(IV_COLORS, 1)], ['2 · Sapphire', environmentColor(IV_COLORS, 2)]],
        'Integrals: the plot draws the selected integral\'s curve in each environment, in its colour');

    shown(design, { choice: 'all' });
    const html = renderToStaticMarkup(withDesign(h(IntegralValues, { c, theme: c, t: en }), design));
    const header = new RegExp(`<th[^>]*>${en.environments.environment}</th>`);
    assert.ok(header.test(html), 'Integrals: the table has an Environment column under All');
    assert.ok(count(html, '>Tvis</td>') === 1 && count(html, '>1 · BK7</span></td>') === 10 && count(html, '>2 · Sapphire</span></td>') === 10,
        'Integrals: and lists every integral in each environment, its name on its first row');
    shown(design);
    assert.ok(!header.test(renderToStaticMarkup(withDesign(h(IntegralValues, { c, theme: c, t: en }), design))),
        'Integrals: and none with one environment shown');
}

// ── Both windows: the droplist and the range notice ─────────────────────────
{
    const literal = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tip = literal(esc(en.analysisChrome.environmentTip));
    const droplist = html => html.match(new RegExp(`<label[^>]*><span[^>]*>${en.environments.environment}</span>(<select[^>]*title="[^"]*${tip}"[^>]*>.*?</select>)</label>`));
    const optionsOf = html => [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1]);
    for (const [name, Window] of [['Color', ColorEvaluation], ['Integrals', IntegralValues]]) {
        shown(design, { current: 'env2' });
        const select = droplist(renderToStaticMarkup(withDesign(h(Window, { c, theme: c, t: en }), design)));
        assert.ok(select, `${name}: the Environment droplist on a design with environments`);
        assert.deepEqual(optionsOf(select[1]), ['Current (2)', '1 · BK7', '2 · Sapphire', '3', 'All'],
            `${name}: Current, each environment and All`);
        shown(lone);
        assert.equal(droplist(renderToStaticMarkup(withDesign(h(Window, { c, theme: c, t: en }), lone))), null,
            `${name}: and none without environments`);
    }
    const ids = materials => materials.map(m => m.id);
    for (const [name, materialsOf] of [
        ['Color', state => colorOf(design, state).materials],
        ['Integrals', state => integralsOf(design, state).materials],
    ]) {
        assert.ok(!ids(materialsOf()).includes('builtin:Al2O3'), `${name}: the range notice reads environment 1's own materials`);
        assert.ok(ids(materialsOf({ choice: 'env2' })).includes('builtin:Al2O3'), `${name}: environment 2's sapphire when it is chosen`);
        const every = ids(materialsOf({ choice: 'all' }));
        assert.ok(every.includes('builtin:Al2O3') && every.includes('builtin:BK7'), `${name}: every environment shown under All`);
    }
    shown(design);
}

// ── Color Evaluation: the patches, and the Differences in other line-ups ────
{
    colorEvaluationSession.write(design, { angleMode: 'list', thetas: [0, 30], step: 5, showTable: true, resultsView: 'patch' });
    shown(design, { choice: 'all' });
    const patches = renderToStaticMarkup(withDesign(h(ColorEvaluation, { c, t: en }), design));
    assert.ok(count(patches, 'title="1 · BK7"') === 2 && count(patches, 'title="2 · Sapphire"') === 2,
        'Color: under All each patch has its environment over it');
    assert.ok(patches.includes('> </div><div style="width:100%;aspect-ratio:1 / 1;border-radius:6px;background:rgb(255,255,255)'),
        'Color: and the reference white a blank line, so the row starts level');
    colorEvaluationSession.write(design, { showTable: false, resultsView: 'table' });

    // Environment 1 switched off: the first environment shown is the reference.
    const [base, sapphire, third] = design.environments;
    const offBase = { ...design, environments: [{ ...base, enabled: false }, sapphire, { ...third, enabled: true }] };
    const reports = colorOf(offBase, { choice: 'all' }).reports;
    assert.deepEqual([...new Set(reports.map(entry => entry.env.label))], ['2 · Sapphire', '3'], 'Color: All without environment 1');
    const rows = differenceRows(reports);
    const lab = (number, theta) => reports.find(entry => entry.env.number === number && entry.theta === theta).report.Lab;
    assert.deepEqual([rows[1].dEab, rows[3].dE00], [0, ciede2000(lab(2, 30), lab(3, 30))],
        'Color: the first environment shown is what the others are measured against');
    colorEvaluationSession.write(offBase, { angleMode: 'list', thetas: [0, 30], step: 5, showTable: true, resultsView: 'differences' });
    shown(offBase, { choice: 'all' });
    const note = renderToStaticMarkup(withDesign(h(ColorEvaluation, { c, t: en }), offBase));
    assert.ok(note.includes(esc(en.colorEval.againstEnvironment('2 · Sapphire'))), 'Color: and the note names it');

    // All with one environment on: the shift with angle, as for one environment.
    const alone = { ...design, environments: [base, { ...sapphire, enabled: false }, third] };
    const single = colorOf(alone, { choice: 'all' }).reports;
    assert.ok(single.every(entry => entry.env.number === 1) && !acrossEnvironments(single), 'Color: All with one environment on shows that one');
    assert.ok(same(differenceRows(single).map(({ env, ...row }) => row), differenceRows(reportsOf(design))),
        'Color: and its Differences measure each angle against the first');
    colorEvaluationSession.write(alone, { angleMode: 'list', thetas: [0, 30], step: 5, showTable: true, resultsView: 'differences' });
    shown(alone, { choice: 'all' });
    const firstAngle = renderToStaticMarkup(withDesign(h(ColorEvaluation, { c, t: en }), alone));
    assert.ok(firstAngle.includes(esc(en.colorEval.againstFirst('0'))), 'Color: with the note on the first angle');
    shown(design);
}

// ── Integral Values: a custom integral under All ────────────────────────────
{
    const iv = en.integralValues;
    // A band below the spectrum's 380 nm, so the row has no value and its note.
    const draft = { ...newCustomDraft(INITIAL_BUILDER), bandMin: 300, bandMax: 360 };
    const custom = makeCustomDefinition(draft, 1, iv.customParts);
    const integrals = buildIntegralDefinitions([custom]);
    const sets = [lone, environmentDesign(design, 'env2')].map((one, k) => ({
        env: { number: k + 1, label: k ? '2 · Sapphire' : '1 · BK7' },
        results: integralTable(spectrumOf(one), [custom]).results,
    }));
    const html = renderToStaticMarkup(h(ResultsTable, {
        integrals, results: sets[0].results, sets, colors: IV_COLORS, selectedKey: custom.key,
        setSelectedKey() {}, onEdit() {}, onRemove() {}, c, t: en,
    }));
    assert.ok(count(html, `title="${esc(iv.editRow)}"`) === 1 && count(html, `title="${esc(iv.removeRow)}"`) === 1,
        'Integrals: a custom row\'s pencil and trash on its first row only');
    assert.equal(count(html, `background:${c.accent}22`), 2, 'Integrals: its rows selected together, one per environment');
    // The note beside a band the spectrum does not span: the 380-780 nm grid
    // spans neither the custom band nor the solar, UV and NIR ones.
    const notes = markup => count(markup, `style="color:${c.warning};margin-left:6px"`);
    const one = renderToStaticMarkup(h(ResultsTable, {
        integrals, results: sets[0].results, sets: null, colors: IV_COLORS, selectedKey: custom.key,
        setSelectedKey() {}, onEdit() {}, onRemove() {}, c, t: en,
    }));
    assert.ok(notes(one) > 1 && notes(html) === notes(one), 'Integrals: each such note once, on the integral\'s first row');
}

console.log('environments_color_integrals: ALL PASS');
