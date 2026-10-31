/**
 * The window mounts the app once the WASM kernel is in (renderer.js), so the
 * first calculation of a design shown at startup runs on the kernel; a kernel
 * that never arrives holds the window only until the wait runs out, and the
 * app then mounts without it, still handed the load, so a failure after the
 * wait reaches it too. A kernel that cannot be loaded, or a loader that fails
 * outright, does not hold the window, and the app is handed what went wrong,
 * which its notice names in each language.
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
const { kernelFailureNotice } = await import('../src/utils/physics/tmmWasmBootstrap.js');
const { getLocale } = await import('../src/constants/locales/index.js');
const kernelBytes = readFileSync(createRequire(import.meta.url).resolve('tmmcore/tmm_kernel.wasm'));

// Each mount, with the kernel's load the app is handed.
const mounts = [];
globalThis.ReactDOM = { createRoot: () => ({
    render: shell => mounts.push({ at: Date.now(), kernel: tmmWasmActive(), kernelStartup: shell.props.children.props.kernelStartup }),
}) };
document.getElementById = () => ({});

// Each request for the kernel, answered only when a case says so: with the
// loader's result, or with an Error the loader throws.
const kernelRequests = [];
window.electronAPI = new Proxy({
    loadSettings: async () => ({ success: true, settings: {} }),
    loadWasmKernel: () => new Promise((resolve, reject) => {
        kernelRequests.push(answer => (answer instanceof Error ? reject(answer) : resolve(answer)));
    }),
    diagLog: () => {},
}, { get: (api, name) => api[name] ?? (() => Promise.resolve(null)) });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function mountedBy(deadline) {
    while (!mounts.length && Date.now() < deadline) await sleep(20);
    return mounts.shift();
}
// Imports the window under `query` and answers its request for the kernel with
// `answer`; resolves to the mount and the time the import started.
async function startWith(query, answer) {
    const started = Date.now();
    const asked = kernelRequests.length;
    const imported = import(`../src/renderer.js?${query}`);
    while (kernelRequests.length === asked && Date.now() < started + 10000) await sleep(20);
    assert.equal(kernelRequests.length, asked + 1, 'the window asks for the kernel');
    kernelRequests[asked](answer);
    await imported;
    return { started, mount: await mountedBy(started + 10000) };
}
const LANGUAGES = ['en', 'ru', 'zh', 'it'];

// ── A kernel that never answers holds the window until the wait runs out ─────
// ── and a load that fails after it still reaches the app ─────────────────────
{
    const started = Date.now();
    const asked = kernelRequests.length;
    const imported = import('../src/renderer.js?no-kernel');
    await sleep(1000);
    assert.equal(mounts.length, 0, 'the app is not mounted while the kernel is awaited');
    await imported;
    const mount = await mountedBy(started + 10000);
    assert.ok(mount, 'the app mounts once the wait runs out');
    assert.ok(mount.at - started >= 1900, `it waited ${mount.at - started} ms, the wait is 2000 ms`);
    assert.equal(mount.kernel, false, 'and mounts without the kernel');
    const error = "EACCES: permission denied, open 'tmm_kernel.wasm'";
    kernelRequests[asked]({ success: false, error });
    assert.deepEqual(await mount.kernelStartup, { error }, 'a load that fails after the wait still reaches the app');
}

// ── A loader that fails outright: the app is handed its message ──────────────
{
    const error = "Error invoking remote method 'wasm:load-kernel': Error: No handler registered for 'wasm:load-kernel'";
    const { started, mount } = await startWith('loader-fails', new Error(error));
    assert.ok(mount && mount.at - started < 1900, 'the app mounts without waiting out the wait');
    assert.equal(mount.kernel, false, 'and without the kernel');
    assert.deepEqual(await mount.kernelStartup, { error }, "the app is handed the loader's message");
}

// ── A kernel file that cannot be read: the app is told why, in each language ─
{
    const error = "ENOENT: no such file or directory, open 'tmm_kernel.wasm'";
    const { started, mount } = await startWith('unreadable', { success: false, error });
    assert.ok(mount && mount.at - started < 1900, 'the app mounts without waiting out the wait');
    assert.equal(mount.kernel, false, 'and without the kernel');
    const failure = await mount.kernelStartup;
    assert.deepEqual(failure, { error }, "the app is handed the loader's message");
    const messages = LANGUAGES.map(code => {
        const notice = kernelFailureNotice(failure, getLocale(code));
        assert.equal(notice.type, 'error', `${code}: the notice is an error`);
        assert.equal(notice.duration, 0, `${code}: it stays until it is closed`);
        assert.ok(notice.message.includes(error), `${code}: it names the failure: ${notice.message}`);
        return notice.message;
    });
    assert.equal(new Set(messages).size, LANGUAGES.length, 'each language has its own wording');
}

// ── A kernel file that is read but does not start ────────────────────────────
{
    const { started, mount } = await startWith('not-a-kernel', { success: true, bytes: new Uint8Array([0, 1, 2, 3]) });
    assert.ok(mount && mount.at - started < 1900, 'the app mounts without waiting out the wait');
    assert.equal(mount.kernel, false, 'and without the kernel');
    const failure = await mount.kernelStartup;
    assert.deepEqual(failure, { error: null }, 'the app is told the file was read but did not start');
    const messages = LANGUAGES.map(code => {
        const notice = kernelFailureNotice(failure, getLocale(code));
        assert.equal(notice.message, getLocale(code).dialogs.kernelNotStarted, `${code}: the notice says it did not start`);
        return notice.message;
    });
    assert.equal(new Set(messages).size, LANGUAGES.length, 'each language has its own wording');
}

// ── A kernel that answers is in before the app mounts ────────────────────────
{
    const started = Date.now();
    const asked = kernelRequests.length;
    const imported = import('../src/renderer.js?kernel');
    while (kernelRequests.length === asked && Date.now() < started + 10000) await sleep(20);
    assert.equal(kernelRequests.length, asked + 1, 'the window asks for the kernel');
    await sleep(300);
    assert.equal(mounts.length, 0, 'the app waits for the kernel');
    kernelRequests[asked]({ success: true, bytes: kernelBytes });
    await imported;
    const mount = await mountedBy(started + 10000);
    assert.ok(mount, 'the app mounts once the kernel is in');
    assert.equal(mount.kernel, true, 'with the kernel active, so its first calculation runs on it');
    assert.ok(mount.at - started < 1900, 'well before the wait would have run out');
    assert.equal(await mount.kernelStartup, null, 'and the app is told nothing went wrong');
}

console.log('PASS: renderer_kernel_first');
