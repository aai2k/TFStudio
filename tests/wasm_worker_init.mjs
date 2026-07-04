/**
 * Worker WASM-init flow test (uses the REAL built kernel).
 *
 * Simulates what a pool/worker does when it receives the broadcast bytes:
 *   noteTmmWasmBytes(bytes)  →  await awaitTmmWasmReady()  →  run optimizer.
 * Then verifies DLSOptimizer.mfAt with WASM enabled matches the JS path, and
 * that the main-thread byte-gating (getTmmWasmBytesForWorker) tracks the flag.
 *
 * Requires src/wasm/tmm_kernel.wasm (npm run build:wasm); SKIPS cleanly if absent.
 * Run: node tests/wasm_worker_init.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import {
    noteTmmWasmBytes, awaitTmmWasmReady, tmmWasmActive,
    getTmmWasmBytesForWorker, initTmmWasmMainThread,
} from '../src/utils/workers/tmmWasm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(__dirname, '..', 'src', 'wasm', 'tmm_kernel.wasm');
if (!existsSync(wasmPath)) {
    console.log('SKIP wasm_worker_init: src/wasm/tmm_kernel.wasm not built (npm run build:wasm).');
    process.exit(0);
}

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

// ── A) JS baseline (flag still off at module load) ───────────────────────────
ok(!tmmWasmActive(), 'starts inactive');
const x = new DLSOptimizer(ops, des, resolveMat).thicknesses.slice();
const mfJs = new DLSOptimizer(ops, des, resolveMat).mfAt(x);

// ── B) Worker receives the wasmInit broadcast ────────────────────────────────
noteTmmWasmBytes(readFileSync(wasmPath));      // what onmessage({type:'wasmInit'}) does
await awaitTmmWasmReady();                      // what the job handler awaits
ok(tmmWasmActive(), 'worker enabled WASM after init');
const mfW = new DLSOptimizer(ops, des, resolveMat).mfAt(x);
const d = Math.abs(mfJs - mfW);
ok(d < 1e-9, `worker mfAt WASM=${mfW} vs JS=${mfJs} Δ=${d.toExponential(3)} (tol 1e-9)`);
console.log(`worker-init: WASM active, mfAt Δ = ${d.toExponential(3)}`);

// ── C) Main-thread byte gating tracks the flag ───────────────────────────────
// The main thread is the one that broadcasts bytes to workers; it sets the byte
// store via initTmmWasmMainThread (the worker-side noteTmmWasmBytes deliberately
// does not, since workers never re-broadcast). Seed it, then toggle.
await initTmmWasmMainThread(readFileSync(wasmPath), true);
ok(tmmWasmActive(), 'main-thread bootstrap active');
ok(getTmmWasmBytesForWorker() != null, 'bytes available for worker broadcast when active');
await initTmmWasmMainThread(null, false);       // toggle OFF
ok(!tmmWasmActive(), 'toggle off → inactive');
ok(getTmmWasmBytesForWorker() === null, 'no bytes broadcast when disabled');
await initTmmWasmMainThread(null, true);         // toggle back ON (reuses instance + stored bytes)
ok(tmmWasmActive(), 'toggle on → active again (instance reused)');
ok(getTmmWasmBytesForWorker() != null, 'bytes broadcast when re-enabled');

if (fails === 0) {
    console.log('\nPASS — worker WASM init + main-thread gating behave correctly with the real kernel.');
    process.exit(0);
} else {
    console.error(`\n${fails} assertion(s) FAILED.`);
    process.exit(1);
}
