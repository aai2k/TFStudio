/**
 * Optical Evaluation on a design with environments, and the Environment
 * droplist in the row under its plot (chrome/environmentChoice.js,
 * chrome/badgeRow.js).
 *
 *   1. The choice: "Current" by default, an id the design no longer has read
 *      as "Current", "All" only in a window that overlays and only while the
 *      design has environments; the designs it computes, environment 1's being
 *      the design itself and an environment that is off computed when chosen;
 *      "All" over the environments that are on, environment 1 when none is;
 *      its options; the palette cycling after ten, shown in Preferences >
 *      Analysis under Palette.
 *   2. A design without environments draws no droplist and the Eval badge
 *      alone in the row under the plot, and today's chart option, readout,
 *      table columns and CSV, even with "All" left stored from when it had
 *      environments; one shown in environment 1 draws what that design draws
 *      without environments, the droplist aside. With environments the
 *      droplist sits at the left of the row under the plot in every language,
 *      labelled as in the Design Editor and as wide as its droplist there, its
 *      hover naming the choice in full, the Eval and Cone badges at its right.
 *   3. "Current" follows the current environment and changes when it changes;
 *      one environment's spectrum is the spectrum of that environment's design
 *      computed apart, chosen by its id though it is off.
 *   4. "All" gives one set of curves per environment that is on, each in its
 *      palette colour with angle fading kept, names each environment in the
 *      readout, the table and the CSV, and draws the legend above the plot
 *      only then.
 *   5. Targets on the plot are the rows scored in the environment shown, and
 *      every row under "All"; a target drawn or dragged snaps to those rows
 *      alone; a target drawn on the plot is scored in every environment, and
 *      editing one keeps its environment and the other rows.
 *   6. The range notice and bands read every environment shown, each material
 *      once; under a cone the window computes nothing on its own thread
 *      (analysis_evaluation_worker.mjs checks what it asks the worker for).
 *
 * Run: node tests/optical_evaluation_environments.mjs
 */
import assert from 'node:assert/strict';
import './_kernel.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeDesignCtx, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
const { DesignContext } = await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { oneEnvironmentDesign, threeEnvironmentDesign } = await import('./_environmentDesign.mjs');
const {
    environmentChoice, environmentChoiceSession, environmentOptions, environmentViews, rowsShown,
} = await import('../src/components/windows/analysis/chrome/environmentChoice.js');
const { DROPLIST_WIDTH } = await import('../src/components/windows/design/designEditor/EnvironmentRow.js');
const { OpticalEvaluation } = await import('../src/components/windows/analysis/opticalEvaluation/OpticalEvaluation.js');
const { useOpticalEvaluation } = await import('../src/components/windows/analysis/opticalEvaluation/useOpticalEvaluation.js');
const {
    buildChartOption, buildCSV, buildTableColumns, createTargetOperands, editTargetOperands,
} = await import('../src/components/windows/analysis/opticalEvaluation/model.js');
const { overlaidSpectrum } = await import('../src/components/windows/analysis/opticalEvaluation/environmentSeries.js');
const { computeOpticalSpectrum } = await import('../src/components/windows/analysis/opticalEvaluation/spectrum.js');
const { opticalEvaluationSession } = await import('../src/components/windows/analysis/opticalEvaluation/sessionState.js');
const { evalParamsSession } = await import('../src/state/evalParamsSession.js');
const { currentEnvironmentSession } = await import('../src/components/windows/design/environments/currentEnvironment.js');
const { environmentDesign } = await import('../src/utils/environments/environments.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { gridEvenIn } = await import('../src/utils/physics/spectralAxis.js');
const { ANALYSIS_DEFAULTS, ENVIRONMENT_COLORS, environmentColor } = await import('../src/constants/analysisDefaults.js');
const { WindowFields } = await import('../src/components/dialogs/settings/analysis/WindowFields.js');
const { resolveAnalysisSettings } = await import('../src/utils/analysisSettings.js');

const h = React.createElement;
const c = makeTheme();
const en = makeLocale('en');
const LOCALES = ['en', 'ru', 'zh', 'it'];
const COLORS = ANALYSIS_DEFAULTS.opticalEvaluation.colors;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const literal = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const options = html => [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1]);
// The window's droplist with its label, `{ whole, select, at }`: the select
// whose hover ends with the droplist's tip, or null when the window draws none.
function droplistOf(html, t) {
    const tip = literal(esc(t.analysisChrome.environmentTip));
    const match = html.match(new RegExp(`<label[^>]*><span[^>]*>[^<]*</span>(<select[^>]*title="[^"]*${tip}"[^>]*>.*?</select>)</label>`));
    return match && { whole: match[0], select: match[1], at: match.index };
}
// A badge by its hover, `{ at }`, or null when the window draws none.
function badgeOf(html, tip) {
    const at = html.search(new RegExp(`<span title="${literal(esc(tip))}"`));
    return at < 0 ? null : { at };
}

