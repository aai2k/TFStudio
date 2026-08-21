import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildCurveTraces, buildSurfaceFigure } = await import(
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

assert.deepEqual(buildCurveTraces(curves, results), [
    {
        x: results.first.x,
        y: results.first.y,
        type: 'scatter',
        mode: 'lines',
        name: 'First',
        line: { color: '#123456', dash: 'dash', width: 3 },
        hovertemplate: 'First<br>λ=%{x:.1f} nm<br>T=%{y:.4f}<extra></extra>',
    },
    {
        x: results.second.x,
        y: results.second.y,
        type: 'scatter',
        mode: 'lines',
        name: 'second',
        line: { color: '#abcdef', dash: 'dot', width: 2 },
        hovertemplate: '<br>AOI=%{x:.1f}°<br>A=%{y:.4f}<extra></extra>',
    },
]);

const c = { panel: '#panel', bg: '#bg', text: '#text', border: '#border' };
const result = { ok: true, x: [1, 2], y: [3, 4], z: [[5, 6], [7, 8]], zLabel: 'Reflectance' };
const design = { frontLayers: [], backLayers: [] };
const baseSpec = { xVar: 'wavelength', yVar: 'aoi', colorscale: 'Cividis' };
const heatmap = buildSurfaceFigure(result, { ...baseSpec, render: 'heatmap' }, design, c);

assert.equal(heatmap.traces.length, 1);
assert.deepEqual(heatmap.traces[0], {
    type: 'heatmap',
    x: result.x,
    y: result.y,
    z: result.z,
    colorscale: 'Cividis',
    colorbar: {
        title: { text: 'Reflectance', side: 'right', font: { color: '#text', size: 11 } },
        tickfont: { color: '#text', size: 9 },
        thickness: 14, len: 0.9, x: 1, xpad: 4,
    },
    hovertemplate: '%{x}<br>%{y}<br>Reflectance=%{z:.4g}<extra></extra>',
});
assert.equal(heatmap.layout.xaxis.title.text, 'Wavelength (nm)');
assert.equal(heatmap.layout.yaxis.title.text, 'AOI (°)');
// A heat map is a normal 2D plot, so it takes the analysis windows' shared
// margins; the 3D surface draws its axes inside the scene and takes none.
assert.deepEqual(heatmap.layout.margin, { l: 58, r: 18, t: 38, b: 52 });

const surface = buildSurfaceFigure(result, { ...baseSpec, render: 'surface' }, design, c);
assert.equal(surface.traces[0].type, 'surface');
assert.deepEqual(surface.traces[0].contours, { z: { show: false } });
assert.equal(surface.layout.scene.aspectmode, 'cube');
assert.deepEqual(surface.layout.scene.camera, { eye: { x: 1.9, y: -1.9, z: 1.35 } });
assert.deepEqual(surface.layout.margin, { l: 0, r: 0, t: 0, b: 0 });
assert.equal(buildSurfaceFigure(null, baseSpec, design, c), null);
assert.equal(buildSurfaceFigure({ ok: false }, baseSpec, design, c), null);

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
