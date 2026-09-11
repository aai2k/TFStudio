/**
 * DevTools opens in a shipped build.
 *
 * It used to be gated on a `--debug` launch flag, which could not work: Node's
 * deprecated inspector alias takes that name before any of our code runs. A
 * user who hit a broken window therefore had no way to see what happened. The
 * pane is now available in every build and auto-opens only for a `--dev` run.
 *
 * Run: node tests/devtools_availability.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const appWindow = require('../src/main/ipc/appWindow.js');

let passed = 0;
function ok(condition, message) {
    if (!condition) throw new Error(message);
    passed++;
}

const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const toolbarSrc = readFileSync(new URL('../src/components/Toolbar.js', import.meta.url), 'utf8');

// -- The gate is gone ---------------------------------------------------------
ok(!/devToolsAllowed/.test(mainSrc), 'main.js no longer carries a DevTools gate');
ok(!/devTools:/.test(mainSrc),
    'no window pins webPreferences.devTools, so Electron\'s default (on) applies');
ok(!/--debug/.test(mainSrc),
    'the --debug flag is gone: Node claims that name and exits before our code runs');
ok(!/--debug/.test(toolbarSrc), 'the View-menu comment no longer promises --debug');

// A --dev run still opens the pane; nothing else does.
const autoOpen = /if \(process\.argv\.includes\('--dev'\)\) \{\s*\n\s*mainWindow\.webContents\.openDevTools\(\);/.test(mainSrc);
ok(autoOpen, 'a --dev run still opens DevTools on launch');

// -- The renderer is told DevTools is available --------------------------------
{
    const handlers = new Map();
    const listeners = new Map();
    // No devToolsAllowed on ctx: the handler must not depend on one.
    const ctx = { getMainWindow: () => null };
    appWindow.register({
        handle: (c, h) => handlers.set(c, h),
        on: (c, h) => listeners.set(c, h),
    }, ctx);

    ok(await handlers.get('app:dev-allowed')() === true,
        'the View menu is told DevTools is available, with no gate on ctx');
    ok(listeners.has('toggle-devtools'), 'the toggle channel is registered');
}

// -- Toggling works without a gate on ctx --------------------------------------
{
    const calls = [];
    const webContents = {
        isDevToolsOpened: () => calls.includes('open'),
        openDevTools: () => calls.push('open'),
        closeDevTools: () => calls.push('close'),
    };
    const win = { isDestroyed: () => false, webContents };
    const listeners = new Map();
    appWindow.register({
        handle: () => {},
        on: (c, h) => listeners.set(c, h),
    }, { getMainWindow: () => win });

    const toggle = listeners.get('toggle-devtools');
    toggle();
    ok(calls.join() === 'open', 'the first toggle opens the pane');
    toggle();
    ok(calls.join() === 'open,close', 'the second toggle closes it');
}

// -- A destroyed or absent window is still handled -----------------------------
{
    for (const [label, getMainWindow] of [
        ['absent', () => null],
        ['destroyed', () => ({ isDestroyed: () => true, webContents: {} })],
        ['without webContents', () => ({ isDestroyed: () => false, webContents: null })],
    ]) {
        const listeners = new Map();
        appWindow.register({ handle: () => {}, on: (c, h) => listeners.set(c, h) }, { getMainWindow });
        let threw = false;
        try { listeners.get('toggle-devtools')(); } catch { threw = true; }
        ok(!threw, `toggling with a window that is ${label} does not throw`);
    }
}

console.log(`devtools_availability: ${passed} passed`);