evalParamsSession.write(null, { lambdaStart: 400, lambdaEnd: 700, lambdaStep: 50, thetas: [0, 30] });
const SHOW = { T: true, R: true, A: false, Ts: false, Rs: false, As: false, Tp: false, Rp: false, Ap: false };

// The spectrum of one design on the window's grid, as the window computes it.
function spectrumOf(design) {
    const { lambdaStart, lambdaEnd, lambdaStep, wavenumberStep, spectralUnit, thetas } = evalParamsSession.peek(null, null);
    return computeOpticalSpectrum(design, { lambdaStart, lambdaEnd, lambdaStep, wavenumberStep, evenIn: gridEvenIn(spectralUnit), thetas }, 'front');
}
const sameSpectrum = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const optionOf = (data, showCurves = SHOW, targets = []) => buildChartOption({
    data, showCurves, targets, targetsVisible: targets.length > 0, overlays: [], curveColors: COLORS,
    paperColor: '#222222', bgColor: '#111111', gridColor: '#333333', textColor: '#eeeeee',
    yRange: { auto: true }, spectralUnit: 'nm', lamRange: { min: 400, max: 700 },
    spectralTitles: en.spectralAxis, curveLabels: en.opticalEval.curveLabels, legendNames: en.legendNames,
});
// What the window draws from the state of its hook: the chart option with its
// targets and the readout at one wavelength, the table's columns and the CSV.
// A function in the option is compared by what it gives, not by identity.
function drawn(got) {
    const option = optionOf(got.data, SHOW, got.targets || []);
    const readout = option.tooltip.formatter([{ axisValue: 550, seriesIndex: 0, value: [550, 1], marker: '' }]);
    return JSON.stringify([option, readout, buildTableColumns(got.data, SHOW, COLORS, 'percent', en.opticalEval.curveLabels), buildCSV(got.data, SHOW)]);
}

// Each window state under test: the current environment and the droplist's choice.
function shown(design, { current = 'base', choice = 'current' } = {}) {
    currentEnvironmentSession.write(design, { current });
    environmentChoiceSession.write(design, { choice });
}
function render(design, t, state) {
    shown(design, state);
    return renderToStaticMarkup(withDesign(h(OpticalEvaluation, { c, theme: c, t }), design));
}
// The state of the window's hook, with what the window writes to the design
// collected in `written`.
function evaluated(design, state, written = []) {
    shown(design, state);
    let got = null;
    const Probe = () => { got = useOpticalEvaluation(); return null; };
    const ctx = { ...makeDesignCtx(design), updateDesign: patch => written.push(patch) };
    renderToStaticMarkup(h(DesignContext.Provider, { value: ctx }, h(Probe)));
    return got;
}

const lone = oneEnvironmentDesign();
const design = threeEnvironmentDesign();

