import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildCurveSeries, buildSurfaceOption } = await import(
    '../src/components/windows/analysis/plotEngine/charts.js'
);

const curves = [
    { id: 'first', visible: true, label: 'First', color: '#123456', dash: 'dash', width: 3, xAxis: 'wavelength', yChannel: 'T' },
    { id: 'hidden', visible: false, label: 'Hidden', color: '#000000', dash: 'solid', width: 2, xAxis: 'aoi', yChannel: 'R' },
    { id: 'second', visible: true, label: '', color: '#abcdef', dash: 'dot', width: 0, xAxis: 'aoi', yChannel: 'A' },
    { id: 'missing', visible: true, label: 'Missing', color: '#ffffff', dash: 'solid', width: 2, xAxis: 'wavelength', yChannel: 'R' },
];
const results = {
    first: { x: [400, 500], y: [0.1, 0.2] },
    hidden: { x: [0], y: [1] },
    second: { x: [0, 45], y: [0.3, 0.4] },
};

const curveSeries = buildCurveSeries(curves, results);
assert.deepEqual(curveSeries.map(series => series.name), ['First', 'second']);
assert.deepEqual(curveSeries.map(series => series.data), [
    [[400, 10], [500, 20]],
    [[0, 30], [45, 40]],
]);
assert.deepEqual(curveSeries.map(series => series.lineStyle), [
    { color: '#123456', width: 3, type: 'dashed' },
    { color: '#abcdef', width: 2, type: 'dotted' },
]);

const c = { panel: '#panel', bg: '#bg', text: '#text', border: '#border' };
const result = { ok: true, x: [1, 2], y: [3, 4], z: [[5, 6], [7, 8]], zLabel: 'Reflectance' };
const design = { frontLayers: [], backLayers: [] };
const baseSpec = { xVar: 'wavelength', yVar: 'aoi', z: 'R', colorscale: 'Cividis' };
const heatmap = buildSurfaceOption(result, { ...baseSpec, render: 'heatmap' }, design, c);

assert.equal(heatmap.series.length, 1);
assert.equal(heatmap.series[0].type, 'heatmap');
assert.deepEqual(heatmap.series[0].data, [[0, 0, 500], [1, 0, 600], [0, 1, 700], [1, 1, 800]]);
assert.deepEqual(heatmap.visualMap.inRange.color, ['#00204c', '#424086', '#7c7b78', '#bcae5c', '#ffea46']);
assert.equal(heatmap.xAxis.name, 'Wavelength (nm)');
assert.equal(heatmap.yAxis.name, 'AOI (°)');
assert.deepEqual(heatmap.xAxis.data, [1, 2]);
assert.deepEqual(heatmap.yAxis.data, [3, 4]);
// A heat map is a normal 2D plot, so it takes the analysis windows' shared
// margins; the 3D surface draws its axes inside the scene and takes none.
assert.deepEqual(
    [heatmap.grid.left, heatmap.grid.right, heatmap.grid.top, heatmap.grid.bottom],
    [58, 72, 38, 52],
);

const surface = buildSurfaceOption(result, { ...baseSpec, render: 'surface' }, design, c);
assert.equal(surface.series[0].type, 'surface');
assert.deepEqual(surface.series[0].data, [[1, 3, 500], [2, 3, 600], [1, 4, 700], [2, 4, 800]]);
assert.equal(surface.series[0].wireframe.show, false);
assert.equal(surface.grid3D.viewControl.projection, 'perspective');
assert.equal(surface.grid3D.viewControl.rotateSensitivity, 2.5);
assert.equal(surface.grid3D.viewControl.zoomSensitivity, 2);
assert.equal(surface.grid3D.viewControl.panSensitivity, 1.5);
assert.equal(surface.grid3D.boxWidth, surface.grid3D.boxDepth);
assert.equal(surface.xAxis3D.name, 'Wavelength (nm)');
assert.equal(surface.zAxis3D.name, '%');
assert.equal(surface.visualMap.text[0], 'Reflectance (%)');
assert.equal(buildSurfaceOption(null, baseSpec, design, c), null);
assert.equal(buildSurfaceOption({ ok: false }, baseSpec, design, c), null);

// ── Both modes of the window itself ─────────────────────────────────────────
//
// The figure builders above are pure and were covered; the components were not,
// and 3D is a separate component tree from 2D — a different chart, a different
// settings panel and a different results table. A call to an undefined hook sat
// in SurfaceChart through several releases because nothing ever rendered it.
{
    const { PlotEngine } = await import(
        '../src/components/windows/analysis/plotEngine/PlotEngine.js');
    const { plotEngineSession } = await import(
        '../src/components/windows/analysis/plotEngine/sessionState.js');

    const theme = makeTheme();
    const t = makeLocale();
    const sample = makeSampleDesign();
    const render = () => renderToStaticMarkup(withDesign(
        React.createElement(PlotEngine, { c: theme, theme, t }), sample));

    plotEngineSession.reset();
    assert.match(render(), /2D Curves/, '2D mode renders');

    plotEngineSession.write(sample, { plotMode: '3d' });
    assert.match(render(), /Configure the axes/,
        '3D mode renders its chart without throwing, and prompts for a computation');

    // With a computed surface the results table lays the grid out row by row.
    plotEngineSession.write(sample, {
        surfaceResult: { ok: true, x: [1, 2], y: [3, 4], z: [[5, 6], [7, 8]], zLabel: 'T' },
        showTable: true,
    });
    const computedHtml = render();
    assert.match(computedHtml, /<td[^>]*>5\.000000<\/td>/,
        'the surface grid reaches the results table');

    plotEngineSession.reset();

    // The surface settings live behind a popover that a server render never
    // opens, so the panel is rendered on its own to keep it covered.
    const { SurfacePanel } = await import(
        '../src/components/windows/analysis/plotEngine/SurfacePanel.js');
    const { makeDefaultSurfaceSpec } = await import(
        '../src/utils/physics/plotQuantities.js');
    const panelHtml = renderToStaticMarkup(React.createElement(SurfacePanel, {
        spec: makeDefaultSurfaceSpec(sample, { surfaceMode: 'front' }),
        onUpdate: () => {}, onCompute: () => {},
        computing: false, progress: null, design: sample, result: null,
        c: theme, t,
    }));
    assert.match(panelHtml, /Compute surface/);
    assert.match(panelHtml, /Quantity \(Z\)/);
}

console.log('PlotEngine figure characterization passed.');
