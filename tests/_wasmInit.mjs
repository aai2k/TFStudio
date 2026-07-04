/**
 * Test helper: activate the WASM TMM kernel in a Node test so the optimizer's
 * hot paths (tmmOne / tmmJacobian / tmmNeedleScan) run on WASM — identical math
 * to the GUI (Δ≈1e-15), just faster. Returns true if WASM is active.
 *
 *   import { initWasmForTest } from './_wasmInit.mjs';
 *   await initWasmForTest();   // call BEFORE creating any DLSOptimizer/engine
 */
import { readFileSync } from 'fs';
import { instantiateTmmWasm, setTmmWasmEnabled, tmmWasmActive, getTmmWasm } from '../src/utils/workers/tmmWasm.js';

export async function initWasmForTest(wasmPath = 'src/wasm/tmm_kernel.wasm') {
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
