/**
 * Each status-bar value stays with the monitor it was worked out for.
 *
 * The values come back from the analysis worker as a list in the order of the
 * monitors sent. Until the next answer, a monitor removed, moved or edited
 * must not show the value of the monitor that used to sit in its place: the
 * survivors keep their own values, and a new or edited monitor reads nothing
 * until its own arrives.
 *
 * Run: node tests/status_monitor_readings.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
const runtime = makeEffectRuntime();
globalThis.React = runtime;
const made = [];
globalThis.Worker = class {
    constructor() { this.sent = []; made.push(this); }
    postMessage(message) { this.sent.push(message); }
    terminate() { this.terminated = true; }
};

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { DesignContext } = await import('../src/state/DesignContext.js');
const { useMonitorReadings } = await import('../src/components/SpectralMonitor.js');
const { coupled } = await import('./_peakDesigns.mjs');

DesignContext.value = { design: coupled, evalMode: 'front', hasActiveDesign: true, isOptimizing: false, liveUpdate: true };
const average = { id: 'avg', type: 'avg', qty: 'T', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg' };
const width = { id: 'fwhm', type: 'fwhm', qty: 'T', lambdaStart: 540, lambdaEnd: 580, aoi: 0, pol: 'avg' };
// The list is the component's state, so one list keeps its identity from one
// render to the next and each change makes a new one.
const read = monitors => {
    const { valueOf } = runtime.run(() => useMonitorReadings(monitors));
    return monitors.map(valueOf);
};
// The worker answers the job it was last sent.
const answer = data => made.at(-1).onmessage({ data: { type: 'result', data } });

const both = [average, width];
assert.deepEqual(read(both), [null, null], 'nothing is shown before the worker answers');
answer([95.2, 0.37]);
assert.deepEqual(read(both), [95.2, 0.37], 'each monitor shows its own value');

assert.deepEqual(read([width]), [0.37], 'with the first one removed, the second keeps its own value');
assert.deepEqual(read([width, average]), [0.37, 95.2], 'moved, each keeps its own value');
const reflectance = { ...average, qty: 'R' };
const edited = [width, reflectance];
assert.deepEqual(read(edited), [0.37, null], 'an edited monitor reads nothing until its value arrives');
answer([0.37, 4.8]);
assert.deepEqual(read(edited), [0.37, 4.8], 'and then its own value');
runtime.unmount();

console.log('PASS: status_monitor_readings');
