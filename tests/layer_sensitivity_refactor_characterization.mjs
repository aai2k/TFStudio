import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildSensitivityFigure } = await import(
    '../src/components/windows/analysis/layerSensitivity/figure.js'
);
const {
    buildSpecDesigns, displayLayerLabel, hasSensitivityLayers,
    orderSubstrateFirst, rankSensitivityRows,
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
const normalized = buildSensitivityFigure({
    rows: ordered, matColorMap: { H: '#111', L: '#222' },
    scale: 'normalized', frontCount: 2, c,
});
assert.deepEqual(normalized.data[0].x, ['F1', 'F2', 'B1', 'B2']);
assert.deepEqual(normalized.data[0].y, [25, 100, 75, 50]);
assert.deepEqual(normalized.data[0].marker.color, ['#222', '#111', '#111', '#222']);
assert.equal(normalized.layout.yaxis.type, 'linear');
assert.equal(normalized.layout.yaxis.title.text, 'Sensitivity (%)');
const absolute = buildSensitivityFigure({
    rows: ordered, matColorMap: {}, scale: 'absolute', frontCount: 2, c,
});
assert.deepEqual(absolute.data[0].y, [0.5, 2, 3, 1]);
assert.equal(absolute.layout.yaxis.type, 'log');
assert.equal(absolute.layout.yaxis.title.text, '|ΔOMF|');
assert.deepEqual(buildSensitivityFigure({ rows: [], c }).layout, {});

const html = renderToStaticMarkup(withDesign(
    React.createElement(LayerSensitivity, { c, theme: c, t: makeLocale() }),
    makeSampleDesign(),
));
const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
assert.equal(hash, '1e7947de56d9aaf7');

console.log('PASS: layer_sensitivity_refactor_characterization');
