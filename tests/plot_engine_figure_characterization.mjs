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
// margins; the 3D surface draws its axes inside the scene and takes none. The
// right margin is widened from the shared one to clear the colour bar.
assert.deepEqual(
    [heatmap.grid.left, heatmap.grid.right, heatmap.grid.top, heatmap.grid.bottom],
    [58, 84, 38, 52],
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

// A 3D value axis works its own range out and ECharts forces that range to
// include zero, which drew a 400-800 nm sweep from 0. Both swept axes carry the
// interval they were swept over instead.
assert.equal(surface.xAxis3D.min, 1);
assert.equal(surface.xAxis3D.max, 2);
assert.equal(surface.yAxis3D.min, 3);
assert.equal(surface.yAxis3D.max, 4);

// Entered high-to-low, the axis still runs low to high.
const reversed = buildSurfaceOption(
    { ...result, x: [2, 1] }, { ...baseSpec, render: 'surface' }, design, c);
assert.equal(reversed.xAxis3D.min, 1);
assert.equal(reversed.xAxis3D.max, 2);

// Both ends the same has no width; the axis is padded rather than left flat.
const flat = buildSurfaceOption(
    { ...result, x: [5, 5] }, { ...baseSpec, render: 'surface' }, design, c);
assert.ok(flat.xAxis3D.max > flat.xAxis3D.min, 'a zero-width axis is padded');
assert.equal(surface.zAxis3D.name, '%');
assert.equal(surface.visualMap.text[0], 'R (%)');

// A readout names every line it shows. The quantity labels its own value rather
// than heading the tooltip, which left the number at the bottom as a bare figure
// with its name three lines above it.
assert.equal(
    heatmap.tooltip.formatter({ value: [1, 0, 600] }),
    'Wavelength (nm): 2<br/>AOI (°): 3<br/>Reflectance (%): 600',
);
assert.equal(
    surface.tooltip.formatter({ value: [2, 3, 600] }),
    'Wavelength (nm): 2<br/>AOI (°): 3<br/>Reflectance (%): 600',
);

assert.equal(buildSurfaceOption(null, baseSpec, design, c), null);
assert.equal(buildSurfaceOption({ ok: false }, baseSpec, design, c), null);

// ── The flat map drawn as one image ─────────────────────────────────────────
//
// Rasterised, the grid has a single element, so there is nothing per cell to
// hover and the window reads itself out under the pointer. That has to be said
// in the option rather than left out of it: the shared cartesian option falls
// back to an axis tooltip for a missing key, which puts a crosshair and a
// second readout on top of the window's own.
{
    const heatSpec = { ...baseSpec, render: 'heatmap' };
    const imaged = buildSurfaceOption(result, heatSpec, design, c, { image: { imageId: 7 } });

    assert.equal(imaged.tooltip.show, false, 'an image map asks for no tooltip');
    assert.equal(imaged.series[0].type, 'custom');
    assert.deepEqual(imaged.visualMap.seriesIndex, [],
        'the bar maps no series, because the image already carries the colours');

    // The canvas itself only reaches the chart inside a renderItem closure, and
    // the option comparison in plotSurface.js reads every function as equal. Its
    // id is the only part a redraw can see, so a new image must change it or the
    // chart goes on drawing the one before.
    assert.equal(imaged.series[0].imageId, 7);
    assert.notEqual(
        buildSurfaceOption(result, heatSpec, design, c, { image: { imageId: 8 } }).series[0].imageId,
        imaged.series[0].imageId,
        'a different image is a different option');

    // A cell the sweep could not evaluate must stay out of the extent. Taken
    // into it, both ends go NaN, every cell maps to the bottom of the scale and
    // the bar prints NaN: a map with one hole would misreport every value it has.
    const holed = buildSurfaceOption(
        { ...result, z: [[5, Number.NaN], [7, 8]] }, heatSpec, design, c, { image: { imageId: 9 } });
    assert.equal(holed.visualMap.min, 500, 'the extent spans the cells that did evaluate');
    assert.equal(holed.visualMap.max, 800);

    // Nothing evaluated at all still has to leave the bar a range to draw on.
    const blank = buildSurfaceOption(
        { ...result, z: [[Number.NaN, Number.NaN], [Number.NaN, Number.NaN]] },
        heatSpec, design, c, { image: { imageId: 10 } });
    assert.ok(Number.isFinite(blank.visualMap.min) && blank.visualMap.max > blank.visualMap.min,
        'an empty grid still gives the colour bar a finite range');
}

// ── The image follows the axes, so the map can be zoomed ────────────────────
//
// Blitting it to the plot rect ignored the axis window: a rectangle zoom moved
// the labels while the picture went on showing the whole grid. The corners go
// through the axes instead, and the plot clips what falls outside it.
{
    const heatSpec = { ...baseSpec, render: 'heatmap' };
    const wide = { ok: true, x: [400, 500, 600], y: [0, 30, 60], z: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], zLabel: 'T' };
    const series = buildSurfaceOption(wide, heatSpec, design, c, { image: { imageId: 13 } }).series[0];
    const grid = { x: 10, y: 20, width: 300, height: 200 };

    // All three columns in view: index i sits at the centre of band i, so the
    // image spans the plot rect exactly, as it always did unzoomed.
    const showing = (bands, offset) => ({
        coord: ([cx, cy]) => [
            grid.x + (cx - offset + 0.5) * (grid.width / bands),
            grid.y + grid.height - (cy - offset + 0.5) * (grid.height / bands),
        ],
    });
    const unzoomed = series.renderItem({ coordSys: grid }, showing(3, 0)).style;
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    assert.ok(
        near(unzoomed.x, grid.x) && near(unzoomed.y, grid.y)
        && near(unzoomed.width, grid.width) && near(unzoomed.height, grid.height),
        'with every band in view the image covers the plot rect');

    // Zoomed to the middle band, the same image is drawn three times the size
    // and shifted, so the band that is in view fills the plot.
    const zoomed = series.renderItem({ coordSys: grid }, showing(1, 1));
    assert.ok(near(zoomed.style.width, grid.width * 3), 'a third of the range draws it three times as wide');
    assert.ok(near(zoomed.style.height, grid.height * 3));
    assert.ok(near(zoomed.style.x, grid.x - grid.width), 'and shifted so the middle band lands on the plot');
    assert.deepEqual(zoomed.clipPath, { type: 'rect', shape: grid },
        'the overflow is clipped to the plot rather than painted over the axes');
}