// ── 1. The choice ───────────────────────────────────────────────────────────
assert.equal(environmentChoice(design, 'current', true), 'current');
assert.equal(environmentChoice(design, 'env9', true), 'current', 'an environment the design no longer has reads as Current');
assert.equal(environmentChoice(design, 'env3', false), 'env3');
assert.equal(environmentChoice(design, 'all', false), 'current', 'All only in a window that overlays');
assert.equal(environmentChoice(design, 'all', true), 'all');
assert.equal(environmentChoice(lone, 'all', true), 'current', 'All does not outlive the environments it drew');
assert.equal(environmentChoiceSession.peek(design, null).choice, 'current', 'a session starts on Current');
{
    const [base] = environmentViews(design, 'current', 'base');
    assert.ok(base.design === design && base.number === 1 && base.label === '1 · BK7', 'environment 1 computes the design object itself');
    assert.ok(environmentViews(lone, 'current', 'base')[0].design === lone, 'and so does a design without environments');
    const [off] = environmentViews(design, 'env3', 'base');
    assert.deepEqual([off.id, off.number, off.label], ['env3', 3, '3']);
    assert.deepEqual(off.design, environmentDesign(design, 'env3'), 'an environment that is off is computed when chosen');
    assert.equal(environmentViews(design, 'current', 'env3')[0].id, 'env3', 'or when it is the current one');
    const all = environmentViews(design, 'all', 'base');
    assert.deepEqual(all.map(v => [v.id, v.number, v.label]), [['base', 1, '1 · BK7'], ['env2', 2, '2 · Sapphire']],
        'All is every environment that is on');
    assert.ok(all[0].design === design);
    const dark = { ...design, environments: design.environments.map(env => ({ ...env, enabled: false })) };
    assert.deepEqual(environmentViews(dark, 'all', 'base').map(v => v.id), ['base'], 'environment 1 when none is on');
}
{
    const words = en.analysisChrome;
    assert.deepEqual(environmentOptions(design, 2, true, words).map(o => [o.id, o.label]),
        [['current', 'Current (2)'], ['base', '1 · BK7'], ['env2', '2 · Sapphire'], ['env3', '3'], ['all', 'All']]);
    assert.deepEqual(environmentOptions(design, 1, false, words).map(o => o.id), ['current', 'base', 'env2', 'env3']);
    assert.equal(ENVIRONMENT_COLORS.length, 10);
    assert.deepEqual([1, 6, 10, 11, 12].map(n => environmentColor(COLORS, n)),
        ['#ef5350', '#ec407a', ENVIRONMENT_COLORS[9], '#ef5350', '#ffa726'], 'environment n draws in colour n, cycling after ten');
    // Preferences > Analysis shows the ten under Palette, after the curve colours.
    const html = renderToStaticMarkup(h(WindowFields, {
        windowId: 'opticalEvaluation', resolved: resolveAnalysisSettings('opticalEvaluation', {}), onChange: () => {}, c, t: en,
    }));
    const settings = en.settings.analysis;
    assert.ok(html.indexOf(settings.curveColors) < html.indexOf(`>${settings.palette}<`) && html.includes(esc(settings.paletteHint))
        && [1, 10].every(n => html.includes(`>${settings.paletteSlot(n)}<`)), 'Settings shows the environment palette under Palette');
}

