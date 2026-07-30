import assert from 'node:assert/strict';

const effects = [];
globalThis.React = {
    createElement: (type, props) => ({ type, props }),
    useRef: initial => ({ current: initial }),
    useEffect: effect => effects.push(effect),
};

const listeners = new Map();
globalThis.window = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => {
        if (listeners.get(name) === fn) listeners.delete(name);
    },
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

const calls = { newPlot: [], react: [], resize: [], purge: [] };
globalThis.Plotly = {
    newPlot: (...args) => calls.newPlot.push(args),
    react: (...args) => calls.react.push(args),
    Plots: { resize: plot => calls.resize.push(plot) },
    purge: plot => calls.purge.push(plot),
};

const { MFTrendPlot } = await import('../src/components/windows/optimization/refinement/MFTrendPlot.js');
const tree = MFTrendPlot({
    history: [{ iter: 0, mf: 1e-2 }, { iter: 13, mf: 1e-6 }],
    c: { bg: '#111', panel: '#222', border: '#333', text: '#eee' },
    theme: 'dark',
});
const plot = { isConnected: true };
tree.props.ref.current = plot;

effects[0]();
const cleanup = effects[1]();
flushFrames();

assert.equal(calls.newPlot.length, 1, 'creates the Plotly chart');
const layout = calls.newPlot[0][2];
assert.equal(layout.autosize, true, 'uses Plotly autosizing');
assert.equal(layout.yaxis.automargin, true, 'reserves room for y-axis labels');
assert.equal(layout.yaxis.tickformat, '.0e', 'uses compact scientific MF ticks');
assert.equal(observer.target, plot, 'observes docked-panel size changes');
assert.deepEqual(calls.resize, [plot], 'sizes the plot after mounting');

observer.callback();
flushFrames();
assert.deepEqual(calls.resize, [plot, plot], 'resizes after the element changes size');

cleanup();
assert.equal(observer.disconnected, true, 'disconnects the resize observer');
assert.equal(listeners.has('resize'), false, 'removes the window resize fallback');
assert.deepEqual(calls.purge, [plot], 'purges Plotly state on unmount');

console.log('Refinement MF plot resize + axis layout tests passed.');
