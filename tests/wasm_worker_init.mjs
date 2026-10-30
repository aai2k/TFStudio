/**
 * Worker WASM-init flow test (uses the REAL built kernel).
 *
 * Simulates what a pool/worker does when it receives the broadcast bytes:
 *   noteTmmWasmBytes(bytes)  →  await awaitTmmWasmReady()  →  run optimizer.
 * A calculation before the bytes arrive is an error; after, DLSOptimizer.mfAt
 * runs on the kernel and matches tmmcore's JavaScript reference. The main
 * thread, which loads the kernel at startup, keeps the bytes to hand on.
 *
 * Uses the prebuilt kernel shipped by tmmcore.
 * Run: node tests/wasm_worker_init.mjs
 */

import { readFileSync } from 'node:fs';

import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import {
    noteTmmWasmBytes, awaitTmmWasmReady, tmmWasmActive,
    getTmmWasmBytesForWorker, initTmmWasmMainThread,
} from 'tmmcore';
import { TMMCORE_WASM_PATH, onJsReference } from './_wasmInit.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const resolveMat = id => getMaterial(id);

const ops = [
    makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'TAV', lambdaStart: 500, lambdaEnd: 600, aoi: 25, pol: 's', target: 1, weight: 1 }),
];
const des = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'F1', material: 'TiO2', thickness: 88, locked: false },
        { id: 'F2', material: 'SiO2', thickness: 140, locked: false },
        { id: 'F3', material: 'TiO2', thickness: 60, locked: false },
        { id: 'F4', material: 'SiO2', thickness: 110, locked: false },
    ],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
};

// ── A) Before the bytes arrive nothing can be calculated ─────────────────────
ok(!tmmWasmActive(), 'starts inactive');
let early = null;
try { new DLSOptimizer(ops, des, resolveMat).mfAt(des.frontLayers.map(l => l.thickness)); } catch (e) { early = e; }
ok(/WASM TMM kernel is not loaded/.test(early?.message), `a calculation before the bytes arrive throws (${early?.message})`);

// ── B) Worker receives the wasmInit broadcast ────────────────────────────────
noteTmmWasmBytes(readFileSync(TMMCORE_WASM_PATH)); // what onmessage({type:'wasmInit'}) does
await awaitTmmWasmReady();                      // what the job handler awaits
ok(tmmWasmActive(), 'worker enabled WASM after init');
const x = new DLSOptimizer(ops, des, resolveMat).thicknesses.slice();
const mfJs = onJsReference(() => new DLSOptimizer(ops, des, resolveMat).mfAt(x));
const mfW = new DLSOptimizer(ops, des, resolveMat).mfAt(x);
const d = Math.abs(mfJs - mfW);
ok(d < 1e-9, `worker mfAt WASM=${mfW} vs JS=${mfJs} Δ=${d.toExponential(3)} (tol 1e-9)`);
console.log(`worker-init: WASM active, mfAt Δ = ${d.toExponential(3)}`);

// ── C) The main thread keeps the bytes for its workers ───────────────────────
// The main thread is the one that broadcasts bytes to workers; it sets the byte
// store via initTmmWasmMainThread (the worker-side noteTmmWasmBytes deliberately
// does not, since workers never re-broadcast).
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);
ok(tmmWasmActive(), 'main-thread bootstrap active');
ok(getTmmWasmBytesForWorker() != null, 'bytes available for worker broadcast');

if (fails === 0) {
    console.log('\nPASS: worker WASM init and the main-thread byte store behave correctly with the real kernel.');
} else {
    console.error(`\n${fails} assertion(s) FAILED.`);
}
// Set the exit code and let the event loop drain instead of calling process.exit():
// the WASM path leaves no open handles (WebAssembly.instantiate promises have
// resolved; no timers/workers), and force-exiting here while the final line is
// still in flight to the runner's piped stdout intermittently aborts Node during
// libuv teardown on Windows — "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
// (async.c) — yielding a spurious non-zero exit after the assertions have passed.
process.exitCode = fails === 0 ? 0 : 1;
