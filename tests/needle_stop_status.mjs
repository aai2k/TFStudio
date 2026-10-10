/**
 * Needle Automatic after Stop: the status line no longer reads as running.
 *
 *   1. Run, then Stop: the phase text of the stopped run is cleared. A stop
 *      that comes with a message, such as a worker error, still shows it.
 *   2. Best after a finished run keeps the reason the run ended with.
 *
 * The hook runs under the effect-running stand-in for React in
 * _effectRuntime.mjs. The Run goes to a worker pool whose workers never answer,
 * so it stays in its first phase until Stop.
 *
 * Run: node tests/needle_stop_status.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 1 }, configurable: true, writable: true });

const R = makeEffectRuntime(globalThis.React);
globalThis.React = R;

const { DesignContext } = await import('../src/state/DesignContext.js');
const { useNeedleVariation } = await import(
    '../src/components/windows/optimization/needleVariation/useNeedleVariation.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { default: EN } = await import('../src/constants/locales/en.js');

const noop = () => {};
const design = {
    id: 'needle-stop', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: [
        { id: 'a', material: 'TiO2', thickness: 30, locked: false },
        { id: 'b', material: 'SiO2', thickness: 50, locked: false },
    ],
    meritOperands: [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 })],
};
DesignContext.value = {
    design, updateDesign: noop, checkpoint: noop, beginOptimization: noop, endOptimization: noop,
    getDesignRevision: () => 0,
};

const mount = () => R.run(() => useNeedleVariation(EN));

// ── 1. Stop clears the phase text of the run it stops ────────────────────────
{
    mount().runOpt();
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

// ── 2. A finished run's reason survives Best ─────────────────────────────────
{
    mount().stopOpt('Target reached');
    mount().stopOpt('');
    assert.equal(mount().statusMsg, 'Target reached', 'Best or Restore after a run keeps its reason');
}

console.log('Needle stop status tests passed.');
