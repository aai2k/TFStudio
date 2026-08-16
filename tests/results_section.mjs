/**
 * The analysis windows share one bottom panel, so Group Delay / GDD and Material
 * Dispersion present their numbers exactly as Optical Evaluation does: a
 * collapsible Results header over a scrolling table, and a CSV export menu.
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeTheme, makeLocale } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ ResultsSection, ResultsGrid, csvFromRows }, { ExportMenu }] = await Promise.all([
    import('../src/components/ui/ResultsSection.js'),
    import('../src/components/ui/ExportMenu.js'),
]);

const c = makeTheme();
const t = makeLocale();
const columns = [
    { key: 'lambda', label: 'λ (nm)', fmt: value => value.toFixed(1) },
    { key: 'gd', label: 'GD (fs)', fmt: value => value.toFixed(3) },
    { key: 'note', label: 'Note' },
];
const rows = [
    { lambda: 500, gd: -1.23456, note: 'in band' },
    { lambda: 510.25, gd: 2.5, note: 'edge, clipped' },
];

// ── Header ────────────────────────────────────────────────────────────────────

const collapsed = renderToStaticMarkup(React.createElement(ResultsSection, {
    c, label: t.dataTable.results, count: rows.length, countLabel: t.dataTable.rowCount,
    open: false, setOpen: () => {},
}, React.createElement(ResultsGrid, { columns, rows, c })));
assert.match(collapsed, /aria-expanded="false"/);
assert.match(collapsed, />Results</);
assert.match(collapsed, />2 rows</);
assert.doesNotMatch(collapsed, /<table/,
    'a collapsed section does not build the table for thousands of samples');

const expanded = renderToStaticMarkup(React.createElement(ResultsSection, {
    c, label: t.dataTable.results, count: rows.length, countLabel: t.dataTable.rowCount,
    open: true, setOpen: () => {},
}, React.createElement(ResultsGrid, { columns, rows, c })));
assert.match(expanded, /aria-expanded="true"/);
assert.match(expanded, /<table/);
assert.match(expanded, />-1\.235</, 'cells are formatted by the column, not printed raw');
assert.match(expanded, /text-align:left[^>]*>λ \(nm\)/,
    'the first column is left aligned and the rest right, as in Optical Evaluation');

// ── CSV ───────────────────────────────────────────────────────────────────────

assert.equal(csvFromRows(columns, rows), [
    'λ (nm),GD (fs),Note',
    '500,-1.23456,in band',
    '510.25,2.5,edge; clipped',
].join('\n'), 'CSV carries full precision, and a comma in text cannot split a field');
assert.equal(csvFromRows(columns, []), 'λ (nm),GD (fs),Note');
assert.equal(csvFromRows([], rows), '');

// ── Export menu ───────────────────────────────────────────────────────────────

const labels = {
    export: t.dataTable.export, copyCsv: t.dataTable.copyCsv,
    saveCsv: t.dataTable.saveCsv, copied: t.dataTable.csvCopied,
    saved: t.dataTable.csvSaved,
};
const ready = renderToStaticMarkup(React.createElement(ExportMenu, {
    c, labels, enabled: true, copyCSV: () => {}, saveCSV: () => {},
}));
assert.match(ready, />Export</);
assert.doesNotMatch(ready, /disabled=""/);

const empty = renderToStaticMarkup(React.createElement(ExportMenu, {
    c, labels, enabled: false, copyCSV: () => {}, saveCSV: () => {},
}));
assert.match(empty, /disabled=""/, 'nothing computed yet means nothing to export');

const acknowledged = renderToStaticMarkup(React.createElement(ExportMenu, {
    c, labels, enabled: true, copied: true, copyCSV: () => {}, saveCSV: () => {},
}));
assert.match(acknowledged, /✓ Copied/, 'the button reports what just happened');

console.log('PASS: results_section');
