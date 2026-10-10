/**
 * Gradual Evolution after Stop: the status line no longer reads as running.
 *
 *   1. Run, then Stop: the phase text of the stopped run ("Starting design,
 *      bulk kept…", "Scanning needle positions…") is cleared. A stop that
 *      comes with a message, such as a worker error, still shows it.
 *   2. The control bar draws the status in the accent colour while a run is
 *      going and dimmed when it is not, as Needle does.
 *
 * The hook runs under the effect-running stand-in for React in
 * _effectRuntime.mjs. The Run goes to a worker pool whose workers never answer,
 * so it stays in its first phase until Stop.
 *
 * Run: node tests/ge_stop_status.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 1 }, configurable: true, writable: true });

const R = makeEffectRuntime(globalThis.React);
globalThis.React = R;

const { useGradualEvolution } = await import(
    '../src/components/windows/optimization/gradualEvolution/useGradualEvolution.js');
const { ControlBar } = await import('../src/components/windows/optimization/gradualEvolution/gePanels.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { default: EN } = await import('../src/constants/locales/en.js');

const noop = () => {};
const design = {
    id: 'ge-stop', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: [
        { id: 'a', material: 'TiO2', thickness: 30, locked: false },
        { id: 'b', material: 'SiO2', thickness: 50, locked: false },
    ],
    meritOperands: [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 })],
};
const props = {
    design, updateDesign: noop, checkpoint: noop, beginOptimization: noop, endOptimization: noop,
    getDesignRevision: () => 0, t: EN,
};
const mount = () => R.run(() => useGradualEvolution(props));

// ── 1. Stop clears the phase text of the run it stops ────────────────────────
{
    const ge = mount();
    ge.runOpt();
    const running = mount();
    assert.notEqual(running.phase, 'idle', 'setup: the run started');
    assert.ok(running.statusMsg, 'setup: the running phase shows its text');

    running.stopOpt('');
    const stopped = mount();
    assert.equal(stopped.phase, 'idle');
    assert.equal(stopped.statusMsg, '', 'after Stop the status no longer reads as running');

    stopped.stopOpt('Worker failed');
    assert.equal(mount().statusMsg, 'Worker failed', 'a stop with a message shows it');
}

// ── 2. Status colour follows whether a run is going ──────────────────────────
{
    const c = { text: '#eee', textDim: '#999', success: '#4c4', accent: '#fa2', border: '#444', panel: '#222', bg: '#111' };
    const bar = running => ControlBar({
        running, generation: 3, layerCount: 6, mf: 0.01, mfBest: 0.01, geSteps: 1, canReset: true,
        onRun: noop, onStop: noop, onReset: noop, onResetSide: noop, onBest: noop, onClearHistory: noop,
        hasHistory: true, statusMsg: EN.gradualEvolution.status.maxGeCycles(16), design, t: EN, c,
    });
    assert.equal(bar(true).props.statusColor, c.accent, 'a running phase is drawn in the accent colour');
    assert.equal(bar(false).props.statusColor, c.textDim, 'an idle status is dimmed');
}

console.log('GE stop status tests passed.');
