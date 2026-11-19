/**
 * Wavelength vs Angle map: the "Computing" state follows the sweep that is
 * current. A sweep sent to the worker pool sets it; a later change that brings
 * the sweep within the main-thread budget supersedes that pool, so the new map
 * is drawn on the main thread and the state has to be cleared there, because
 * the superseded sweep no longer is the current one and leaves it alone.
 *
 * Run: node tests/wavelength_angle_map_computing.mjs
 */
import assert from 'node:assert/strict';
import { initWasmForTest } from './_wasmInit.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';
import { buildMapSpec } from '../src/components/windows/analysis/wavelengthAngleMap/mapSpec.js';

shimBrowserGlobals();
await loadApp();
await initWasmForTest();

// A pool whose workers never answer: the sweep stays in flight.
globalThis.Worker = class { postMessage() {} terminate() {} };

const runtime = makeHookRuntime();
const { useMapSweep } = await importWithHookRuntime(
    '../src/components/windows/analysis/wavelengthAngleMap/useWavelengthAngleMap.js?computing', runtime);

const layers = n => Array.from({ length: n }, (_, i) => ({ material: i % 2 ? 'SiO2' : 'TiO2', thickness: 60 + i }));
const makeDesign = n => ({
    id: 'angle-map-computing', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 }, surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: layers(n), backLayers: [], meritOperands: [],
});
const controls = {
    lambdaStart: 400, lambdaEnd: 800, lambdaStep: 0.5,
    angleStart: 0, angleEnd: 60, angleStep: 1, channel: 'T', pol: 'avg',
};
const spec = buildMapSpec(controls, 'front');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = () => wait(400);

const big = makeDesign(12);
const small = makeDesign(1);
const log = console.error; console.error = () => {};

let state = runtime.render(() => useMapSweep(spec, big));
for (const effect of runtime.pendingEffects()) effect();
await settle();
state = runtime.render(() => useMapSweep(spec, big));
assert.equal(state.computing, true, 'a sweep past the main-thread budget is computing in the pool');

state = runtime.render(() => useMapSweep(spec, small));
for (const effect of runtime.pendingEffects()) effect();
await settle();
state = runtime.render(() => useMapSweep(spec, small));
assert.ok(state.result?.ok, 'the small sweep is drawn');
assert.equal(state.computing, false, 'and the superseded pool sweep no longer holds the window computing');

console.error = log;
for (const effect of runtime.pendingEffects()) effect();
console.log('PASS wavelength_angle_map_computing');
process.exit(0);
