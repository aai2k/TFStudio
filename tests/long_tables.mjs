/**
 * Tables of any length open as quickly as short ones.
 *
 * Nothing limits how many points a range and step ask for, nor how many rows a
 * refractiveindex.info page brings in, and the largest page has 61,730. Every
 * table that lists them drew a row for each: 3 s to render that page in the
 * Material Editor before the browser laid out a quarter of a million inputs,
 * and again on every keystroke. They now draw only the rows in view, from one
 * shared module, and the Material Editor's n,k table scrolls in a box of its own
 * so the chart and the fit below it stay within reach on the page.
 *
 * Run: node tests/long_tables.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeTheme, makeLocale } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { visibleRows, virtualBody, steadyColumns } = await import('../src/components/ui/virtualRows.js');
const { ResultsGrid, RESULT_ROW_HEIGHT } = await import('../src/components/ui/ResultsSection.js');
const { DataTable } = await import('../src/components/windows/analysis/opticalEvaluation/DataTable.js');
const { NKDataGrid, ROW_HEIGHT } = await import('../src/components/windows/design/materialEditor/nkDataGrid.js');
const { UserMaterialForm } = await import('../src/components/windows/design/materialEditor/userMaterialForm.js');
const draftModule = await import('../src/components/windows/design/materialEditor/materialDraft.js');
const { initCatalogs, getCatalogs } = await import('../src/utils/materials/catalogManager.js');

const c = makeTheme();
const t = makeLocale();
const render = element => renderToStaticMarkup(element);
const rowsDrawn = html => (html.match(/<tr/g) || []).length;
const spacerHeights = html => [...html.matchAll(/height:(\d+)px/g)].map(match => Number(match[1]));

// ── Which rows a pane shows ──────────────────────────────────────────────────

assert.deepEqual(visibleRows(60000, 20, 0, 240), [0, 22], 'the top of a table, with ten rows past the edge');
assert.deepEqual(visibleRows(60000, 20, 600000, 240), [29990, 30022], 'the middle, ten rows past each edge');
assert.deepEqual(visibleRows(60000, 20, 1199760, 240), [59978, 60000], 'the end, never past the last row');
assert.deepEqual(visibleRows(5, 20, 0, 240), [0, 5], 'a short table is drawn whole');

// The row being edited stays drawn wherever the table is scrolled, so its cell
// keeps the focus, and the rows around it still stand in at their height.
{
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const draw = (item, index) => React.createElement('tr', { key: index }, React.createElement('td', null, `row${index}`));
    const body = keep => render(React.createElement('table', null, React.createElement('tbody', null,
        virtualBody(items, { first: 500, end: 540, keep }, 20, 1, draw))));
    assert.match(body(3), />row3</, 'a row above the drawn ones is kept');
    assert.deepEqual(spacerHeights(body(3)), [3 * 20, 496 * 20, 460 * 20]);
    assert.match(body(900), />row900</, 'so is one below them');
    assert.deepEqual(spacerHeights(body(900)), [500 * 20, 360 * 20, 99 * 20]);
    assert.equal(rowsDrawn(body(-1)), 42, 'and with nothing kept, only the rows in view and their two stand-ins');
}

// A column keeps the width of the longest value it has drawn, so a shorter one
// scrolling into view does not narrow it and move the columns beside it.
{
    const store = { current: null };
    const widthsOf = columns => [...render(React.createElement('table', null, columns.colgroup()))
        .matchAll(/calc\((\d+)ch/g)].map(match => Number(match[1]));
    const first = steadyColumns(store, ['λ (nm)', 'T']);
    first.fit(0, '999.50');
    first.fit(1, '100.0000');
    assert.deepEqual(widthsOf(first), [6, 8], 'each column as wide as its label or its longest value');
    const later = steadyColumns(store, ['λ (nm)', 'T']);
    later.fit(1, '0.5000');
    assert.deepEqual(widthsOf(later), [6, 8], 'and no narrower once that value has scrolled away');
    assert.deepEqual(widthsOf(steadyColumns(store, ['x', 'y'])), [1, 1], 'until the columns themselves change');
}

// ── The analysis windows' results table ──────────────────────────────────────

{
    const rows = Array.from({ length: 300000 }, (_, i) => ({ lambda: 400 + i * 0.001, T: 0.5 }));
    const columns = [{ key: 'lambda', label: 'λ (nm)' }, { key: 'T', label: 'T' }];
    const html = render(React.createElement(ResultsGrid, { columns, rows, c }));
    assert.ok(rowsDrawn(html) < 60, `300,000 results draw ${rowsDrawn(html)} rows`);
    const below = Math.max(...spacerHeights(html));
    assert.equal(below % RESULT_ROW_HEIGHT, 0);
    assert.ok(below / RESULT_ROW_HEIGHT > 299900, 'the rows not drawn still give the scrollbar its full length');
}

// ── Optical Evaluation's table ───────────────────────────────────────────────

{
    const lambda = Array.from({ length: 40001 }, (_, i) => Number((400 + i * 0.01).toFixed(2)));
    const data = { lambda, series: [{ theta: 0, T: lambda.map(() => 0.9), R: lambda.map(() => 0.1) }] };
    const html = render(React.createElement(DataTable, {
        data, showCurves: { T: true, R: true }, yScale: 'percent', c, oe: t.opticalEval,
    }));
    assert.ok(rowsDrawn(html) < 60, `40,001 wavelengths draw ${rowsDrawn(html)} rows`);
    assert.match(html, />400\.01</, 'a 0.01 nm grid prints 400.01, not 400.0 twice');
    const quarter = render(React.createElement(DataTable, {
        data: { lambda: [400, 400.25, 400.5], series: [{ theta: 0, T: [1, 1, 1] }] },
        showCurves: { T: true }, yScale: 'percent', c, oe: t.opticalEval,
    }));
    assert.match(quarter, />400\.25</, 'and a 0.25 nm grid prints 400.25');
    assert.match(quarter, />400\.00</);
}

// ── The Material Editor's n,k table ──────────────────────────────────────────

const bigRows = Array.from({ length: 61730 }, (_, i) => ({
    _key: i, lam: String(27.5 + i * 2), n: String(1.45 + (i % 7) * 1e-4), k: i % 11 ? '0' : '-1e-6',
}));
{
    const grid = render(React.createElement(NKDataGrid, {
        cols: [{ key: 'lam', label: 'λ', width: '33%' }, { key: 'n', label: 'n', width: '33%' }, { key: 'k', label: 'k', width: '33%' }],
        rows: bigRows, onEdit() {}, onDelete() {}, onAdd() {}, onPasteRows() {}, c,
    }));
    assert.ok(rowsDrawn(grid) < 60, `61,730 rows draw ${rowsDrawn(grid)}`);
    assert.match(grid, /max-height:240px;overflow-y:auto/, 'in a box of its own, 240 px until the bar is dragged');
    assert.match(grid, /cursor:row-resize/, 'with the bar that sets its height under it');
    assert.match(render(React.createElement(NKDataGrid, {
        cols: [{ key: 'lam', label: 'λ', width: '50%' }], rows: bigRows.slice(0, 3), height: 400,
        onEdit() {}, onDelete() {}, onAdd() {}, onPasteRows() {}, c,
    })), /max-height:400px/, 'the height the bar was dragged to');
    assert.equal(ROW_HEIGHT * 4 <= 400, true);
}

// ── The Material Editor page ─────────────────────────────────────────────────

initCatalogs({ user_lab: { id: 'user_lab', name: 'Lab', source: 'user', materials: {} } });
const bigDraft = { ...draftModule.emptyDraft('user_lab'), isNew: false, id: 'big', name: 'Big', rows: bigRows };
const form = draft => React.createElement(UserMaterialForm, {
    draft, onChange() {}, onSave() {}, onRevert() {}, onDelete() {}, workingNm: [400, 800],
    dirty: false, catalogs: getCatalogs(), detailTab: 'nk', setDetailTab() {}, c, t,
});
{
    const html = render(form({ ...bigDraft, name: 'Bigger' }));
    // A keystroke anywhere on the page took 3 s while every row was drawn.
    assert.ok(rowsDrawn(html) < bigRows.length / 100,
        `the page of a 61,730-row material draws ${rowsDrawn(html)} table rows`);
    // The page scrolls as a whole; only the table scrolls inside it.
    assert.match(html, /flex:1;overflow-y:auto;display:flex;flex-direction:column/, 'the page scrolls as one');
    const tableAt = html.indexOf('max-height:240px');
    const chartAt = html.indexOf(t.materialEditor.chartTitle);
    assert.ok(tableAt > 0 && chartAt > tableAt, 'the chart follows the table on the same page');
    assert.ok(html.includes(t.materialEditor.negativeKRows(5612)), 'every row is still read for the k note');
}

// What the page reads off the table is read once per set of rows.
{
    const sampler = draftModule.buildNKFromDraft(bigDraft);
    assert.equal(draftModule.buildNKFromDraft({ ...bigDraft, name: 'x' }), sampler, 'the sampler is kept while the rows stay');
    assert.equal(draftModule.fitRows({ ...bigDraft, color: '#fff' }), draftModule.fitRows(bigDraft), 'and so are the rows the fit reads');
    const edited = { ...bigDraft, rows: bigRows.map((row, i) => (i === 3 ? { ...row, n: '1.6' } : row)) };
    assert.notEqual(draftModule.buildNKFromDraft(edited), sampler, 'an edited table is read again');
    assert.equal(draftModule.buildNKFromDraft(edited)(27.5 + 3 * 2)[0], 1.6, 'with the edit in it');
    assert.notEqual(draftModule.draftFingerprint(edited), draftModule.draftFingerprint(bigDraft), 'and reads as changed');
    assert.equal(draftModule.draftFingerprint({ ...bigDraft }), draftModule.draftFingerprint(bigDraft));
}

// The table is drawn the same way everywhere.
for (const path of ['ui/ResultsSection.js', 'windows/analysis/opticalEvaluation/DataTable.js',
    'windows/design/materialEditor/nkDataGrid.js']) {
    assert.match(readFileSync(new URL(`../src/components/${path}`, import.meta.url), 'utf8'), /useVirtualRows\(/,
        `${path} draws only the rows in view`);
}

console.log('long_tables: passed');
