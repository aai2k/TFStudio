// What the API needs from its process before it computes anything: the WASM
// kernel on this thread, and the user's material catalogs when a data folder
// is named.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getTmmWasm, initTmmWasmMainThread } from '../tmmcore.js';
import { loadCatalogsFromDisk } from '../utils/materials/catalogStartup.js';
import catalogsIpc from '../main/ipc/catalogs.js';
import mainPaths from '../main/paths.js';
import { checkOptions, requireValue } from './check.js';

const require = createRequire(import.meta.url);

let started = null;
let startedWith = null;

/**
 * Starts the API: loads the WASM kernel the app computes with and, given a
 * data folder, reads the material catalogs in it as the app does at startup.
 * The Script Console starts the API on the app's data folder before a script
 * runs, so a script has no `tf.init`. A start that failed may be tried again.
 *
 * @param [options]
 * @param [options.dataDir=null] A TFStudio data folder, the one that holds the Materials and Projects folders. Without it, the built-in materials and those a design carries resolve.
 * @param [options.wasmPath=null] The kernel file, when it is not the one the API ships with.
 * @returns A promise of what it started.
 * @property wasm `true` when the WASM kernel loaded; `false` when it could not, and every calculation then throws.
 * @property dataDir The data folder it read, or null.
 * @property unreadable The catalog files it could not read and left out.
 * @throws a data folder that holds no Materials folder
 * @throws a second start with another data folder: a process reads one
 */
export async function init(options) {
    // The kernel file is the tmmcore package's unless wasmPath names one, as
    // an installed app does.
    const { dataDir = null, wasmPath = null } = checkOptions('init', options, ['dataDir', 'wasmPath']);
    const isPathOrNull = v => v === null || (typeof v === 'string' && v !== '');
    requireValue('init', 'dataDir', dataDir, isPathOrNull, 'the path of a TFStudio data folder, or null');
    requireValue('init', 'wasmPath', wasmPath, isPathOrNull, 'the path of the WASM kernel file, or null');
    if (started && dataDir !== startedWith) {
        return Promise.reject(new Error(`init already ran with dataDir ${startedWith}; a process reads one data folder`));
    }
    if (!started) {
        startedWith = dataDir;
        started = start(dataDir, wasmPath).catch(err => { started = null; throw err; });
    }
    return started;
}

let kernelTried = false;

/**
 * Throws when a call is about to calculate and the WASM kernel is not loaded:
 * every calculation runs on it. Before init() the error says to await it;
 * after an init() that could not load the kernel, whose result said
 * { wasm: false }, it says that.
 */
export function requireKernel() {
    if (getTmmWasm()) return;
    throw new Error(kernelTried
        ? 'TFStudio API: init() could not load the WASM kernel, so nothing can be calculated.'
        : 'TFStudio API: the WASM kernel is not loaded. Await init() before the first calculation.');
}

async function start(dataDir, wasmPath) {
    provideEventAndCrypto();
    let wasm = false;
    try { wasm = !!(await initTmmWasmMainThread(fs.readFileSync(wasmPath || require.resolve('tmmcore/tmm_kernel.wasm')), true)); }
    catch (_) { wasm = false; }
    kernelTried = true;
    const unreadable = dataDir ? await loadUserCatalogs(dataDir) : [];
    return { wasm, dataDir, unreadable };
}

// The app's renderer reads its catalogs through window.electronAPI from the
// main process's catalog handlers (src/main/ipc/catalogs.js). The API answers
// those reads from the same handlers in this process and offers no save, so it
// writes no catalog. The events the catalog startup sends go to an EventTarget
// nothing listens on.
// Node before 19 (the Windows 7 build's Electron 22 runs Node 16) has neither
// CustomEvent, which the catalog code dispatches, nor a global crypto, which
// gives catalogs their stamps.
function provideEventAndCrypto() {
    globalThis.CustomEvent ??= class CustomEvent extends Event {
        constructor(type, init = {}) { super(type, init); this.detail = init.detail ?? null; }
    };
    globalThis.crypto ??= require('node:crypto').webcrypto;
}

async function loadUserCatalogs(dataDir) {
    const materialsDir = path.join(dataDir, 'Materials');
    if (!fs.existsSync(materialsDir)) throw new Error(`${dataDir} holds no Materials folder`);
    const handlers = new Map();
    catalogsIpc.register({ handle: (channel, fn) => handlers.set(channel, fn) },
        { fs, path, log: () => {}, materialsDir, ...mainPaths });
    const call = (channel, ...args) => handlers.get(channel)(null, ...args);
    globalThis.window ??= globalThis;
    if (typeof globalThis.window.dispatchEvent !== 'function') {
        const events = new EventTarget();
        globalThis.window.dispatchEvent = events.dispatchEvent.bind(events);
    }
    globalThis.window.electronAPI = {
        loadCatalogs: () => call('catalog:load-all'),
        scanAgfDir: () => call('catalog:scan-agf-dir'),
    };
    const { unreadable } = await loadCatalogsFromDisk();
    return unreadable;
}
