/**
 * Standalone-kernel integration guard.
 *
 * TFStudio must consume one tmmcore package instance from the renderer and all
 * worker entry points. The package owns the reference kernels, loader state,
 * C source, and prebuilt WASM binary.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as core from 'tmmcore';
import * as loader from 'tmmcore/tmmWasm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// Root and explicit loader subpath must share one module-level singleton.
assert.strictEqual(core.getTmmWasm, loader.getTmmWasm);
assert.strictEqual(core.setTmmWasmEnabled, loader.setTmmWasmEnabled);

const entries = [
    'src/renderer.js',
    'src/utils/workers/optimizerWorker.js',
    'src/utils/workers/mfEvalWorker.js',
    'src/utils/workers/synthesisWorker.js',
    'src/utils/workers/bbmRunWorker.js',
    'src/utils/workers/filterDesignWorker.js',
    'src/utils/workers/plotSurfaceWorker.js',
    'src/utils/workers/benchmarkWorker.js',
    'src/utils/workers/analysisEvaluationWorker.js',
    'src/utils/workers/edgeFilterWorker.js',
];
const resolutions = entries.map((entry) => {
    const fromEntry = createRequire(pathToFileURL(path.join(root, entry)));
    return fs.realpathSync(fromEntry.resolve('tmmcore'));
});
assert.equal(new Set(resolutions).size, 1, 'all renderer/worker entries resolve one tmmcore instance');

const packageRoot = path.dirname(fs.realpathSync(require.resolve('tmmcore/package.json')));
const wasmPath = fs.realpathSync(require.resolve('tmmcore/tmm_kernel.wasm'));
assert.equal(path.relative(packageRoot, wasmPath).startsWith('..'), false, 'WASM must come from tmmcore');

const wasmBytes = fs.readFileSync(wasmPath);
assert.equal(await core.initTmmWasmMainThread(wasmBytes, true), true);
assert.equal(loader.tmmWasmActive(), true, 'subpath observes root loader state');

const stack = {
    incident: 1, substrate: 1.52,
    layers: [{ n: 2.35, k: 0.0005, d: 73 }, { n: 1.46, d: 121 }],
};
const js = core.rta(stack, 550, { angle: 27, pol: 'p' });
const wasm = core.getTmmWasm().rta(stack, 550, { angle: 27, pol: 'p' });
for (const key of ['R', 'T', 'A']) {
    assert.ok(Math.abs(js[key] - wasm[key]) < 1e-12, `${key}: JS/WASM mismatch`);
}

// Exercise the actual CommonJS IPC adapter: it must resolve and return the same
// package-owned artifact that the ESM build/test paths use.
const wasmIpc = require('../src/main/ipc/wasm.js');
let loadKernel;
wasmIpc.register({ handle: (_channel, handler) => { loadKernel = handler; } }, {
    fs, path, log: () => {}, isPackaged: false,
});
const loaded = await loadKernel();
assert.equal(loaded.success, true);
assert.equal(Buffer.compare(Buffer.from(loaded.bytes), wasmBytes), 0);

wasmIpc.register({ handle: (_channel, handler) => { loadKernel = handler; } }, {
    fs, path, log: () => {}, isPackaged: true, resourcesDir: path.dirname(wasmPath),
});
const packaged = await loadKernel();
assert.equal(packaged.success, true);
assert.equal(Buffer.compare(Buffer.from(packaged.bytes), wasmBytes), 0);

core.setTmmWasmEnabled(false);
console.log(`PASS tmmcore integration (${entries.length} renderer/worker entries, ${wasmBytes.length} WASM bytes)`);