// ── 2. The row under the plot ───────────────────────────────────────────────
{
    // Pick All, then delete every other environment: the stored All is left
    // with no droplist to leave it by, and must draw what the design draws.
    const today = drawn(evaluated(lone));
    const stale = evaluated(lone, { choice: 'all' });
    const option = optionOf(stale.data);
    assert.equal(drawn(stale), today, 'a design that lost its environments under All draws today\'s plot, readout, table and CSV');
    assert.deepEqual([stale.data.environments, option.legend.show, option.series[0].lineStyle.color, buildCSV(stale.data, SHOW).split('\n')[0]],
        [undefined, false, 'rgba(33,150,243,1)', 'lambda_nm,T_0deg,R_0deg,T_30deg,R_30deg'], 'with the curve colours, no legend and today\'s CSV header');
    // The same rows, none scored in one environment alone, with and without
    // environments.
    const withEnvironments = { ...lone, environments: design.environments };
    const first = render(withEnvironments, en);
    assert.equal(first.replace(droplistOf(first, en).whole, ''), render(lone, en),
        'a design shown in environment 1 draws the markup it draws without environments, the droplist aside');
    assert.equal(drawn(evaluated(withEnvironments)), today, 'and the same chart option, readout, table columns and CSV');
}
for (const code of LOCALES) {
    const t = makeLocale(code);
    const cone = t.designEditor.cone.enableTip;
    for (const state of [{}, { choice: 'all' }]) {
        const plain = render(lone, t, state);
        assert.equal(droplistOf(plain, t), null, `${code}: no droplist without environments`);
        assert.ok(badgeOf(plain, t.modeBar.evalBadgeTip) && !badgeOf(plain, cone), `${code}: the row holds the Eval badge alone`);
        assert.ok(!plain.includes(`>${esc(t.environments.environment)}</span>`), `${code}: and no Environment label`);
    }
    const coned = { ...design, cone: { enabled: true, halfAngleDeg: 4, distribution: 'uniform', gridPoints: 2 } };
    const html = render(coned, t, { current: 'env2' });
    const select = droplistOf(html, t);
    assert.ok(select, `${code}: the droplist with environments`);
    assert.deepEqual(options(select.select), [t.analysisChrome.environmentCurrent(2), '1 · BK7', '2 · Sapphire', '3', t.analysisChrome.environmentAll],
        `${code}: Current names the current environment, then each environment and All`);
    assert.ok(select.whole.includes(`>${esc(t.environments.environment)}</span><select`), `${code}: labelled as in the Design Editor`);
    const badges = [badgeOf(html, t.modeBar.evalBadgeTip), badgeOf(html, cone)];
    const results = html.indexOf('<section');
    assert.ok(select.at > html.indexOf(`>${esc(t.analysisChrome.settings)}<`) && select.at < badges[0].at
        && badges[0].at < badges[1].at && badges[1].at < results,
        `${code}: under the plot, the droplist at the left of the row and Eval and Cone at its right, over the Results strip`);
}
{
    const { select } = droplistOf(render(design, en, { current: 'env2' }), en);
    assert.ok(DROPLIST_WIDTH === 132 && select.includes(`width:${DROPLIST_WIDTH}px`), 'as wide as the Design Editor\'s droplist');
    assert.ok(select.includes(`title="${esc(en.analysisChrome.environmentCurrent(2))}\n`), 'its hover names the choice in full before what it does');
    assert.ok(droplistOf(render(design, en, { choice: 'env2' }), en).select.includes('title="2 · Sapphire\n'));
    assert.ok(droplistOf(render(design, en, { choice: 'env9' }), en).select.includes(`title="${esc(en.analysisChrome.environmentCurrent(1))}\n`),
        'a stale id shows as Current');
}

// ── 3. One environment ──────────────────────────────────────────────────────
{
    const base = evaluated(design);
    assert.ok(sameSpectrum(base.data, spectrumOf(design)) && !base.data.environments, 'Current on environment 1 is the design itself');
    // One mount of the window, the current environment changed under it.
    shown(design);
    let got = null;
    const Probe = () => { got = useOpticalEvaluation(); return null; };
    const draw = () => renderToStaticMarkup(withDesign(h(Probe), design));
    draw();
    const before = got.data;
    currentEnvironmentSession.write(design, { current: 'env2' });
    draw();
    assert.ok(sameSpectrum(got.data, spectrumOf(environmentDesign(design, 'env2'))), 'Current follows the current environment');
    assert.ok(!sameSpectrum(got.data, before), 'and changes when it changes');
    const chosen = evaluated(design, { choice: 'env3' });
    assert.ok(sameSpectrum(chosen.data, spectrumOf(environmentDesign(design, 'env3'))), 'an environment chosen by its id, though off, is computed apart');
    assert.ok(sameSpectrum(evaluated(design, { choice: 'env9' }).data, base.data), 'a stale id computes as Current');
    assert.ok(sameSpectrum(evaluated(lone).data, spectrumOf(lone)), 'a design without environments computes as itself');
    const option = optionOf(evaluated(design, { current: 'env2' }).data);
    assert.equal(option.legend.show, false, 'one environment draws no legend');
    assert.deepEqual(option.series.map(s => s.name), ['T avg @ 0°', 'R avg @ 0°', 'T avg @ 30°', 'R avg @ 30°']);
}

