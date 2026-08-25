import assert from 'node:assert/strict';

const effects = [];
globalThis.React = {
    createElement: (type, props) => ({ type, props }),
    useRef: initial => ({ current: initial }),
    useEffect: effect => effects.push(effect),
};

let nextFrame = 1;
const frames = new Map();
globalThis.requestAnimationFrame = callback => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
};
globalThis.cancelAnimationFrame = id => frames.delete(id);
const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback());
};

let observer;
globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
};

const calls = { init: [], options: [], resize: 0, dispose: 0 };
const instances = new WeakMap();
globalThis.echarts = {
    getInstanceByDom: element => instances.get(element) || null,
    init(element, _theme, options) {
        const chart = {
            setOption: option => calls.options.push(option),
            resize: () => { calls.resize++; },
            dispose: () => { calls.dispose++; instances.delete(element); },
            isDisposed: () => false,
            getZr: () => ({ on: () => {} }),
            on: () => {},
            containPixel: () => false,
            dispatchAction: () => {},
        };
        instances.set(element, chart);
        calls.init.push(options);
        return chart;
    },
};

const { MFTrendPlot } = await import('../src/components/windows/optimization/refinement/MFTrendPlot.js');
const tree = MFTrendPlot({
    history: [{ iter: 0, mf: 1e-2 }, { iter: 13, mf: 1e-6 }],
    c: { bg: '#111', panel: '#222', border: '#333', text: '#eee' },
});
const host = { clientWidth: 800, clientHeight: 260, offsetWidth: 800, offsetHeight: 260 };
tree.props.ref.current = host;

effects[0]();
const cleanup = effects[1]();

assert.equal(calls.init.length, 1, 'creates one native chart');
const option = calls.options[0];
assert.equal(option.yAxis.type, 'log');
assert.equal(option.yAxis.name, 'MF');
assert.deepEqual(option.series[0].data, [[0, 1e-2], [13, 1e-6]]);
assert.equal(option.tooltip.transitionDuration, 0, 'tooltip does not glide behind the pointer');
assert.equal(observer.target, host, 'observes docked-panel size changes');

observer.callback();
flushFrames();
assert.equal(calls.resize, 1, 'resizes after the element changes size');

cleanup();
assert.equal(observer.disconnected, true, 'disconnects the resize observer');
assert.equal(calls.dispose, 1, 'disposes native chart state on unmount');

console.log('Refinement MF chart resize + axis tests passed.');
