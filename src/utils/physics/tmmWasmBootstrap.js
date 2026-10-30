/**
 * Startup for the WASM TMM kernel on the main thread.
 *
 * Loads the kernel bytes over IPC and instantiates the module; the app
 * computes on nothing else. A kernel that cannot be loaded is written to the
 * diagnostic log and shown to the user in a notice that names the failure,
 * and every calculation then reports that the kernel is not loaded.
 */

import { initTmmWasmMainThread, tmmWasmActive } from '../../tmmcore.js';

/**
 * Loads the kernel. Resolves to null once it is active, and otherwise to what
 * went wrong: `{ error }` with the loader's message when the kernel file could
 * not be read, or `{ error: null }` when it was read but did not start.
 */
export async function bootstrapTmmWasm() {
    try {
        const r = await window.electronAPI.loadWasmKernel();
        const len = r?.bytes ? (r.bytes.byteLength ?? r.bytes.length ?? 0) : 0;
        let ok = false;
        if (r?.success && r.bytes) ok = await initTmmWasmMainThread(r.bytes, true);
        window.electronAPI?.diagLog?.(
            `WASM bootstrap: kernelBytes=${len} mainInstantiated=${ok} active=${tmmWasmActive()}`);
        if (ok) return null;
        return { error: r.success ? null : r.error };
    } catch (e) {
        window.electronAPI?.diagLog?.(`WASM bootstrap threw: ${e?.message || e}`);
        return { error: String(e?.message || e) };
    }
}

/**
 * The notice for a kernel that did not load, from what bootstrapTmmWasm
 * resolved to, in the language of `t`. It stays until the user closes it.
 */
export function kernelFailureNotice(failure, t) {
    const message = failure.error === null ? t.dialogs.kernelNotStarted : t.dialogs.kernelNotRead(failure.error);
    return { type: 'error', message, duration: 0 };
}
