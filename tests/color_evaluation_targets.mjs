/**
 * Color Evaluation's Targets: the merit function's colour rows on the diagram.
 *
 *   1. Over R the diagram draws the RCOL rows, over T the TCOL rows, scored at
 *      the window's polarization, illuminant and observer; a row that is off,
 *      or scored at another polarization, illuminant or observer, is not drawn.
 *   2. A row is drawn on the diagram of its own coordinates: x and y at one
 *      angle meet in a diamond on x, y labelled with the angle; u′ and v′ on
 *      u′, v′; a* and b*, or C*ab and hab, on both CIELAB diagrams; u* and v*,
 *      or C*uv and huv, on C*uv, huv. A row with no partner at its angle, and
 *      Y, L* and λd, are not drawn. Two targets at one angle are two diamonds.
 *   3. The chart draws each as a hollow diamond in the coating's ink, labelled
 *      with its angle, inside the view, with no legend entry and before the
 *      coating, whose rings sit on top.
 *   4. The Targets button sits first among the controls on the right, on and
 *      pressed while the diagram has targets and Targets is on; off, it can be
 *      pressed again; with no targets on the diagram shown it is greyed with
 *      a tip that says so. It is on when the window opens.
 *
 * Run: node tests/color_evaluation_targets.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const dir = '../src/components/windows/analysis/colorEvaluation';
const { colorTargetMarks } = await import(`${dir}/colorTargets.js`);
const { buildChromaticityOption } = await import(`${dir}/chartFigure.js`);
const { ColorEvaluation } = await import(`${dir}/ColorEvaluation.js`);
const { colorEvaluationSession } = await import(`${dir}/sessionState.js`);
const { colorReport } = await import('../src/utils/physics/colorimetry.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { ANALYSIS_DEFAULTS } = await import('../src/constants/analysisDefaults.js');

const c = makeTheme();
const t = makeLocale();
const ce = t.colorEval;
const row = (color, target, extra = {}) => makeOperand({
    type: 'RCOL', color, target, aoi: 0, pol: 'avg', illuminant: 'D65', observer: 2, weight: 1, ...extra,
});
const VIEW = { characteristic: 'R', pol: 'avg', illuminant: 'D65', observer: '2', diagram: 'xy' };
// What the chart draws of each diamond: its point and its label.
const marks = (rows, view = {}) => colorTargetMarks(rows, { ...VIEW, ...view }).map(({ value, label }) => ({ value, label }));
const near = (actual, expected, label) => actual.forEach((value, k) => assert.ok(Math.abs(value - expected[k]) < 1e-12, label));

// ── 1. Which rows ────────────────────────────────────────────────────────────
const pair = [row('x', 0.23), row('y', 0.24), row('Y', 1)];
assert.deepEqual(marks(pair), [{ value: [0.23, 0.24], label: '0°' }], 'an x and a y row at 0°: one diamond');
const SKIPPED = [
    ['T is shown', { characteristic: 'T' }, {}],
    ['TCOL rows over R', {}, { type: 'TCOL' }],
    ['s rows under avg', {}, { pol: 's' }],
    ['D50 rows under D65', {}, { illuminant: 'D50' }],
    ['10° rows under 2°', {}, { observer: 10 }],
    ['rows that are off', {}, { enabled: false }],
];
for (const [label, view, extra] of SKIPPED) {
    assert.deepEqual(marks(pair.map(op => ({ ...op, ...extra })), view), [], `none drawn: ${label}`);
}
assert.equal(marks(pair.map(op => ({ ...op, type: 'TCOL' })), { characteristic: 'T' }).length, 1, 'TCOL rows over T');
assert.equal(marks(pair.map(op => ({ ...op, pol: 'p' })), { pol: 'p' }).length, 1, 'p rows over p');
assert.equal(marks(pair.map(op => ({ ...op, observer: 10, illuminant: 'A' })), { observer: '10', illuminant: 'A' }).length, 1,
    'A · 10° rows under A · 10°');

// ── 2. Which diagram ─────────────────────────────────────────────────────────
{
    const rows = [
        row('x', 0.23), row('y', 0.24), row('Y', 1),
        row('x', 0.24, { aoi: 45 }), row('y', 0.255, { aoi: 45 }),
        row('x', 0.3, { aoi: 20 }),
        row("u'", 0.19, { aoi: 10 }), row("v'", 0.45, { aoi: 10 }),
        row('L*', 30, { aoi: 30 }), row('a*', 5, { aoi: 30 }), row('b*', -20, { aoi: 30 }),
        row('C*ab', 10, { aoi: 60 }), row('hab', 90, { aoi: 60 }),
        row('u*', 3, { aoi: 70 }), row('v*', -4, { aoi: 70 }),
        row('C*uv', 2, { aoi: 80 }), row('huv', 180, { aoi: 80 }),
        row('dominant', 470),
    ];
    const at = diagram => marks(rows, { diagram });
    assert.deepEqual(at('xy'), [{ value: [0.23, 0.24], label: '0°' }, { value: [0.24, 0.255], label: '45°' }],
        'x, y: the pairs at 0° and 45°; the x alone at 20° is no point');
    assert.deepEqual(at('uv'), [{ value: [0.19, 0.45], label: '10°' }], "u', v'");
    for (const diagram of ['ab', 'chAb']) {
        const shown = at(diagram);
        assert.deepEqual(shown.map(mark => mark.label), ['30°', '60°'], `${diagram}: a*, b* and C*ab, hab`);
        assert.deepEqual(shown[0].value, [5, -20]);
        near(shown[1].value, [0, 10], `${diagram}: C*ab 10 at hab 90° is a* 0, b* 10`);
    }
    const luv = at('chUv');
    assert.deepEqual(luv.map(mark => mark.label), ['70°', '80°'], 'C*uv, huv: u*, v* and C*uv, huv');
    assert.deepEqual(luv[0].value, [3, -4]);
    near(luv[1].value, [-2, 0], 'C*uv 2 at huv 180° is u* -2, v* 0');
    const twice = [...pair, row('x', 0.25), row('y', 0.26)];
    assert.deepEqual(marks(twice).map(mark => mark.value), [[0.23, 0.24], [0.25, 0.26]], 'two targets at 0°: two diamonds');
}

// ── 3. On the chart ──────────────────────────────────────────────────────────
{
    const lambda = Array.from({ length: 401 }, (_, i) => 380 + i);
    const report = colorReport({ lambda, values: lambda.map(() => 0.04) }, { observer: '2', illuminant: 'D65' });
    const targets = [{ value: [0.23, 0.24], label: '0°' }, { value: [0.05, 0.85], label: '45°' }];
    const option = buildChromaticityOption({
        reports: [{ theta: 0, report }], observer: '2', diagram: 'xy', c, tr: ce, units: t.units, targets,
        display: { showWavelengths: false, showWhite: true, showPlanckian: false, showSrgb: false },
    });
    const at = option.series.findIndex(series => series.symbol === 'diamond');
    const diamonds = option.series[at];
    assert.deepEqual(diamonds.data.map(item => [item.value, item.label]), targets.map(mark => [mark.value, mark.label]));
    assert.equal(diamonds.itemStyle.borderColor, ANALYSIS_DEFAULTS.colorEvaluation.colors.coating, 'in the coating\'s ink');
    assert.equal(diamonds.itemStyle.color, 'transparent', 'hollow');
    assert.equal(diamonds.label.formatter({ data: targets[1] }), '45°', 'labelled with the angle');
    assert.ok(at < option.series.findIndex(series => series.name === ce.chartCoating), 'under the coating');
    assert.equal(diamonds.name, undefined, 'no legend entry');
    assert.ok(!option.legend.data.some(entry => (entry.name || entry) === ce.chartTarget));
    assert.ok(option.yAxis.max >= 0.85, 'the view takes the targets in');
    assert.ok(diamonds.tooltip.formatter({ data: targets[0], value: targets[0].value }).startsWith(`${ce.chartTarget}, 0°`));
}

// ── 4. The button ────────────────────────────────────────────────────────────
assert.equal(ANALYSIS_DEFAULTS.colorEvaluation.booleans.showTargets, true, 'Targets is on when the window opens');
{
    const design = { ...makeSampleDesign(), meritOperands: pair };
    const render = () => renderToStaticMarkup(withDesign(React.createElement(ColorEvaluation, { c, theme: c, t }), design));
    const button = html => {
        const at = html.indexOf(`>${ce.targets}</button>`);
        return at < 0 ? null : html.slice(html.lastIndexOf('<button', at), at);
    };
    const on = render();
    assert.ok(button(on).includes(`title="${ce.targetsTip}"`) && button(on).includes('aria-pressed="true"'), 'on, with targets');
    assert.ok(on.indexOf(`>${ce.targets}</button>`) < on.indexOf(t.analysisChrome.settings), 'before Settings');
    colorEvaluationSession.write(design, { showTargets: false });
    const off = render();
    assert.ok(button(off).includes('aria-pressed="false"') && !button(off).includes('disabled'), 'off, and can be pressed again');
    colorEvaluationSession.write(design, { showTargets: true, diagram: 'uv' });
    const none = render();
    assert.ok(button(none).includes(`title="${ce.noTargetsTip}"`) && button(none).includes('disabled'), 'greyed on u\', v\'');
    colorEvaluationSession.write(design, { diagram: 'xy' });
}

console.log('color_evaluation_targets: passed');
