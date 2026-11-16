/**
 * Every value Color Evaluation reports says what it is when hovered, in every
 * language, with the text the colour target editor's fields show too.
 *
 *   1. Each locale has a tip for every value the window reports and every
 *      difference it measures.
 *   2. The Table's value columns, one angle's row per space, the line under the
 *      diagram and the Differences columns carry that tip.
 *   3. The results table puts a column's tip over its heading and its values,
 *      and one angle's Table over each name and value.
 *
 * Run: node tests/color_value_tips.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { getLocale } from '../src/constants/locales/index.js';

shimBrowserGlobals();
await loadApp();

const {
    colorRows, differenceColumns, differenceRows, linePairs, spaceRows, tableColumns, TABLE_SPACE_IDS,
} = await import('../src/components/windows/analysis/colorEvaluation/resultsModel.js');
const { ResultsViews } = await import('../src/components/windows/analysis/colorEvaluation/ResultsViews.js');
const { ResultsGrid } = await import('../src/components/ui/ResultsSection.js');
const { colorReport } = await import('../src/utils/physics/colorimetry.js');

const c = makeTheme();
const lambda = Array.from({ length: 401 }, (_, i) => 380 + i);
const colourAt = centre => colorReport(
    { lambda, values: lambda.map(l => 0.1 + 0.8 * Math.exp(-(((l - centre) / 30) ** 2))) },
    { observer: '2', illuminant: 'D65' });
const three = [0, 30, 60].map((theta, i) => ({ theta, report: colourAt(520 - 30 * i) }));
const LEAD = new Set(['aoi', 'env']);
const escaped = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');

for (const code of ['en', 'ru', 'zh', 'it']) {
    const t = getLocale(code);
    const ce = t.colorEval;
    const tips = ce.valueTips;

    // ── 1. A tip for every value ─────────────────────────────────────────────
    const valueKeys = [...Object.keys(colorRows(three)[0]), ...Object.keys(differenceRows(three)[0])]
        .filter(key => !LEAD.has(key));
    for (const key of valueKeys) {
        assert.ok(typeof tips[key] === 'string' && tips[key].length > 0, `${code}: ${key} has a tip`);
    }
    assert.deepEqual(Object.keys(tips).sort(), [...new Set(valueKeys)].sort(), `${code}: no tip for a value the window does not report`);

    // ── 2. Every view carries it ─────────────────────────────────────────────
    for (const space of TABLE_SPACE_IDS) {
        for (const col of tableColumns(space, ce, t.units).filter(col => !LEAD.has(col.key))) {
            assert.equal(col.title, tips[col.key], `${code}, ${space}: ${col.key}`);
        }
    }
    for (const row of spaceRows(three[0].report, ce, t.units)) {
        for (const pair of row.pairs) assert.ok(Object.values(tips).includes(pair.title), `${code}, one angle, ${row.id}: ${pair.label}`);
    }
    for (const pair of linePairs(three[0].report, ce, t.units)) assert.equal(pair.title, tips[pair.key], `${code}, line: ${pair.key}`);
    for (const col of differenceColumns(ce, three).filter(col => !LEAD.has(col.key))) {
        assert.equal(col.title, tips[col.key], `${code}, Differences: ${col.key}`);
    }
}

// ── 3. Drawn over the values ─────────────────────────────────────────────────
{
    const t = getLocale('en');
    const ce = t.colorEval;
    const columns = tableColumns('lab', ce, t.units);
    const grid = renderToStaticMarkup(React.createElement(ResultsGrid, { columns, rows: colorRows(three), c }));
    const tip = escaped(ce.valueTips.a);
    assert.equal(grid.split(`title="${tip}"`).length - 1, 1 + three.length, 'the a* tip over its heading and each of its three values');

    const state = { resultsView: 'table', tableSpace: 'lab', exposure: 'fit', illuminant: 'D65', setResultsView() {}, setTableSpace() {} };
    const one = [three[0]];
    const html = renderToStaticMarkup(React.createElement(ResultsViews, {
        reports: one, table: { columns: null, rows: spaceRows(one[0].report, ce, t.units) }, state, ce, c, colors: {},
    }));
    for (const key of ['X', 'hab', 'suv', 'dominant', 'cct', 'duv']) {
        assert.ok(html.includes(`title="${escaped(ce.valueTips[key])}"`), `one angle's Table: ${key} says what it is`);
    }
}

console.log('PASS color_value_tips');
