/**
 * Test helper: loads the WASM TMM kernel when imported, before the test body
 * runs. TFStudio computes on the kernel alone, so a test that calculates
 * imports this first:
 *
 *   import './_kernel.mjs';
 */
import { initWasmForTest } from './_wasmInit.mjs';

if (!(await initWasmForTest())) throw new Error('the WASM kernel did not load');
