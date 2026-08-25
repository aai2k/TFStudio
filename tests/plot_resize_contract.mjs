/** Shared Apache ECharts lifecycle, resize, and collapsed-window contract. */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const calls = [];
const instances = new WeakMap();
globalThis.echarts = {
    getInstanceByDom: element => instances.get(element) || null,
    init(element, _theme, options) {
        const handlers = {};
        const chart = {
            disposed: false,
            handlers,
            isDisposed() { return this.disposed; },
            setOption(option, settings) { calls.push(['setOption', option, settings]); },
            resize() { calls.push(['resize']); },
            dispose() { this.disposed = true; instances.delete(element); calls.push(['dispose']); },
            getZr: () => ({ on(name, handler) { handlers[name] = handler; } }),
            // The grid of the fake chart is the square from (100, 100) to (200, 200).
            containPixel: (_finder, [x, y]) => x >= 100 && x <= 200 && y >= 100 && y <= 200,
            dispatchAction(action) { calls.push(['dispatchAction', action]); },
        };
        instances.set(element, chart);
        calls.push(['init', options]);
        return chart;
    },
};
globalThis.React = { useEffect: () => {}, useRef: value => ({ current: value }) };

const {
    disposeChart, drawChart, hasRoomToDraw, isDisplayed, resizeChart, setChartOption,
} = await import('../src/components/ui/plotSurface.js');
const {
    LINE_LEGEND_ICON, axisTooltip, cartesianOption, chartToolbox, lineSeries, scatterSeries,
} = await import('../src/components/ui/chartOptions.js');

const roomy = { clientWidth: 800, clientHeight: 600, offsetWidth: 800, offsetHeight: 600 };
const option = { grid: { left: 48, right: 12, top: 12, bottom: 42 }, series: [] };

{
    const chartRef = { current: null };
    const chart = drawChart(roomy, chartRef, option);
    assert.equal(calls[0][0], 'init', 'the first draw creates one native chart instance');
    assert.equal(calls[0][1].renderer, 'canvas');
    // Dirty-rect painting leaves the canvas blank after a resize: reallocating
    // it clears the pixels, and the elements are not re-marked dirty, so
    // nothing repaints until the next real update. Dragging a docking splitter
    // then flickers between the plot and an empty box.
    assert.ok(!calls[0][1].useDirtyRect, 'dirty-rect painting stays off, or resizing blanks the plot');
    assert.equal(calls[1][0], 'setOption');
    assert.deepEqual(calls[1][2], { notMerge: true, lazyUpdate: false });
    assert.equal(chartRef.current, chart);

    drawChart(roomy, chartRef, { ...option, series: [{ type: 'line' }] });
    assert.equal(calls.filter(call => call[0] === 'init').length, 1, 'updates reuse the chart instance');
    assert.equal(calls.filter(call => call[0] === 'setOption').length, 2);

    // A docking splitter drag re-renders every frame with a freshly built but
    // identical option. Reapplying it rebuilds the chart model and flickers, so
    // an unchanged option must not reach setOption at all.
    drawChart(roomy, chartRef, { ...option, series: [{ type: 'line' }] });
    drawChart(roomy, chartRef, { grid: { left: 48, right: 12, top: 12, bottom: 42 }, series: [{ type: 'line' }] });
    assert.equal(calls.filter(call => call[0] === 'setOption').length, 2,
        'an equal option is not reapplied, however freshly it was built');

    // Formatters are new closures on every render; they must not by themselves
    // count as a change, or nothing would ever be skipped.
    drawChart(roomy, chartRef, {
        ...option, series: [{ type: 'line' }], tooltip: { formatter: value => `${value}` },
    });
    drawChart(roomy, chartRef, {
        ...option, series: [{ type: 'line' }], tooltip: { formatter: value => `${value}` },
    });
    assert.equal(calls.filter(call => call[0] === 'setOption').length, 3,
        'adding a tooltip draws once, and the rebuilt closure does not redraw again');

    // Real changes still get through.
    drawChart(roomy, chartRef, { ...option, series: [{ type: 'line', data: [[1, 2]] }] });
    assert.equal(calls.filter(call => call[0] === 'setOption').length, 4, 'changed data redraws');
    drawChart(roomy, chartRef, { ...option, series: [{ type: 'line', data: [[1, 3]] }] });
    assert.equal(calls.filter(call => call[0] === 'setOption').length, 5, 'a changed value redraws');
    drawChart(roomy, chartRef, { ...option, series: [] });
    assert.equal(calls.filter(call => call[0] === 'setOption').length, 6, 'a removed series redraws');
    drawChart(roomy, chartRef, { ...option, series: [], grid: { left: 60, right: 12, top: 12, bottom: 42 } });
    assert.equal(calls.filter(call => call[0] === 'setOption').length, 7,
        'a grid resized by squareGrid redraws');

    // Beyond the comparison budget the check gives up and redraws, which is the
    // behaviour these charts had anyway. It must never decide such an option is
    // unchanged, or a huge plot would freeze on stale data.
    const huge = () => ({
        ...option,
        series: [{ type: 'surface', data: Array.from({ length: 60000 }, (_, i) => [i, i, i]) }],
    });
    drawChart(roomy, chartRef, huge());
    const afterFirstHuge = calls.filter(call => call[0] === 'setOption').length;
    drawChart(roomy, chartRef, huge());
    assert.equal(calls.filter(call => call[0] === 'setOption').length, afterFirstHuge + 1,
        'an option too large to compare redraws rather than being assumed equal');
    assert.deepEqual(option, { grid: { left: 48, right: 12, top: 12, bottom: 42 }, series: [] },
        'drawing does not mutate caller-owned options');

    // Double-clicking the plot is the quick way back to the full range. The
    // toolbox icon ECharts names "Zoom Reset" only steps back through its own
    // rectangle-zoom history, so it does nothing after a wheel zoom.
    const beforeDouble = calls.length;
    chart.handlers.dblclick({ offsetX: 150, offsetY: 150 });
    assert.deepEqual(calls.at(-1), ['dispatchAction', { type: 'dataZoom', start: 0, end: 100 }],
        'a double-click inside the plot returns every axis to its full range');
    chart.handlers.dblclick({ offsetX: 10, offsetY: 10 });
    assert.equal(calls.length, beforeDouble + 1,
        'a double-click on the chrome around the plot is left alone');

    resizeChart(roomy, chartRef);
    assert.equal(calls.at(-1)[0], 'resize');
    const beforeHidden = calls.length;
    resizeChart({ offsetWidth: 0, offsetHeight: 0 }, chartRef);
    assert.equal(calls.length, beforeHidden, 'hidden dock tabs are not resized');

    disposeChart(roomy, chartRef);
    assert.equal(calls.at(-1)[0], 'dispose');
    assert.equal(chartRef.current, null);
}

