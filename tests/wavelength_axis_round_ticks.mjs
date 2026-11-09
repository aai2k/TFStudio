/**
 * A wavelength axis is ticked on round wavelengths, wherever its data starts.
 *
 * A material tabulated from 191.6 nm is plotted from 191.6 nm. The ticks inside
 * that range fall on multiples of the step, 200, 250, 300, and are not counted
 * from the first point as 191.6, 241.6, 291.6.
 *
 * Optical Evaluation steps by 1, 2, 2.5 or 5 nm times a power of ten, never 3:
 * 400-700 nm is ticked every 50 nm, not 30 as 400, 420, 450. An end off the
 * step's grid keeps its label only half a step or more from the next round
 * tick, and a box zoom rules the visible span the same way. A heatmap axis
 * labels the samples on round values, 400, 450 nm and 0, 10 degrees, not every
 * fourteenth sample as 400, 470, 540.
 *
 * The options are laid out by ECharts itself, server-side, so the ticks and
 * labels checked are the ones the window draws.
 *
 * Run: node tests/wavelength_axis_round_ticks.mjs
 */
import assert from 'node:assert/strict';
import React from 'react';
import * as echarts from 'echarts';

// materialChart.js reads React from the global scope, as the app provides it.
globalThis.React = React;
const { buildIndexOption } = await import('../src/components/windows/design/materialEditor/materialChart.js');

const c = { bg: '#1e1e1e', border: '#3a3a3a', text: '#cccccc', textDim: '#999999' };
const FIRST = 191.6;
const LAST = 1000;
const wavelengths = [...Array.from({ length: 160 }, (_, index) => FIRST + 5 * index), LAST];

function xAxisLayout(option) {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 800, height: 450 });
    try {
        chart.setOption(option);
        const scale = chart.getModel().getComponent('xAxis', 0).axis.scale;
        return {
            extent: scale.getExtent(),
            step: scale.getConfig().interval,
            ticks: scale.getTicks().map(tick => tick.value),
        };
    } finally {
        chart.dispose();
    }
}

{
    const { extent, step, ticks } = xAxisLayout(buildIndexOption({
        wavelengths,
        n: wavelengths.map(lambda => 1.45 + 3600 / lambda ** 2),
        k: wavelengths.map(lambda => 1e-3 * (FIRST / lambda) ** 4),
        hasK: true, c, xLabel: 'λ (nm)',
    }));
    assert.deepEqual(extent, [FIRST, LAST],
        `the axis spans the data, ${FIRST}-${LAST} nm, got ${extent.join('-')}`);
    assert.equal(step, 50, `a visible to near-infrared table keeps 50 nm ticks, got ${step}`);
    const inside = ticks.filter(value => value > FIRST && value < LAST);
    assert.ok(inside.length >= 2, `the axis carries ticks inside its range, got ${JSON.stringify(ticks)}`);
    for (const value of inside) {
        assert.ok(Math.abs(value / step - Math.round(value / step)) < 1e-9,
            `every tick inside the range is a multiple of ${step} nm, got ${JSON.stringify(ticks)}`);
    }
}

// ── Optical Evaluation ───────────────────────────────────────────────────────
const { getLocale } = await import('../src/constants/locales/index.js');
const { buildChartOption } = await import('../src/components/windows/analysis/opticalEvaluation/model.js');
const { wavelengthViewRuling } = await import('../src/components/windows/analysis/opticalEvaluation/wavelengthZoom.js');
const en = getLocale('en');

function opticalOption(low, high) {
    const lambda = Array.from({ length: 301 }, (_, index) => low + ((high - low) * index) / 300);
    return buildChartOption({
        spectralTitles: en.spectralAxis, curveLabels: en.opticalEval.curveLabels, legendNames: en.legendNames,
        paperColor: '#222222', bgColor: '#111111', gridColor: '#333333', textColor: '#eeeeee',
        data: { lambda, series: [{ theta: 0, T: lambda.map(() => 0.9), R: lambda.map(() => 0.1) }] },
        showCurves: { T: true, R: true }, overlays: [], targets: [], targetsVisible: false,
        editMode: false, editTool: 'draw', editCurve: 'R',
        yRange: { auto: false, min: 0, max: 100 }, spectralUnit: 'nm', lamRange: { min: low, max: high },
    });
}

// The x axis labels the chart draws, read off its SVG: every number in the
// bottom label row.
function xLabels(option) {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 700, height: 450 });
    try {
        chart.setOption(option);
        const rect = chart.getModel().getComponent('grid', 0).coordinateSystem.getRect();
        const svg = chart.renderToSVGString();
        const labels = [];
        for (const match of svg.matchAll(/<text[^>]*transform="translate\(([\d.-]+) ([\d.-]+)\)"[^>]*>([^<]*)<\/text>/g)) {
            const [, , y, text] = match;
            if (Number(y) > rect.y + rect.height && /^-?\d+(\.\d+)?$/.test(text.trim())) labels.push(Number(text));
        }
        return labels;
    } finally {
        chart.dispose();
    }
}

