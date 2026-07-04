/**
 * UI window smoke test.
 *
 * The ~31 dockable tool windows (src/components/windows/*) had ZERO automated
 * coverage — every other test hits the engine. This smoke test targets the
 * cheapest, highest-value UI regression class: a window whose MODULE fails to
 * load (broken import after a refactor, syntax error, top-level throw, missing
 * export) → "white screen on open" at runtime. Exactly the class caught
 * by hand.
 *
 * It is dependency-free: the windows use React.createElement (no JSX) and dev
 * mode loads raw ES modules from src/ unchanged, so Node can import them
 * directly under a minimal browser-global shim. Plotly is a runtime UMD global
 * (not a module import), so it doesn't block import.
 *
 * What it asserts per window:
 *   1. the module imports without throwing
 *   2. the named export referenced by the registry exists and is a function
 *      (a valid React component)
 * Plus: the registry module itself imports and its derived tables build.
 *
 * This does NOT render the components (no jsdom/Electron) — initial-render and
 * deep runtime bugs are covered by the 15.5 per-module audit + manual QA.
 *
 * Run: node tests/ui_window_smoke.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import React from 'react';
import ReactDOM from 'react-dom';

// Components reference a GLOBAL `React`/`ReactDOM` (loaded as UMD vendor globals
// in the real app, not imported per-file). Provide them before any import.
globalThis.React = React;
globalThis.ReactDOM = ReactDOM;

// ── Minimal browser-global shim (must run BEFORE importing any component) ──────
function noop() {}
function shimBrowserGlobals() {
    const g = globalThis;
    const store = new Map();
    const localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
    };
    const elementStub = () => ({
        style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
        appendChild: (x) => x, removeChild: (x) => x, addEventListener: noop,
        removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
        getContext: () => null, getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
        focus: noop, click: noop, remove: noop, insertBefore: (x) => x, contains: () => false,
        children: [], childNodes: [], dataset: {},
    });
    const documentStub = {
        createElement: elementStub, createElementNS: elementStub,
        createTextNode: () => ({}), getElementById: () => null,
        querySelector: () => null, querySelectorAll: () => [],
        addEventListener: noop, removeEventListener: noop,
        body: elementStub(), head: elementStub(), documentElement: elementStub(),
        fonts: { ready: Promise.resolve(), add: noop },
    };
    // Safe define: skip globals already present (e.g. Node 22 has a read-only
    // `navigator`); fall back to defineProperty if plain assignment is blocked.
    const def = (name, value) => {
        if (name in g && g[name] != null) return;
        try { g[name] = value; }
        catch { try { Object.defineProperty(g, name, { value, configurable: true, writable: true }); } catch { /* give up */ } }
    };
    def('window', g);
    // A real browser `window` always has these; the Node global doesn't, so add
    // them to the stub. Module-level `window.addEventListener(...)` listeners
    // (e.g. the design-evict cache eviction) would otherwise throw at import.
    if (typeof g.addEventListener !== 'function') {
        try { g.addEventListener = noop; g.removeEventListener = noop; g.dispatchEvent = () => true; } catch { /* ignore */ }
    }
    def('document', documentStub);
    def('localStorage', localStorage);
    def('navigator', { userAgent: 'node-smoke', language: 'en', platform: 'node', clipboard: {} });
    def('location', { href: 'app://smoke/', origin: 'app://smoke', search: '', hash: '' });
    def('matchMedia', () => ({ matches: false, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop }));
    def('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
    def('cancelAnimationFrame', clearTimeout);
    def('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    def('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    def('MutationObserver', class { observe() {} disconnect() {} takeRecords() { return []; } });
    def('HTMLElement', class {});
    def('Worker', class { constructor() {} postMessage() {} terminate() {} addEventListener() {} removeEventListener() {} });
    def('Plotly', { newPlot: noop, react: noop, purge: noop, relayout: noop, restyle: noop, downloadImage: () => Promise.resolve() });
    def('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    // Electron preload bridge — windows call window.electronAPI.* ; stub everything
    // as a harmless async-returning proxy.
    const apiProxy = new Proxy({}, { get: () => (() => Promise.resolve(null)) });
    const win = g.window;
    if (win && !win.electronAPI) try { win.electronAPI = apiProxy; } catch { /* ignore */ }
    def('electronAPI', apiProxy);
    if (win) {
        if (!win.localStorage) try { win.localStorage = localStorage; } catch { /* ignore */ }
        if (!win.matchMedia) try { win.matchMedia = g.matchMedia; } catch { /* ignore */ }
        if (!win.document) try { win.document = documentStub; } catch { /* ignore */ }
    }
}
shimBrowserGlobals();

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, '../src/components/docking/windowRegistry.js');

// ── Parse the registry's window imports: `import { Name } from '../windows/X.js'`
function parseWindowImports() {
    const src = readFileSync(REGISTRY, 'utf8');
    const re = /import\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from\s*'(\.\.\/windows\/[A-Za-z0-9_]+\.js)'/g;
    const out = [];
    let m;
    while ((m = re.exec(src))) {
        out.push({ name: m[1], rel: m[2], abs: resolve(dirname(REGISTRY), m[2]) });
    }
    return out;
}

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('  FAIL:', msg); fails++; } };

async function main() {
    const windows = parseWindowImports();
    console.log(`UI window smoke — ${windows.length} window modules\n`);

    for (const w of windows) {
        try {
            const mod = await import(pathToFileURL(w.abs).href);
            const comp = mod[w.name];
            if (typeof comp !== 'function') {
                console.error(`  FAIL: ${w.name} — module loaded but export is ${typeof comp} (expected a React component fn)`);
                fails++;
            } else {
                console.log(`  ok   ${w.name}`);
            }
        } catch (e) {
            console.error(`  FAIL: ${w.name} — import threw: ${e && e.message ? e.message : e}`);
            fails++;
        }
    }

    // The registry itself must import and build its derived tables.
    try {
        const reg = await import(pathToFileURL(REGISTRY).href);
        ok(reg.WINDOW_REGISTRY && typeof reg.WINDOW_REGISTRY === 'object', 'WINDOW_REGISTRY export missing');
        ok(reg.TOOL_CONFIGS && Object.keys(reg.TOOL_CONFIGS).length > 0, 'TOOL_CONFIGS derived table empty');
        ok(reg.TOOL_LABELS && Object.keys(reg.TOOL_LABELS).length > 0, 'TOOL_LABELS derived table empty');
        ok(typeof reg.helpAnchorFor === 'function', 'helpAnchorFor export missing');
        // every registry entry that declares a component must have a valid one
        for (const [id, entry] of Object.entries(reg.WINDOW_REGISTRY)) {
            if (entry.component != null)
                ok(typeof entry.component === 'function', `registry '${id}'.component is not a function`);
        }
    } catch (e) {
        console.error(`  FAIL: windowRegistry.js import threw: ${e && e.message ? e.message : e}`);
        fails++;
    }

    console.log('');
    if (fails === 0) { console.log(`PASS — all ${windows.length} window modules import & export valid components.`); process.exit(0); }
    console.error(`${fails} smoke failure(s).`); process.exit(1);
}

main();
