// What the API needs from its process before it computes anything: the WASM
// kernel on this thread, and the user's material catalogs when a data folder
// is named.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { initTmmWasmMainThread } from '../tmmcore.js';
import { loadCatalogsFromDisk } from '../utils/materials/catalogStartup.js';
import catalogsIpc from '../main/ipc/catalogs.js';
import mainPaths from '../main/paths.js';
import { checkOptions, requireValue } from './check.js';

const require = createRequire(import.meta.url);

let started = null;
let startedWith = null;

/**
 * Starts the API's environment, once: the WASM kernel the app computes with
 * (the JavaScript one when the kernel cannot load), and with `dataDir`, a
 * TFStudio data folder (the one holding Materials and Projects), the user's
 * catalogs read the way the app reads them at startup. Without a data folder
 * the built-in catalog and the materials a design carries resolve. Resolves to
 * { wasm, dataDir, unreadable }, `unreadable` naming the catalog files that
 * could not be read and were left out. `wasmPath` names the kernel's file when
 * it is not the tmmcore package's, as in an installed app. A process reads one
 * data folder: init again with another is refused, and a start that failed can
 * be tried again.
 */
export async function init(options) {
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

async function start(dataDir, wasmPath) {
    provideEventAndCrypto();
    let wasm = false;
    try { wasm = !!(await initTmmWasmMainThread(fs.readFileSync(wasmPath || require.resolve('tmmcore/tmm_kernel.wasm')), true)); }
    catch (_) { wasm = false; }
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
