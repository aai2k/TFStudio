/**
 * The refractiveindex.info browser's n/k chart follows the size of its box.
 *
 * The chart takes the height the page details above it leave, and that height
 * changes from one page to the next. The chart kept the size it was created
 * at, so after a page with more text above it the canvas ran down over the
 * button bar and covered the Add to Catalog button.
 *
 * Run: node tests/rii_chart_resize.mjs
 */

import assert from 'node:assert/strict';

const effects = [];
globalThis.React = {
    createElement: (type, props) => ({ type, props }),
    useRef: initial => ({ current: initial }),
    useEffect: effect => effects.push(effect),
};

let observer;
globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
};

const calls = { init: 0, options: 0, resize: 0, dispose: 0 };
const instances = new WeakMap();
globalThis.echarts = {
    getInstanceByDom: element => instances.get(element) || null,
    init(element) {
        const chart = {
            setOption: () => { calls.options++; },
            resize: () => { calls.resize++; },
            dispose: () => { calls.dispose++; instances.delete(element); },
            isDisposed: () => false,
            getZr: () => ({ on: () => {} }),
            on: () => {},
            containPixel: () => false,
            dispatchAction: () => {},
        };
        instances.set(element, chart);
        calls.init++;
        return chart;
    },
};

const { RiiChart } = await import('../src/components/windows/design/materialEditor/riiChart.js');

const material = { type: 'tabulated_nk', tableNK: [[400, 2.22, 0], [550, 2.16, 0], [800, 2.13, 0]] };
const tree = RiiChart({
    material, xLabel: 'Wavelength (nm)',
    c: { bg: '#111', border: '#333', text: '#eee', textDim: '#999' },
});
assert.equal(tree.props.style.flex, 1, 'the chart takes the height left under the details');
const host = { clientWidth: 520, clientHeight: 300, offsetWidth: 520, offsetHeight: 300 };
tree.props.ref.current = host;

effects[0]();
const cleanup = effects[1]();

assert.equal(calls.init, 1, 'creates one chart');
assert.equal(calls.options, 1, 'draws the page');
assert.equal(observer.target, host, 'watches the size of its box');

observer.callback();
assert.equal(calls.resize, 1, 'resizes when the box changes size');

cleanup();
assert.equal(observer.disconnected, true, 'stops watching when the details close');
assert.equal(calls.dispose, 1, 'disposes the chart when the details close');

console.log('rii_chart_resize: passed');
