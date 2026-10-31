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
assert.equal(csvFromRows([{ key: 'd', label: 'd, nm' }, { key: 'note', label: 'Note' }], [{ d: 64.2, note: 'a, b' }]),
    'd; nm,Note\n64.2,a; b', 'nor can a comma in a heading');

// Each value is written in the unit its heading names, the one the table shows
// it in: a column of fractions of 1 shown in percent or in ppm writes them
// times 100 or 10⁶, at full precision. Checked on every table that shows
// fractions scaled, in every language.
{
    const { overlayColumns } = await import('../src/components/windows/analysis/inhomogeneities/tableModel.js');
    const { scatterColumns } = await import('../src/components/windows/analysis/roughnessScattering/tableModel.js');
    const { deviationColumns, sweepColumns } = await import('../src/components/windows/analysis/systematicDeviations/tableModel.js');
    const { statisticsColumns } = await import('../src/components/windows/analysis/errorAnalysis/resultTable.js');
    const every = Object.fromEntries(['T', 'Ts', 'Tp', 'R', 'Rs', 'Rp', 'A', 'As', 'Ap'].map(key => [key, true]));
    const tables = lt => ({
        Inhomogeneities: overlayColumns(lt, every),
        'Roughness in ppm': scatterColumns(lt, 'ppm', every, { specular: every }),
        'Roughness as a fraction': scatterColumns(lt, 'frac', every, { specular: every }),
        'Systematic Deviations': deviationColumns(lt, 'all'),
        'Systematic Deviations sweep': sweepColumns(lt, 'all'),
        'Error Analysis': statisticsColumns(lt, 'T', 2),
    });
    // The specular loss of (HL)^4 H with σ 2 nm at 500 nm, in every cell but
    // the wavelength and the swept parameter.
    const value = 0.004343612;
    const near = (a, b) => Number(a.toPrecision(3)) === Number(b.toPrecision(3));
    for (const code of ['en', 'ru', 'zh', 'it']) {
        for (const [name, columns] of Object.entries(tables(makeLocale(code)))) {
            const row = { ...Object.fromEntries(columns.map(column => [column.key, value])), lambda: 500, param: 1.5 };
            const written = csvFromRows(columns, [row]).split('\n')[1].split(',').map(Number);
            columns.forEach((column, i) => {
                const shown = Number(column.fmt(row[column.key], row));
                assert.ok(near(written[i], shown), `${code} ${name}: "${column.label}" writes ${written[i]} where the table shows ${shown}`);
                const unit = { 100: '(%)', 1e6: '(ppm)' }[column.scale];
                assert.ok(!unit || column.label.endsWith(unit), `${code} ${name}: "${column.label}" names the ${unit} it is written in`);
            });
        }
    }
}

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
