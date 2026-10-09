/**
 * Monte Carlo ticks its percent axis to suit the range the curves reach.
 *
 * An antireflection coating stays under 1 % reflectance across its band. On a
 * fixed 10 % step the axis carries two labels, 0 and the top of the corridor,
 * and nothing between to read the curves against. A curve over the full 0-100 %
 * keeps its 10 % ticks.
 *
 * The option is laid out by ECharts itself, server-side, so the ticks checked
 * are the ones the window draws.
 *
 * Run: node tests/monte_carlo_percent_ticks.mjs
 */
import assert from 'node:assert/strict';
import React from 'react';
import * as echarts from 'echarts';

// ErrorChart.js reads React from the global scope, as the app provides it.
globalThis.React = React;
const { buildErrorOption } = await import('../src/components/windows/analysis/errorAnalysis/ErrorChart.js');
const { getLocale } = await import('../src/constants/locales/index.js');

const c = { bg: '#1e1e1e', panel: '#252526', border: '#3a3a3a', text: '#cccccc' };
const tr = getLocale('en').errorAnalysis;
const lambda = Array.from({ length: 61 }, (_, index) => 400 + 10 * index);

function yTicks(peak) {
    const shape = lambda.map((_, index) => peak * (0.4 + 0.6 * Math.abs(Math.sin(index / 9))));
    const result = {
        lambda,
        mean: shape.map(value => value * 0.95),
        stdev: shape.map(value => value * 0.05),
        theory: shape,
    };
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 800, height: 450 });
    try {
        chart.setOption(buildErrorOption({ result, char: 'R', c, tr, lambdaAxis: 'λ (nm)' }));
        const axis = chart.getModel().getComponent('yAxis', 0).axis;
        return axis.scale.getTicks().map(tick => tick.value);
    } finally {
        chart.dispose();
    }
}

{
    const ticks = yTicks(0.008);
    assert.ok(ticks.length >= 5,
        `a coating under 1 % gets a readable scale, got ticks ${JSON.stringify(ticks)}`);
}

{
    const ticks = yTicks(1);
    assert.equal(ticks[1] - ticks[0], 10, `a full-range curve keeps 10 % ticks, got ${JSON.stringify(ticks)}`);
}

console.log('monte_carlo_percent_ticks passed.');
