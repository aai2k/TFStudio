/**
 * Table headers that carry a unit are shown as written.
 *
 * The synthesis history tables and the Zemax Coatings tables drew their headers
 * in capitals, which turned "TOT, nm" into "TOT, NM" and "λ range (µm)" into
 * "Λ RANGE (ΜM)". A unit's case is part of the unit.
 *
 * Run: node tests/table_headers_as_written.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
const { getLocale } = await loadApp();
const { SynthesisHistoryTable } = await import('../src/components/windows/optimization/synthesisShared/SynthesisHistoryTable.js');
const { th } = await import('../src/components/windows/dataExchange/zemaxCoatings/ui.js');

const c = makeTheme();
const capitalised = html => [...html.matchAll(/<th([^>]*)>([^<]*)<\/th>/g)]
    .filter(([, attrs]) => /text-transform:\s*uppercase/.test(attrs)).map(([, , label]) => label);

for (const code of ['en', 'ru']) {
    const t = getLocale(code);
    for (const window of ['needle', 'gradualEvolution', 'structural', 'deepSynthesis']) {
        const labels = { ...t.synthesisShell, ...t[window], runSeparator: n => `${n}`, rescueRow: '' };
        const rows = [{ id: 'g1', genNum: 1, layerCount: 3, mf: 0.1, tot: 150, tMs: 100, dMF: -0.01 }];
        const html = renderToStaticMarkup(withDesign(React.createElement(SynthesisHistoryTable, {
            rows, bestMF: 0.1, onRestore() {}, showSide: true, c, labels,
        })));
        assert.ok(html.includes(labels.totCol), `${code} ${window}: the TOT column is there`);
        assert.deepEqual(capitalised(html), [], `${code} ${window}: no header is drawn in capitals`);
    }
}
assert.equal(th(c).textTransform, undefined, 'the Zemax Coatings headers are not drawn in capitals');

console.log('Table headers as written tests passed.');