// ── 4. All ──────────────────────────────────────────────────────────────────
{
    const t = en;
    const all = evaluated(design, { choice: 'all' });
    assert.deepEqual(all.data.environments, [{ number: 1, label: '1 · BK7' }, { number: 2, label: '2 · Sapphire' }]);
    assert.equal(all.data.series.length, 4, 'one set of curves per environment that is on, at each angle');
    // eslint-disable-next-line no-unused-vars
    assert.ok(sameSpectrum(all.data.series.slice(2).map(({ env, ...s }) => s), spectrumOf(environmentDesign(design, 'env2')).series), 'each its environment\'s spectrum');
    const option = optionOf(all.data);
    const curves = option.series.filter(s => s.data.length);
    assert.deepEqual(curves.map(s => s.name), [
        'T avg @ 0° (1 · BK7)', 'R avg @ 0° (1 · BK7)', 'T avg @ 30° (1 · BK7)', 'R avg @ 30° (1 · BK7)',
        'T avg @ 0° (2 · Sapphire)', 'R avg @ 0° (2 · Sapphire)', 'T avg @ 30° (2 · Sapphire)', 'R avg @ 30° (2 · Sapphire)',
    ], 'the readout names each curve\'s environment');
    assert.deepEqual(curves.map(s => s.lineStyle.color), [
        'rgba(239,83,80,1)', 'rgba(239,83,80,1)', 'rgba(239,83,80,0.72)', 'rgba(239,83,80,0.72)',
        'rgba(255,167,38,1)', 'rgba(255,167,38,1)', 'rgba(255,167,38,0.72)', 'rgba(255,167,38,0.72)',
    ], 'environment n in colour n, the angles faded');
    assert.deepEqual(curves.map(s => s.lineStyle.type), ['solid', 'solid', 'solid', 'solid', 'solid', 'solid', 'solid', 'solid']);
    const dotted = optionOf(all.data, { ...SHOW, Ts: true, Tp: true });
    assert.deepEqual([...new Set(dotted.series.filter(s => s.data.length).map(s => s.lineStyle.type))], ['solid', 'dotted', 'dashed'], 'polarization keeps its dash');
    assert.ok(option.legend.show && option.legend.selectedMode === false && option.legend.top === 4, 'the legend above the plot, naming without hiding');
    assert.deepEqual(option.legend.data.map(d => d.name ?? d), ['1 · BK7', '2 · Sapphire']);
    assert.deepEqual(option.series.filter(s => s.name === '1 · BK7' || s.name === '2 · Sapphire').map(s => [s.itemStyle.color, s.data.length]),
        [['#ef5350', 0], ['#ffa726', 0]], 'each entry in its environment\'s colour');
    const columns = buildTableColumns(all.data, SHOW, COLORS, 'percent', t.opticalEval.curveLabels);
    assert.deepEqual(columns.map(col => [col.label, col.color]).slice(0, 2), [['T avg @ 0° (1 · BK7)', '#ef5350'], ['R avg @ 0° (1 · BK7)', '#ef5350']]);
    assert.equal(buildCSV(all.data, SHOW).split('\n')[0],
        'lambda_nm,T_0deg (1 · BK7),R_0deg (1 · BK7),T_30deg (1 · BK7),R_30deg (1 · BK7),T_0deg (2 · Sapphire),R_0deg (2 · Sapphire),T_30deg (2 · Sapphire),R_30deg (2 · Sapphire)',
        'the CSV names each column\'s environment');
    opticalEvaluationSession.write(design, { showTable: true });
    const table = render(design, t, { choice: 'all' });
    opticalEvaluationSession.write(design, { showTable: false });
    assert.ok(table.includes('>T avg @ 30° (2 · Sapphire)</th>'), 'and so does the table');
    const comma = overlaidSpectrum([{ number: 1, label: '1 · Air, dry' }], [spectrumOf(lone)]);
    assert.equal(buildCSV({ ...comma, series: comma.series.slice(0, 1) }, SHOW).split('\n')[0], 'lambda_nm,"T (1 · Air, dry)","R (1 · Air, dry)"',
        'a heading holding a comma is quoted');
}

