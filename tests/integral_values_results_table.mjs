/**
 * Integral Values results table: a band the evaluated spectrum does not span
 * reads "n/a" with the spectrum's span beside it, and exports as empty cells,
 * rather than showing an average taken over part of the band.
 *
 * Run: node tests/integral_values_results_table.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { ResultsTable } = await import('../src/components/windows/analysis/integralValues/ResultsTable.js');
const { exportRows } = await import('../src/components/windows/analysis/integralValues/exportModel.js');
const { buildIntegralDefinitions } = await import('../src/components/windows/analysis/integralValues/integralModel.js');
const { computeIntegralValueBatch } = await import('../src/utils/physics/integralValues.js');
const { buildLambdaGrid } = await import('../src/utils/physics/thinFilmMath.js');

const c = makeTheme();
const t = makeLocale();
const integrals = buildIntegralDefinitions([]);
const spectrumOver = (from, to) => {
    const lambda = buildLambdaGrid(from, to, 5);
    const T = lambda.map(() => 0.9);
    return { lambda, T, R: T.map(v => 1 - v), A: T.map(() => 0) };
};
const render = results => renderToStaticMarkup(React.createElement(ResultsTable, {
    integrals, results, selectedKey: 'Tvis', setSelectedKey: () => {},
    onPatch: () => {}, onRemove: () => {}, c, t,
}));
const rowOf = (html, label) => html.split('<tr').find(row => row.includes(`>${label}<`));

// Evaluated over 450-650 nm: the solar row has no value and says why.
{
    const results = computeIntegralValueBatch(spectrumOver(450, 650), integrals);
    const row = rowOf(render(results), 'Tsol');
    assert.ok(row.includes(`>${t.integralValues.notAvailable}<`), 'Tsol reads n/a');
    assert.ok(row.includes(t.integralValues.spectrumSpan('450', '650')), 'and names the span 450-650 nm');
    assert.ok(!/0\.9\d{4}/.test(row), 'and shows no average over part of the band');

    const exported = exportRows(integrals, results).find(r => r.label === 'Tsol');
    assert.equal(exported.value, null, 'the exported value cell is empty');
    assert.equal(exported.percent, null);
    assert.equal(exported.min, null);
}

// Evaluated over 300-2500 nm: every built-in band is covered and has a value.
{
    const results = computeIntegralValueBatch(spectrumOver(300, 2500), integrals);
    const html = render(results);
    assert.ok(!html.includes(`>${t.integralValues.notAvailable}<`), 'no row reads n/a');
    assert.ok(rowOf(html, 'Tsol').includes('>0.90000<'), 'Tsol of a flat 0.9 is 0.90000');
}

console.log('PASS: integral_values_results_table');
