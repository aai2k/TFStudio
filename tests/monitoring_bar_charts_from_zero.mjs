/**
 * The monitoring wizards draw their bar charts up from zero.
 *
 * Page 5 shows the estimated, as-built and target thickness of the layer being
 * deposited as three bars, and the results page each layer's thickness error.
 * With the y axis fitted to the data alone, the bars of a 60 nm layer rose from
 * about 55 nm and drew as slivers of their height.
 *
 * Run: node tests/monitoring_bar_charts_from_zero.mjs
 */
import assert from 'node:assert/strict';

// The pages read React from the global scope. Elements are kept as plain
// objects so the chart's props can be read back.
globalThis.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useState: value => [value, () => {}],
    useMemo: fn => fn(),
    useCallback: fn => fn,
};

const { SimulationView } = await import('../src/components/windows/simulation/wizardKit/SimulationView.js');
const { Chart, wizardChartOption } = await import('../src/components/windows/simulation/wizardShared.js');

function findElement(node, type) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findElement(child, type);
            if (found) return found;
        }
        return null;
    }
    if (node.type === type) return node;
    return findElement(node.props?.left, type) || findElement(node.children, type);
}

const c = { text: '#cccccc', border: '#3a3a3a', accent: '#007acc', bg: '#1e1e1e', panel: '#252526' };
const playback = {
    jumpLayer() {}, progress: 0, totalTime: 10, playing: false, scrub() {}, playPause() {}, reset() {}, cumTimes: [0, 10],
};
const view = SimulationView({
    p: { quantity: 'T', pol: 'avg', yFixed: false, timeMult: 1 }, set() {}, c, B: {},
    run: { targetFront: [60], asBuiltFront: [58.2], estimatedFront: [59.1] },
    N: 1, layerIdx: 1, frac: 1, series: [], leftTop: null, playback,
});
const bars = findElement(view, Chart);
assert.ok(bars, 'page 5 draws the E/A/T bars');
assert.deepEqual(bars.props.series[0].data.map(item => item.value), [59.1, 58.2, 60]);
assert.equal(wizardChartOption(bars.props).yAxis.scale, false, 'the bars rise from zero');

const errors = wizardChartOption({
    series: [{ type: 'bar', data: [{ value: 1.5 }, { value: 2.1 }] }], xCategories: ['1', '2'], yTitle: 'Δd, nm', c,
});
assert.equal(errors.yAxis.scale, false, 'so do the thickness errors');

const rates = wizardChartOption({ series: [{ type: 'line', data: [[0, 0.4], [10, 0.5]] }], xTitle: 's', yTitle: 'nm/s', c });
assert.equal(rates.yAxis.scale, true, 'a line chart still fits its data');

console.log('monitoring_bar_charts_from_zero passed.');
