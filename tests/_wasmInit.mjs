/**
 * Test helper: activate the WASM TMM kernel in a Node test so the optimizer's
 * hot paths (tmmOne / tmmJacobian / tmmNeedleScan) run on WASM — identical math
 * to the GUI (Δ≈1e-15), just faster. Returns true if WASM is active.
 *
 *   import { initWasmForTest } from './_wasmInit.mjs';
 *   await initWasmForTest();   // call BEFORE creating any DLSOptimizer/engine
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { instantiateTmmWasm, setTmmWasmEnabled, tmmWasmActive, getTmmWasm } from 'tmmcore';

export const TMMCORE_WASM_PATH = createRequire(import.meta.url).resolve('tmmcore/tmm_kernel.wasm');

export async function initWasmForTest(wasmPath = TMMCORE_WASM_PATH) {
  try {
    const bytes = readFileSync(wasmPath);
    await instantiateTmmWasm(bytes);
    setTmmWasmEnabled(true);
    return tmmWasmActive();
  } catch (e) {
    console.warn(`[wasm] not active (${e.message}) — falling back to JS`);
    return false;
  }
}

export { getTmmWasm, tmmWasmActive };