for (const [low, high, step] of [[400, 700, 50], [400, 800, 50], [400, 1000, 100], [1528, 1563, 5], [500, 600, 20]]) {
    const { extent, step: drawn, ticks } = xAxisLayout(opticalOption(low, high));
    assert.deepEqual(extent, [low, high], `${low}-${high} nm: the axis spans the range`);
    assert.equal(drawn, step, `${low}-${high} nm is ticked every ${step} nm, got ${drawn}`);
    for (const value of ticks.filter(value => value > low && value < high)) {
        assert.ok(Math.abs(value / step - Math.round(value / step)) < 1e-9,
            `${low}-${high} nm: ticks fall on multiples of ${step}, got ${JSON.stringify(ticks)}`);
    }
}
assert.deepEqual(xLabels(opticalOption(400, 700)), [400, 450, 500, 550, 600, 650, 700],
    '400-700 nm is labelled every 50 nm, with no 420 beside 400');
assert.deepEqual(xLabels(opticalOption(380, 780)), [400, 450, 500, 550, 600, 650, 700, 750, 780],
    '380-780 nm drops the 380 label 20 nm short of 400, and keeps 780, 30 nm past 750');

// A box zoom rules what it shows: 437-468 nm every 5 nm, and the whole range
// again once the view is the whole range.
{
    const { xAxis } = opticalOption(400, 800);
    const zoomed = wavelengthViewRuling(xAxis, 437.2, 467.9);
    assert.deepEqual([zoomed.minInterval, zoomed.maxInterval], [5, 5], 'a 31 nm view is ticked every 5 nm');
    assert.deepEqual(zoomed.axisLabel, { showMinLabel: true, showMaxLabel: true },
        'its ends, 2.8 and 2.9 nm off the next 5 nm tick, keep their labels');
    assert.deepEqual(wavelengthViewRuling(xAxis, 438.9, 466.2).axisLabel, { showMinLabel: false, showMaxLabel: false },
        'ends 1.1 and 1.2 nm off the next 5 nm tick are not labelled');
    assert.equal(wavelengthViewRuling(xAxis, 400.0001, 799.9998), null, 'the whole range keeps the option\'s own ruling');
}

// ── Heatmap axes ─────────────────────────────────────────────────────────────
const { buildSurfaceOption, heatmapLabelled } = await import(
    '../src/components/windows/analysis/plotEngine/charts/surfaceOption.js');
const grid = (from, to, count) => Array.from({ length: count }, (_, index) => from + ((to - from) * index) / (count - 1));
const labelled = data => data.filter((_, index) => heatmapLabelled(data)(index));

assert.deepEqual(labelled(grid(400, 800, 81)), [400, 450, 500, 550, 600, 650, 700, 750, 800],
    '400-800 nm in 5 nm steps is labelled every 50 nm, not 400, 470, 540');
assert.deepEqual(labelled(grid(0, 70, 71)), [0, 10, 20, 30, 40, 50, 60, 70],
    '0-70 degrees in 1 degree steps is labelled every 10 degrees, not 0, 12, 24');
assert.deepEqual(labelled(grid(380, 780, 81)), [400, 450, 500, 550, 600, 650, 700, 750, 780],
    'an end 20 nm short of a 50 nm label is dropped, one 30 nm past it kept');
const odd = grid(15.48, 46.45, 40);
assert.deepEqual(labelled(odd), odd.filter((_, index) => index === 0 || index === 39 || index % 7 === 0),
    'a grid that lands on no round step is labelled every seventh sample and at its ends, as before');
{
    const result = { ok: true, x: grid(400, 800, 81), y: grid(0, 70, 71), zKey: 'T' };
    result.z = result.y.map(() => result.x.map(() => 0.9));
    const option = buildSurfaceOption(result,
        { xVar: 'wavelength', yVar: 'aoi', z: 'T', render: 'heatmap', colorscale: 'Jet' }, null, c, { t: en });
    const shown = axis => axis.data.filter((_, index) => axis.axisLabel.interval(index));
    assert.deepEqual([shown(option.xAxis), shown(option.yAxis)],
        [[400, 450, 500, 550, 600, 650, 700, 750, 800], [0, 10, 20, 30, 40, 50, 60, 70]],
        'the heatmap option labels those samples');
}

console.log('wavelength_axis_round_ticks passed.');
