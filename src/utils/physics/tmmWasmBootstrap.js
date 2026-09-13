/**
 * Startup for the WASM TMM kernel on the main thread.
 *
 * Loads the kernel bytes over IPC and, per the persisted setting, instantiates
 * the module and enables the flag. The setting is read here rather than taken
 * from React state so the runtime decision cannot race a state update. A missing
 * artifact or a disabled setting silently leaves every evaluation on the JS path.
 */

import { initTmmWasmMainThread, tmmWasmActive } from '../../tmmcore.js';

export async function bootstrapTmmWasm() {
    let enabled = true;   // default ON; only an explicit `false` disables
    try {
        const s = await window.electronAPI?.loadSettings?.();
        if (s?.success && s.settings && s.settings.wasmTmm === false) enabled = false;
    } catch (_) { /* default on */ }
    try {
        const r = await window.electronAPI?.loadWasmKernel?.();
        const len = r?.bytes ? (r.bytes.byteLength ?? r.bytes.length ?? 0) : 0;
        let ok = false;
        if (r?.success && r.bytes) ok = await initTmmWasmMainThread(r.bytes, enabled);
        window.electronAPI?.diagLog?.(
            `WASM bootstrap: enabledPref=${enabled} kernelBytes=${len} mainInstantiated=${ok} active=${tmmWasmActive()}`);
    } catch (e) {
        window.electronAPI?.diagLog?.(`WASM bootstrap threw: ${e?.message || e}`);
    }
}
