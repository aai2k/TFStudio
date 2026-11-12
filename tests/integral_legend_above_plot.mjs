/**
 * Integral Values draws its legend above the plot, never over the curves.
 *
 * The chart's title takes the row above the plot where the other analysis
 * windows put their legend, so the legend has a row of its own under it: below
 * the title and the toolbox, and as far above the plot as the other windows'
 * legend is. A window too narrow for the row pages it rather than wrapping it
 * into the plot. A chart drawn with no title keeps the other windows' row.
 *
 * The Min entry of the legend points down, as the Min mark on the plot does,
 * and the Max entry points up.
 *
 * The options are laid out by ECharts itself, server-side, so the boxes checked
 * are the ones the window draws.
 *
 * Run: node tests/integral_legend_above_plot.mjs
 */
import assert from 'node:assert/strict';
import * as echarts from 'echarts';
import { getLocale } from '../src/constants/locales/index.js';
import { makeUserWeighting } from '../src/utils/physics/integralValues/builtinWeightings.js';
import { legendAbove, plotMargin } from '../src/components/windows/analysis/chrome/plot.js';
import { buildOverlayOption } from '../src/components/windows/analysis/integralValues/overlayFigure.js';

const { integralValues: labels, units } = getLocale('en');
const colors = { text: '#cccccc', grid: '#3a3a3a', panel: '#252526' };
const lambda = Array.from({ length: 221 }, (_, index) => 300 + 10 * index);
const spectrum = { lambda, T: lambda.map(value => 0.3 + 0.69 * (1 - Math.exp(-(value - 300) / 60))) };
const weighting = makeUserWeighting([[400, 1], [550, 2], [700, 1]], 'Halogen lamp');
const minMaxMarks = { min: 0.8478, lamAtMin: 380, max: 0.9996, lamAtMax: 445 };

// The four entries the legend can hold: the channel, the weighting curve and
// the min and max marks.
function overlay(title) {
    return buildOverlayOption({
        spectrum, char: 'T', weighting, minMaxMarks, colors, title,
        lambdaAxis: 'λ (nm)', labels, units,
    });
}

// The boxes ECharts lays the title, toolbox, legend and plot out in, in px
// from the chart's top left. A legend's box includes its padding; its entries
// start that padding inside the box.
function layout(option, width, height = 400) {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
    try {
        chart.setOption(option);
        const model = chart.getModel();
        const box = type => {
            const group = chart.getViewOfComponentModel(model.getComponent(type)).group;
            group.updateTransform();
            const rect = group.getBoundingRect().clone();
            if (group.transform) rect.applyTransform(group.transform);
            return { top: rect.y, bottom: rect.y + rect.height };
        };
        const plot = model.getComponent('grid').coordinateSystem.getRect();
        const legend = box('legend');
        return {
            title: option.title ? box('title') : null,
            toolbox: box('toolbox'),
            legend,
            entriesTop: legend.top + model.getComponent('legend').get('padding'),
            plotTop: plot.y,
        };
    } finally {
        chart.dispose();
    }
}

// With the title the window draws: the legend's row is under it.
{
    const option = overlay('Halogen: T(λ) × Halogen lamp');
    assert.equal(option.legend.data.length, 4, 'the legend lists the curve, the weighting and both marks');
    assert.equal(option.legend.orient, 'horizontal', 'the legend is a row');
    assert.equal(option.grid.top - option.legend.top, plotMargin().top - legendAbove().top,
        'the legend is as far above the plot as the other windows\' legend');
    // 575 px is the chart's width at the default split of the dock; 400 px is
    // too narrow for the row, which then pages.
    for (const width of [575, 400]) {
        const box = layout(option, width);
        assert.ok(box.legend.bottom <= box.plotTop,
            `${width} px: the legend ends at ${box.legend.bottom} px, above the plot at ${box.plotTop} px`);
        assert.ok(box.entriesTop >= box.title.bottom,
            `${width} px: the legend's entries start at ${box.entriesTop} px, under the title ending at ${box.title.bottom} px`);
        assert.ok(box.entriesTop >= box.toolbox.bottom,
            `${width} px: the legend's entries start at ${box.entriesTop} px, under the toolbox ending at ${box.toolbox.bottom} px`);
    }
}

// With no title the legend takes the row the other windows give it.
{
    const option = overlay(undefined);
    assert.equal(option.legend.top, legendAbove().top, 'the legend is in the first row');
    assert.equal(option.grid.top, plotMargin().top, 'the plot starts where the other windows\' does');
    const box = layout(option, 575);
    assert.ok(box.legend.bottom <= box.plotTop,
        `the legend ends at ${box.legend.bottom} px, above the plot at ${box.plotTop} px`);
}

// Which way a triangle points as ECharts draws it. Its built-in 'triangle' has
// the apex at the top; a path's apex is the corner whose height no other corner
// shares, and screen y grows downward. A half turn points it the other way.
function pointsDown(symbol, rotation = 0) {
    let down = false;
    if (symbol !== 'triangle') {
        const heights = [...String(symbol).matchAll(/-?[\d.]+,(-?[\d.]+)/g)].map(match => Number(match[1]));
        assert.equal(heights.length, 3, `a triangle has three corners, got ${symbol}`);
        const apex = heights.find(height => heights.filter(other => other === height).length === 1);
        down = apex > Math.min(...heights);
    }
    return rotation % 360 === 180 ? !down : down;
}

// On the plot a mark is its series' symbol turned by the series' rotation. In
// the legend it is the entry's own icon, or else the series' symbol, unturned:
// ECharts 6.1 (LegendView._createItem) turns a legend icon only for an entry
// whose icon is 'inherit'.
{
    const option = overlay('Halogen: T(λ) × Halogen lamp');
    for (const [label, down] of [[labels.col_min, true], [labels.col_max, false]]) {
        const series = option.series.find(item => item.name.startsWith(`${label} `));
        const entry = option.legend.data.find(item => (item.name ?? item) === series.name);
        assert.equal(pointsDown(series.symbol, series.symbolRotate), down,
            `the ${label} mark on the plot points ${down ? 'down' : 'up'}`);
        assert.equal(pointsDown(entry.icon ?? series.symbol), down,
            `the ${label} entry in the legend points ${down ? 'down' : 'up'}, as its mark does`);
    }
}

console.log('integral_legend_above_plot passed.');
