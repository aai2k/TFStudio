/**
 * Stable synthesis control-bar geometry.
 *
 * Phase text and the Best readout update several times per generation. Their
 * slots must remain mounted at fixed widths so the Live update switch does not
 * jump horizontally while Needle / GE / Structural is running.
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const { SynthesisControlBar } = await import(
    '../src/components/windows/optimization/synthesisShared/synthesisShell.js');
const { ControlBar: NeedleControlBar } = await import(
    '../src/components/windows/optimization/needleVariation/needlePanels.js');
const { ControlBar: GeControlBar } = await import(
    '../src/components/windows/optimization/gradualEvolution/gePanels.js');
const { ControlBar: StructuralControlBar } = await import(
    '../src/components/windows/optimization/structuralOptimizer/structuralPanels.js');

const c = {
    panel: '#222', border: '#444', text: '#eee', textDim: '#999', success: '#4c4',
    accent: '#fa2', error: '#f44', bg: '#111',
};
const common = { run: 'Run', stop: 'Stop', reset: 'Reset', best: 'Best', clearHistory: 'Clear' };
const t = {
    liveUpdate: { label: 'Live update', hint: 'hint' },
    needle: {
        ...common, genLabel: 'Gen:', layersLabel: 'Layers:', mfLabel: 'MF:', bestLabel: 'Best:', noOperands: 'No operands',
    },
    gradualEvolution: {
        ...common, genLabel: 'Gen:', layersLabel: 'Layers:', geStepLabel: 'GE:', mfLabel: 'MF:', bestLabel: 'Best:', noOperands: 'No operands',
    },
    structural: {
        ...common, iterLabel: 'Iter:', reheatLabel: 'Reheat:', tempLabel: 'T:', acceptLabel: 'Accept:',
        layersLabel: 'Layers:', mfLabel: 'MF:', bestLabel: 'Best:', noOperands: 'No operands',
    },
};
const noop = () => {};
const shared = {
    running: true, canReset: true, onRun: noop, onStop: noop, onReset: noop, onBest: noop,
    onClearHistory: noop, hasHistory: true, design: { surfaceMode: 'front_only' }, c, t,
};

function statusSlot(statusMsg) {
    const bar = SynthesisControlBar({
        ...shared, labels: common, metrics: [], statusMsg, noOperandsLabel: 'No operands',
    });
    const readout = bar.props.children.find(child => child?.props?.['data-synthesis-readout']);
    assert.equal(readout.props.style.flex, '0 1 720px', 'right-side controls wrap as one stable unit');
    return readout.props.children.find(child => child?.props?.['data-synthesis-status']);
}

const emptyStatus = statusSlot('');
const longStatus = statusSlot('Refining 12 proposals (parallel)…');
assert.ok(emptyStatus && longStatus, 'status slot remains mounted while empty');
assert.equal(emptyStatus.props.style.width, 220);
assert.equal(longStatus.props.style.width, 220, 'phase text cannot resize its slot');
assert.equal(emptyStatus.props.style.visibility, 'hidden');
assert.equal(longStatus.props.style.visibility, 'visible');

function bestSlot(element) {
    return element.props.metrics.find(metric => metric?.props?.['data-synthesis-best']);
}

const panelCases = [
    ['Needle', NeedleControlBar({
        ...shared, phase: 'refining', generation: 2, layerCount: 8, mf: 0.018896, mfBest: 0.018896,
        statusMsg: 'Refining 12 proposals (parallel)…',
    }), NeedleControlBar({
        ...shared, phase: 'idle', generation: 0, layerCount: 1, mf: null, mfBest: null, statusMsg: '',
    })],
    ['GE', GeControlBar({
        ...shared, phase: 'refining', generation: 2, geSteps: 1, layerCount: 8, mf: 0.018896, mfBest: 0.018896,
        statusMsg: 'Refining 12 proposals (parallel)…',
    }), GeControlBar({
        ...shared, phase: 'idle', generation: 0, geSteps: 0, layerCount: 1, mf: null, mfBest: null, statusMsg: '',
    })],
    ['Structural', StructuralControlBar({
        ...shared, iter: 2, maxIter: 80, deepMode: false, reheats: 0, temp: 0.04,
        accRate: 0.5, layerCount: 8, mf: 0.018896, mfBest: 0.018896,
        statusMsg: 'Refining 12 proposals (parallel)…',
    }), StructuralControlBar({
        ...shared, running: false, iter: 0, maxIter: 80, deepMode: false, reheats: 0, temp: null,
        accRate: null, layerCount: 1, mf: null, mfBest: null, statusMsg: '',
    })],
];

for (const [name, active, idle] of panelCases) {
    const activeBest = bestSlot(active);
    const idleBest = bestSlot(idle);
    assert.ok(activeBest && idleBest, `${name}: Best slot remains mounted`);
    assert.equal(activeBest.props.style.width, idleBest.props.style.width, `${name}: Best slot width is stable`);
    assert.equal(activeBest.props.style.visibility, 'visible', `${name}: Best stays visible when current equals best`);
    assert.equal(idleBest.props.style.visibility, 'hidden', `${name}: empty slot is reserved before a best exists`);
}

console.log('Synthesis control-bar layout passed.');
