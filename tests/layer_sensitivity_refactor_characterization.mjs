import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp,
    makeLocale,
    makeSampleDesign,
    makeTheme,
    shimBrowserGlobals,
    withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildSensitivityOption } = await import(
    '../src/components/windows/analysis/layerSensitivity/figure.js'
);
const {
    buildSpecDesigns,
    displayLayerLabel,
    hasSensitivityLayers,
    orderSubstrateFirst,
    rankSensitivityRows,
} = await import('../src/components/windows/analysis/layerSensitivity/viewModel.js');
const { LayerSensitivity } = await import(
    '../src/components/windows/analysis/layerSensitivity/LayerSensitivity.js'
);

const rows = [
    { side: 'front', layerIndex: 0, materialId: 'H', deltaMFAbs: 2, sensitivity: 100 },
    { side: 'back', layerIndex: 1, materialId: 'L', deltaMFAbs: 1, sensitivity: 50 },
    { side: 'front', layerIndex: 1, materialId: 'L', deltaMFAbs: 0.5, sensitivity: 25 },
    { side: 'back', layerIndex: 0, materialId: 'H', deltaMFAbs: 3, sensitivity: 75 },
];
const ordered = orderSubstrateFirst(rows, 2);
assert.deepEqual(ordered.map(row => displayLayerLabel(row, 2)), ['F1', 'F2', 'B1', 'B2']);
assert.deepEqual(rankSensitivityRows(ordered).map(row => row.rank), [4, 2, 1, 3]);

assert.equal(hasSensitivityLayers({ surfaceMode: 'front_only', frontLayers: [{}] }), true);
assert.equal(hasSensitivityLayers({ surfaceMode: 'back_only', frontLayers: [{}] }), false);
assert.equal(hasSensitivityLayers({ surfaceMode: 'back_only', backLayers: [{}] }), true);
assert.equal(hasSensitivityLayers({ surfaceMode: 'both_independent', backLayers: [{}] }), true);

const design = {
    frontLayers: [{ thickness: 100 }],
    backLayers: [{ thickness: 0 }],
};
assert.deepEqual(
    buildSpecDesigns(design, 'relative', 10, 3).map(item => [
        item.frontLayers[0].thickness, item.backLayers[0].thickness,
    ]),
    [[110.00000000000001, 0], [90, 0]],
);
assert.deepEqual(
    buildSpecDesigns(design, 'absolute', 10, 3).map(item => [
        item.frontLayers[0].thickness, item.backLayers[0].thickness,
    ]),
    [[103, 3], [97, 0]],
);

const c = makeTheme();
const normalized = buildSensitivityOption({
    rows: ordered, matColorMap: { H: '#111', L: '#222' },
    scale: 'normalized', frontCount: 2, c,
    xTitle: 'Layer', yTitle: 'Sensitivity (%)',
});
assert.deepEqual(normalized.xAxis.data, ['F1', 'F2', 'B1', 'B2']);
assert.deepEqual(normalized.series[0].data.map(item => item.value), [25, 100, 75, 50]);
assert.deepEqual(normalized.series[0].data.map(item => item.itemStyle.color), ['#222', '#111', '#111', '#222']);
assert.equal(normalized.yAxis.type, 'value');
assert.equal(normalized.yAxis.name, 'Sensitivity (%)');
assert.equal(normalized.xAxis.name, 'Layer',
    'the axis titles come from the locale, not from the figure builder');
const absolute = buildSensitivityOption({
    rows: ordered, matColorMap: {}, scale: 'absolute', frontCount: 2, c,
    xTitle: 'Layer', yTitle: 'Sensitivity (%)',
});
assert.deepEqual(absolute.series[0].data.map(item => item.value), [0.5, 2, 3, 1]);
assert.equal(absolute.yAxis.type, 'log');
assert.equal(absolute.yAxis.name, '|ΔOMF|');
assert.deepEqual(buildSensitivityOption({ rows: [], c }), { series: [] });

// Without merit operands there is nothing to rank, so this render is the
// "define targets first" message.
// With operands the window shows its ranking. The table is the window and the
// bar chart is a strip below it: the ranking is the answer, and a design with a
// hundred layers turns the chart into a picket fence while the table still
// reads top to bottom.
const ranked = makeSampleDesign();
ranked.meritOperands = [{
    type: 'RAV', lambdaStart: 450, lambdaEnd: 650,
    aoi: 0, pol: 'avg', target: 0, weight: 1, enabled: true,
}];
const rankedHtml = renderToStaticMarkup(withDesign(
    React.createElement(LayerSensitivity, { c, theme: c, t: makeLocale() }),
    ranked,
));
assert.match(rankedHtml, /<th[^>]*>Rank<\/th>/,
    'the ranked table is rendered directly, not behind a collapsed strip');
assert.match(rankedHtml, /Chart<\/span>/, 'and the bar chart is a strip below it');
assert.equal(rankedHtml.indexOf('Rank') < rankedHtml.indexOf('Chart<'), true,
    'the table comes first');

console.log('PASS: layer_sensitivity_refactor_characterization');
