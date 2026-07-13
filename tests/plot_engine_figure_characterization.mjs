import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

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
assert.deepEqual(heatmap.layout.margin, { l: 60, r: 16, t: 16, b: 50 });

const surface = buildSurfaceFigure(result, { ...baseSpec, render: 'surface' }, design, c);
assert.equal(surface.traces[0].type, 'surface');
assert.deepEqual(surface.traces[0].contours, { z: { show: false } });
assert.equal(surface.layout.scene.aspectmode, 'cube');
assert.deepEqual(surface.layout.scene.camera, { eye: { x: 1.9, y: -1.9, z: 1.35 } });
assert.deepEqual(surface.layout.margin, { l: 0, r: 0, t: 0, b: 0 });
assert.equal(buildSurfaceFigure(null, baseSpec, design, c), null);
assert.equal(buildSurfaceFigure({ ok: false }, baseSpec, design, c), null);

console.log('PlotEngine figure characterization passed.');