assert.equal(hasRoomToDraw(roomy, option), true);
assert.equal(hasRoomToDraw({ clientWidth: 55, clientHeight: 600 }, option), false);
assert.equal(hasRoomToDraw({ clientWidth: 800, clientHeight: 50 }, option), false);
assert.equal(hasRoomToDraw({ clientWidth: 0, clientHeight: 0 }, option), false);
assert.equal(hasRoomToDraw({}, option), true, 'an unmeasurable host is not treated as collapsed');
assert.equal(isDisplayed({ offsetWidth: 800, offsetHeight: 0 }), true);
assert.equal(isDisplayed({ offsetWidth: 0, offsetHeight: 0 }), false);
assert.equal(isDisplayed({}), true);

const zoomToolbox = chartToolbox('zoom_contract');
assert.equal(zoomToolbox.feature.restore, undefined,
    'the ECharts 6.1 restore feature is not used because it leaks active zoom controllers');
assert.deepEqual(Object.keys(zoomToolbox.feature.dataZoom.icon), ['zoom', 'back'],
    'the zero-width back icon follows zoom and cannot leave a blank slot before it');
const resetActions = [];
zoomToolbox.feature.myZoomRestore.onclick(null, {
    dispatchAction: action => resetActions.push(action),
});
assert.deepEqual(resetActions, [
    { type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: false },
    { type: 'dataZoom', start: 0, end: 100 },
], 'the replacement reset exits rectangle mode and resets every linked zoom model directly');

const percentTooltip = axisTooltip({ valueSuffix: '%' });
assert.equal(percentTooltip.axisPointer.label.formatter({ value: 63.88, axisDimension: 'y' }), '63.88%');
assert.equal(percentTooltip.axisPointer.label.formatter({ value: 592, axisDimension: 'x' }), '592');

const legendOption = cartesianOption({
    legend: { show: true },
    series: [
        lineSeries({ data: [[0, 0]], name: 'curve' }),
        scatterSeries({ data: [[0, 0]], name: 'point', symbol: 'triangle' }),
    ],
});
assert.equal(legendOption.legend.data[0].icon, LINE_LEGEND_ICON,
    'line legends use a stroke without a marker that the curve does not draw');
assert.equal(legendOption.legend.data[1], 'point',
    'genuine point series keep their native legend marker');

{
    calls.length = 0;
    const collapsed = { clientWidth: 20, clientHeight: 600 };
    assert.equal(drawChart(collapsed, { current: null }, option), null);
    assert.equal(calls.length, 0, 'a collapsed chart is skipped cleanly');
    assert.ok(setChartOption(roomy, option), 'imperative charts use the same lifecycle');
}

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const full = join(directory, entry.name);
        return entry.isDirectory() ? walk(full) : entry.name.endsWith('.js') ? [full] : [];
    });
}
for (const file of walk(sourceRoot)) {
    const source = readFileSync(file, 'utf8');
    if (file.endsWith(join('components', 'ui', 'plotSurface.js'))) continue;
    assert.doesNotMatch(source, /echarts\.(?:init|getInstanceByDom)\s*\(/,
        `${file}: chart instance lifecycle bypasses the shared surface`);
    assert.doesNotMatch(source, /useEffect\(\(\)\s*=>\s*(?:drawChart|setChartOption)\s*\(/,
        `${file}: a React effect must not return an ECharts instance as its cleanup`);
    assert.doesNotMatch(source, /=>\s*(?:drawChart|setChartOption)\s*\(/,
        `${file}: concise callbacks must not leak an ECharts instance as a return value`);
}

console.log('PASS: ECharts resize contract');