// ── 5. Targets ──────────────────────────────────────────────────────────────
{
    const ids = got => (got.targets || []).map(op => op.id);
    assert.ok(evaluated(lone).targets === lone.meritOperands, 'a design without environments draws its rows as they are');
    assert.deepEqual(ids(evaluated(design)), ['h1', 'r1', 'k1', 'x1'], 'environment 1 draws its rows, not the sapphire row');
    assert.deepEqual(ids(evaluated(design, { current: 'env2' })), ['h1', 'r1', 'r2', 'k1', 'x1'], 'the current environment 2 draws the sapphire row');
    assert.deepEqual(ids(evaluated(design, { choice: 'env2' })), ['h1', 'r1', 'r2', 'k1', 'x1'], 'and so does environment 2 chosen');
    assert.deepEqual(ids(evaluated(design, { choice: 'all' })), ['h1', 'r1', 'r2', 'k1', 'x1'], 'All draws every row');
    assert.deepEqual(rowsShown(design, false, environmentViews(design, 'env3', 'base')).map(op => op.id), ['h1', 'r1', 'k1', 'x1']);
    const line = createTargetOperands({
        operands: design.meritOperands, line: { x0: 450, y0: 2, x1: 650, y1: 2 },
        editCurve: 'R', editPol: 'avg', editKind: 'average', editAoi: 0, snapOn: false, snapNm: 10, snapPct: 5,
    });
    assert.ok(!('env' in line[line.length - 1]), 'a target drawn on the plot is scored in every environment');
    const edited = editTargetOperands({
        operands: design.meritOperands, meta: { opId: 'r2', kind: 'point', type: 'R' },
        coords: { x0: 560, y0: 3, x1: 560, y1: 3 }, snapOn: false, snapNm: 10, snapPct: 5,
    });
    assert.equal(edited.find(op => op.id === 'r2').env, 'env2', 'editing a target keeps its environment');

    // A row of environment 3 alone, at 503 to 597 nm and 33 %, which a line
    // drawn near it would snap to were it on the plot.
    const z3 = { ...makeOperand({ type: 'RAV', lambdaStart: 503, lambdaEnd: 597, aoi: 0, pol: 'avg', target: 0.33, weight: 1 }), id: 'z3', env: 'env3' };
    const zoned = { ...design, meritOperands: [...design.meritOperands, z3] };
    const draw = state => {
        const written = [];
        evaluated(zoned, state, written).onCreateTarget({ x0: 505, y0: 34, x1: 595, y1: 34 });
        const rows = written[0].meritOperands;
        const added = rows[rows.length - 1];
        return [rows.length, added.lambdaStart, added.lambdaEnd, Math.round(added.target * 1e6) / 1e6];
    };
    assert.deepEqual(draw({ choice: 'env2' }), [7, 510, 600, 0.35], 'in 2 · Sapphire a drawn target snaps to the grid, not to a row of environment 3');
    assert.deepEqual(draw({ choice: 'env3' }), [7, 503, 597, 0.33], 'and to that row where it is drawn');
    assert.deepEqual(draw({ current: 'env3' }), [7, 503, 597, 0.33], 'as it does when environment 3 is the current one');
    const drag = state => {
        const written = [];
        evaluated(zoned, state, written).onEditTarget({ opId: 'r2', kind: 'point', type: 'R' }, { x0: 501, y0: 34, x1: 501, y1: 34 });
        return written[0].meritOperands;
    };
    const dragged = drag({ choice: 'env2' });
    const r2 = dragged.find(op => op.id === 'r2');
    assert.deepEqual([dragged.length, dragged[5] === z3, r2.lambdaStart, Math.round(r2.target * 1e6) / 1e6, r2.env, r2.aoi], [6, true, 500, 0.35, 'env2', 30],
        'a dragged target snaps to the rows shown, keeps its environment and leaves every row in the list');
    assert.equal(drag({ choice: 'all' }).find(op => op.id === 'r2').lambdaStart, 503, 'under All it snaps to every row');
}

// ── 6. Range notice and the cone ────────────────────────────────────────────
{
    const ids = got => got.rangeMaterials.map(m => m.id);
    assert.ok(!ids(evaluated(design)).includes('builtin:Al2O3'), 'environment 1 reads its own materials');
    assert.ok(ids(evaluated(design, { choice: 'env2' })).includes('builtin:Al2O3'), 'environment 2 its sapphire');
    const all = ids(evaluated(design, { choice: 'all' }));
    assert.ok(all.includes('builtin:Al2O3') && all.includes('builtin:BK7'), 'All reads every environment shown');
    const coned = { ...design, cone: { enabled: true, halfAngleDeg: 4, distribution: 'uniform', gridPoints: 2 } };
    const busy = evaluated(coned, { choice: 'all' });
    assert.ok(busy.busy === true && busy.data === null, 'under a cone the window computes nothing on its own thread and waits');
    shown(design);
}

console.log('optical_evaluation_environments: ALL PASS');
