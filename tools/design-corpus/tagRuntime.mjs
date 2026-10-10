/**
 * A released build's own code, run headless.
 *
 * A release is taken from its git tag with `git archive` into a cache folder
 * outside the repository (TFS_TAG_CACHE, else tfs-design-corpus-tags under the
 * system temp folder). Its main-process design and catalog handlers are
 * registered on a stand-in ipcMain over a data folder of its own, and its
 * renderer modules are imported as they are, with the few browser globals they
 * touch (window, localStorage, React) stood in.
 *
 * The clock and the random sources are fixed while a fixture is built, so the
 * ids and stamps an old release writes come out the same on every run.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function tagCacheDir() {
    return process.env.TFS_TAG_CACHE || path.join(os.tmpdir(), 'tfs-design-corpus-tags');
}

/**
 * The folder holding release `tag`, extracted on first use. Its bare imports
 * (react, tmmcore, js-yaml) resolve to this checkout's packages through a
 * junction: building a design needs none of the numerics they pin.
 */
export function extractTag(tag) {
    const dir = path.join(tagCacheDir(), tag);
    if (!fs.existsSync(path.join(dir, 'package.json'))) {
        fs.mkdirSync(dir, { recursive: true });
        const tar = path.join(tagCacheDir(), `${tag}.tar`);
        execFileSync('git', ['-C', REPO, 'archive', '--format=tar', '-o', tar, `refs/tags/${tag}`]);
        execFileSync('tar', ['-xf', tar, '-C', dir]);
        fs.rmSync(tar);
    }
    const modules = path.join(dir, 'node_modules');
    if (!fs.existsSync(modules)) fs.symlinkSync(path.join(REPO, 'node_modules'), modules, 'junction');
    return dir;
}

// Deterministic stand-ins for the clock and the random sources. The clock
// moves on by one millisecond per reading, so ids built from it stay distinct;
// a Date made with no arguments and performance.now read it too, as an RII
// import's fetch date and a measured curve's id do. crypto.getRandomValues,
// which later releases draw catalog ids and stamps from, takes its bytes from
// the same seeded sequence as Math.random.
const RealDate = Date;
const realRandom = Math.random;
const realCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const realPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
export function fixClockAndRandom(seed = 1) {
    const start = RealDate.UTC(2026, 0, 1);
    let now = start;
    let state = seed >>> 0;
    Object.defineProperty(globalThis, 'performance', {
        value: { now: () => now++ - start, timeOrigin: start }, configurable: true, writable: true,
    });
    globalThis.Date = class extends RealDate {
        constructor(...args) {
            if (args.length) super(...args);
            else super(now++);
        }
        static now() { return now++; }
    };
    Math.random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    const getRandomValues = (array) => {
        for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 256);
        return array;
    };
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues }, configurable: true, writable: true });
}
export function restoreClockAndRandom() {
    globalThis.Date = RealDate;
    Math.random = realRandom;
    Object.defineProperty(globalThis, 'crypto', realCrypto);
    Object.defineProperty(globalThis, 'performance', realPerformance);
}

/** The browser globals renderer modules read at import or call time. */
export function installRendererGlobals(electronAPI = {}) {
    const store = new Map();
    const events = new EventTarget();
    globalThis.window = globalThis;
    globalThis.addEventListener = events.addEventListener.bind(events);
    globalThis.removeEventListener = events.removeEventListener.bind(events);
    globalThis.dispatchEvent = events.dispatchEvent.bind(events);
    globalThis.localStorage = {
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key),
        clear: () => store.clear(),
        key: index => [...store.keys()][index] ?? null,
        get length() { return store.size; },
    };
    globalThis.React = require('react');
    globalThis.electronAPI = electronAPI;
}

/** Import one renderer module of the release in `tagDir` ('utils/x.js'). */
export function tagModule(tagDir, rel) {
    return import(pathToFileURL(path.join(tagDir, 'src', rel)).href);
}

export function tagHasModule(tagDir, rel) {
    return fs.existsSync(path.join(tagDir, 'src', rel));
}

/**
 * The release's design and catalog handlers over `dataDir` (Projects and
 * Materials below it), and a window.electronAPI that reaches them the way its
 * preload does for the calls a fixture needs.
 */
export function tagMain(tagDir, dataDir) {
    const paths = require(path.join(tagDir, 'src', 'main', 'paths.js'));
    const handlers = new Map();
    const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
    const ctx = {
        fs, path, log: () => {}, dialog: null, getMainWindow: () => null,
        projectsDir: path.join(dataDir, 'Projects'),
        materialsDir: path.join(dataDir, 'Materials'),
        settingsPath: path.join(dataDir, 'settings.json'),
        ...paths,
    };
    // The folders every release's main.js makes at startup.
    fs.mkdirSync(ctx.projectsDir, { recursive: true });
    for (const sub of ['agf', 'user', 'refractiveindex', 'library', 'optilayer']) {
        fs.mkdirSync(path.join(ctx.materialsDir, sub), { recursive: true });
    }
    require(path.join(tagDir, 'src', 'main', 'ipc', 'projects.js')).register(ipcMain, ctx);
    require(path.join(tagDir, 'src', 'main', 'ipc', 'catalogs.js')).register(ipcMain, ctx);
    const call = (channel, ...args) => {
        const fn = handlers.get(channel);
        if (!fn) throw new Error(`${path.basename(tagDir)} has no handler for ${channel}`);
        return fn(null, ...args);
    };
    const electronAPI = {
        saveCatalog: catalog => call('catalog:save', catalog),
        deleteCatalog: (id, source) => call('catalog:delete', id, source),
        loadCatalogs: () => call('catalog:load-all'),
        scanAgfDir: () => call('catalog:scan-agf-dir'),
        saveDesign: (folderId, design, expectedMtime) => call('save-design', folderId, design, expectedMtime),
        loadFolders: lastSeen => call('load-folders', lastSeen),
    };
    // The release's first-start seeding of Materials from its own build/seed,
    // where the tag carries one.
    const seed = () => require(path.join(tagDir, 'src', 'main', 'seed.js'))
        .seedBundledMaterials(ctx.materialsDir, { isPackaged: false, srcDir: path.join(tagDir, 'src') });
    // The release's offline refractiveindex.info mirror, standing on a local
    // copy of the database: its own read-local handler serves the pages. No
    // network fetch is offered, so a page the copy lacks fails.
    const mountRiiMirror = () => {
        const mirror = path.join(ctx.materialsDir, 'refractiveindex-db');
        if (!fs.existsSync(mirror)) fs.symlinkSync(riiDatabaseDir(), mirror, 'junction');
        require(path.join(tagDir, 'src', 'main', 'ipc', 'rii.js')).register(ipcMain, ctx);
        electronAPI.riiReadLocal = rel => call('rii:read-local', rel);
    };
    return { ctx, call, electronAPI, seed, mountRiiMirror };
}

/**
 * The refractiveindex.info database folder (catalog-nk.yml and data/):
 * TFS_RII_SOURCE, else the refractiveindex-db submodule, else
 * ../../reference/refractiveindex-db, as tools/gen_builtin_materials.mjs looks
 * for it.
 */
export function riiDatabaseDir() {
    const candidates = [
        process.env.TFS_RII_SOURCE,
        path.join(REPO, 'refractiveindex-db', 'database'),
        path.resolve(REPO, '..', '..', 'reference', 'refractiveindex-db', 'database'),
    ].filter(Boolean);
    const found = candidates.find(dir => fs.existsSync(path.join(dir, 'data')));
    if (!found) throw new Error(`refractiveindex.info database not found; looked in ${candidates.join(', ')}`);
    return found;
}