// ── The colour bar's end labels ─────────────────────────────────────────────
//
// They are drawn in the margin beside the bar, so a label wider than that
// margin is painted over the plot. A transmittance floor of 5.24e-24 against a
// bar running to 99.5 did exactly that, and it is zero on that bar anyway.
{
    const heatSpec = { ...baseSpec, render: 'heatmap' };
    const floored = buildSurfaceOption(
        { ...result, z: [[5.24e-26, 0.9951], [0.5, 0.2]] },
        { ...heatSpec, z: 'T' }, design, c, { image: { imageId: 11 } });
    const label = floored.visualMap.formatter;
    assert.equal(label(floored.visualMap.min), '0',
        'a floor far below what the bar can resolve reads as zero');
    assert.equal(label(floored.visualMap.max), '99.5');

    // A span that is genuinely small keeps the digits that tell it apart, so
    // the rounding follows the bar rather than a fixed number of places.
    const tiny = buildSurfaceOption(
        { ...result, z: [[1.2e-8, 3.4e-8], [2e-8, 2.5e-8]] },
        { ...heatSpec, z: 'k' }, design, c, { image: { imageId: 12 } });
    assert.equal(tiny.visualMap.formatter(tiny.visualMap.min), '1.2e-8');
    assert.equal(tiny.visualMap.formatter(tiny.visualMap.max), '3.4e-8');
}

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
