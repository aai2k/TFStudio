/**
 * Test helper: load the WASM TMM kernel in a Node test as the app does at
 * startup. TFStudio computes on the kernel alone; the bytes are kept for the
 * workers a test starts, as the app keeps them. Returns true once the kernel
 * is active.
 *
 *   import { initWasmForTest } from './_wasmInit.mjs';
 *   await initWasmForTest();   // before the first calculation
 *
 * A test that needs nothing more than the kernel loaded imports
 * './_kernel.mjs' instead.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as tmmcore from 'tmmcore';

const { initTmmWasmMainThread, tmmWasmActive, getTmmWasm } = tmmcore;

export const TMMCORE_WASM_PATH = createRequire(import.meta.url).resolve('tmmcore/tmm_kernel.wasm');

export async function initWasmForTest(wasmPath = TMMCORE_WASM_PATH) {
  try {
    return await initTmmWasmMainThread(readFileSync(wasmPath), true);
  } catch (e) {
    console.warn(`[wasm] not loaded (${e.message})`);
    return false;
  }
}

// The calls a loaded kernel and tmmcore's JavaScript index both carry, under
// the same names and with the same stack and options.
const STACK_CALLS = ['rta', 'rtaSpectrum', 'jacobian', 'jacobianSpectrum', 'hessian',
  'hessianSpectrum', 'needleScan', 'phase', 'phaseSpectrum', 'phaseJacobian', 'phaseJacobianSpectrum'];

/**
 * Runs `fn` with the loaded kernel's calls answered by tmmcore's JavaScript
 * reference wherever it has one, and returns what `fn` returns. TFStudio's own
 * code runs unchanged, so comparing against a plain run holds the kernel to
 * the reference on exactly the stacks TFStudio builds. The growing-stack calls
 * have no JavaScript twin on tmmcore's index and stay on the kernel. `fn` is
 * synchronous.
 */
export function onJsReference(fn) {
  const kernel = getTmmWasm();
  const swaps = STACK_CALLS.map(name => [name, tmmcore[name]]);
  const own = swaps.map(([name]) => [name, Object.getOwnPropertyDescriptor(kernel, name)]);
  for (const [name, call] of swaps) kernel[name] = call;
  try {
    return fn();
  } finally {
    for (const [name, descriptor] of own) {
      if (descriptor) Object.defineProperty(kernel, name, descriptor);
      else delete kernel[name];
    }
  }
}

export { getTmmWasm, tmmWasmActive };
