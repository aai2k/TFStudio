/**
 * The window mounts the app once the WASM kernel is in (renderer.js), so the
 * first calculation of a design shown at startup runs on the kernel; a kernel
 * that never arrives holds the window only until the wait runs out, and the
 * app then mounts on the JavaScript path.
 *
 * renderer.js mounts into the page when it is imported, so each case imports
 * it under its own query, with ReactDOM's root standing in to record the mount.
 *
 * Run: node tests/renderer_kernel_first.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
const { tmmWasmActive } = await import('../src/tmmcore.js');
const kernelBytes = readFileSync(createRequire(import.meta.url).resolve('tmmcore/tmm_kernel.wasm'));

const mounts = [];
globalThis.ReactDOM = { createRoot: () => ({ render: () => mounts.push({ at: Date.now(), kernel: tmmWasmActive() }) }) };
document.getElementById = () => ({});

// Each request for the kernel, answered only when a case says so.
const kernelRequests = [];
window.electronAPI = new Proxy({
    loadSettings: async () => ({ success: true, settings: {} }),
    loadWasmKernel: () => new Promise(resolve => { kernelRequests.push(() => resolve({ success: true, bytes: kernelBytes })); }),
    diagLog: () => {},
}, { get: (api, name) => api[name] ?? (() => Promise.resolve(null)) });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function mountedBy(deadline) {
    while (!mounts.length && Date.now() < deadline) await sleep(20);
    return mounts.shift();
}

// ── A kernel that never answers holds the window until the wait runs out ─────
{
    const started = Date.now();
    const imported = import('../src/renderer.js?no-kernel');
    await sleep(1000);
    assert.equal(mounts.length, 0, 'the app is not mounted while the kernel is awaited');
    await imported;
    const mount = await mountedBy(started + 10000);
    assert.ok(mount, 'the app mounts once the wait runs out');
    assert.ok(mount.at - started >= 1900, `it waited ${mount.at - started} ms, the wait is 2000 ms`);
    assert.equal(mount.kernel, false, 'and runs on the JavaScript path');
}

// ── A kernel that answers is in before the app mounts ────────────────────────
{
    const started = Date.now();
    const imported = import('../src/renderer.js?kernel');
    while (kernelRequests.length < 2 && Date.now() < started + 10000) await sleep(20);
    assert.equal(kernelRequests.length, 2, 'the window asks for the kernel');
    await sleep(300);
    assert.equal(mounts.length, 0, 'the app waits for the kernel');
    kernelRequests[1]();
    await imported;
    const mount = await mountedBy(started + 10000);
    assert.ok(mount, 'the app mounts once the kernel is in');
    assert.equal(mount.kernel, true, 'with the kernel active, so its first calculation runs on it');
    assert.ok(mount.at - started < 1900, 'well before the wait would have run out');
}

console.log('PASS: renderer_kernel_first');
