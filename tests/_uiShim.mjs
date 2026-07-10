/**
 * Shared browser-global shim for the UI window tests.
 *
 * The tool windows (src/components/windows/*) reference GLOBAL `React`/`ReactDOM`
 * (loaded as UMD vendor globals in the real app, not imported per file) and a
 * handful of browser globals (window, document, localStorage, ResizeObserver,
 * Plotly, the Electron preload bridge, …). This module installs a minimal shim
 * for all of that so Node can import and render the modules directly.
 *
 * Import this module for its side effects BEFORE importing any component:
 *   import './_uiShim.mjs';
 * It also exports small builders (theme, locale, a stub design context) used by
 * the render smoke test.
 */

import React from 'react';
import ReactDOM from 'react-dom';

// App modules (DesignContext, locales) read the GLOBAL `React` at their module
// top, so `globalThis.React` MUST be set before they load. Static ES imports
// evaluate before this module's body, so those app modules are pulled in lazily
// via loadApp() AFTER the globals below are installed.
globalThis.React = React;
globalThis.ReactDOM = ReactDOM;

function noop() {}

let _app = null;
// Dynamically import the app modules the builders need. Call after
// shimBrowserGlobals(); safe to call more than once (cached).
export async function loadApp() {
    if (_app) return _app;
    const [{ getLocale }, { DesignContext }] = await Promise.all([
        import('../src/constants/locales.js'),
        import('../src/state/DesignContext.js'),
    ]);
    _app = { getLocale, DesignContext };
    return _app;
}

export function shimBrowserGlobals() {
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
    const def = (name, value) => {
        if (name in g && g[name] != null) return;
        try { g[name] = value; }
        catch { try { Object.defineProperty(g, name, { value, configurable: true, writable: true }); } catch { /* give up */ } }
    };
    def('window', g);
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

// A theme-colour object (`c`) with every key the windows read for styling.
// Values are placeholders — only their presence matters for a render.
export function makeTheme() {
    return {
        bg: '#1e1e1e', panel: '#252526', text: '#e0e0e0', textDim: '#9a9a9a',
        border: '#3c3c3c', accent: '#0a84ff', accentText: '#ffffff',
        error: '#f14c4c', warning: '#e0a030', success: '#3fb950',
        inputBg: '#2a2a2a', hover: '#2f2f2f', selection: '#0a84ff33',
    };
}

// The full English locale object (`t`). Requires loadApp() first.
export function makeLocale() {
    if (!_app) throw new Error('call loadApp() before makeLocale()');
    return _app.getLocale('en');
}

// A minimal but complete design used by windows that read the active design.
export function makeSampleDesign() {
    return {
        id: 'smoke-design', name: 'Smoke Design',
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'builtin:BK7', thickness: 1.0 },
        referenceWavelength: 550,
        spectrumLambdaStart: 400, spectrumLambdaEnd: 700, spectrumLambdaStep: 5,
        frontLayers: [
            { id: 'l1', material: 'builtin:TiO2', thickness: 100, locked: false },
            { id: 'l2', material: 'builtin:SiO2', thickness: 90,  locked: false },
        ],
        backLayers: [],
    };
}

// A stub DesignContext value mirroring DesignProvider's contract (all mutators
// are no-ops; the read side exposes a sample design).
export function makeDesignCtx(design = makeSampleDesign()) {
    return {
        design,
        updateDesign: noop, checkpoint: noop,
        history: { entries: [], index: 0 }, jumpToHistory: noop,
        addLayer: noop, removeLayer: noop, updateLayer: noop, moveLayer: noop, duplicateLayer: noop,
        evalMode: 'front',
        evalParams: { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 2, thetas: [0] }, setEvalParams: noop,
        isOptimizing: false, beginOptimization: noop, endOptimization: noop,
        getDesignRevision: () => 0,
    };
}

// Wrap a component element in the DesignContext provider with a stub value.
// Requires loadApp() first.
export function withDesign(element, design) {
    if (!_app) throw new Error('call loadApp() before withDesign()');
    return React.createElement(_app.DesignContext.Provider, { value: makeDesignCtx(design) }, element);
}
