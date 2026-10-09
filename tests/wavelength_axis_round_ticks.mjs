/**
 * A wavelength axis is ticked on round wavelengths, wherever its data starts.
 *
 * A material tabulated from 191.6 nm is plotted from 191.6 nm. The ticks inside
 * that range fall on multiples of the step, 200, 250, 300, and are not counted
 * from the first point as 191.6, 241.6, 291.6.
 *
 * The option is laid out by ECharts itself, server-side, so the ticks checked
 * are the ones the window draws.
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

console.log('wavelength_axis_round_ticks passed.');
