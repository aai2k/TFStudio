/**
 * Startup for the WASM TMM kernel on the main thread.
 *
 * Loads the kernel bytes over IPC and instantiates the module; the app
 * computes on nothing else. A kernel that cannot be loaded is written to the
 * diagnostic log, and every calculation then reports that the kernel is not
 * loaded.
 */

import { initTmmWasmMainThread, tmmWasmActive } from '../../tmmcore.js';

export async function bootstrapTmmWasm() {
    try {
        const r = await window.electronAPI?.loadWasmKernel?.();
        const len = r?.bytes ? (r.bytes.byteLength ?? r.bytes.length ?? 0) : 0;
        let ok = false;
        if (r?.success && r.bytes) ok = await initTmmWasmMainThread(r.bytes, true);
        window.electronAPI?.diagLog?.(
            `WASM bootstrap: kernelBytes=${len} mainInstantiated=${ok} active=${tmmWasmActive()}`);
    } catch (e) {
        window.electronAPI?.diagLog?.(`WASM bootstrap threw: ${e?.message || e}`);
    }
}
