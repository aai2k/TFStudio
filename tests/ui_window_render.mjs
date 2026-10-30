/**
 * UI window render smoke test.
 *
 * Server-renders every registry window plus the modal wizards to static markup.
 * That exercises the full initial-render tree — every render-time closure,
 * `.map`, destructure and JSX branch — so a change that drops a prop, mis-names
 * a variable, or breaks a sub-component render is caught automatically instead
 * of only by clicking through the app. A window whose module fails to load at
 * all (broken import, syntax error, top-level throw, missing export) surfaces
 * here too, as "white screen on open" would: the registry imports every window,
 * and the error it throws names the module.
 *
 * The registry's own derived tables are checked at the end: a window that
 * renders but is missing from TOOL_CONFIGS / TOOL_LABELS still cannot be opened.
 *
 * `useEffect` does not run under server render, so effect-only chart
 * init, worker wiring, network) are intentionally out of scope — those stay with
 * manual QA. What this locks down is that each window RENDERS without throwing
 * under a realistic theme + locale + active-design context.
 *
 * Run: node tests/ui_window_render.mjs
 */

import './_kernel.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeTheme, makeLocale, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, '../src/components/docking/windowRegistry.js');

// Modal wizards are opened from AppModals.js, not the docking registry, so
// they aren't in WINDOW_REGISTRY and are rendered explicitly here. They
// take { c, t, onClose }.
const EXTRA_MODALS = [
    { name: 'BBMWizard',          rel: '../windows/simulation/bbmWizard/BBMWizard.js' },
    { name: 'MonoWizard',         rel: '../windows/simulation/monoWizard/MonoWizard.js' },
    { name: 'FilterDesignWizard', rel: '../windows/optimization/filterDesignWizard/FilterDesignWizard.js' },
    { name: 'StackFormulaDialog', rel: '../windows/design/stackFormula/StackFormulaDialog.js',
      props: { folderName: 'Demo', hasActiveDesign: false, onCreateNew: () => {} } },
    { name: 'EdgeFilterDialog', rel: '../windows/design/edgeFilter/EdgeFilterDialog.js',
      props: { folderName: 'Demo', hasActiveDesign: false, onCreateNew: () => {}, onOpenStackFormula: () => {} } },
];

const noop = () => {};
let c, t;

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('  FAIL:', msg); fails++; } };

async function renderOne(name, load, props) {
    try {
        const Comp = await load();
        if (typeof Comp !== 'function') { console.error(`  FAIL ${name}: export is ${typeof Comp}`); fails++; return; }
        const el = withDesign(React.createElement(Comp, props));
        const html = renderToStaticMarkup(el);
        if (typeof html !== 'string') { console.error(`  FAIL ${name}: render produced ${typeof html}`); fails++; return; }
        console.log(`  ok   ${name}  (${html.length} chars)`);
    } catch (e) {
        console.error(`  FAIL ${name}: render threw — ${e && e.message ? e.message : e}`);
        fails++;
    }
}

async function main() {
    await loadApp();
    c = makeTheme();
    t = makeLocale();

    // A window module that fails to load fails the registry import; its stack
    // names the module.
    let reg = null;
    try {
        reg = await import(pathToFileURL(REGISTRY).href);
    } catch (e) {
        console.error(`  FAIL: windowRegistry.js import threw: ${e && e.stack ? e.stack : e}`);
        fails++;
    }
    const windows = Object.entries(reg?.WINDOW_REGISTRY || {}).filter(([, entry]) => entry.component != null);
    console.log(`UI window render — ${windows.length} registry windows + ${EXTRA_MODALS.length} modals\n`);
    if (reg) ok(windows.length > 0, 'WINDOW_REGISTRY lists no window with a component');

    for (const [id, entry] of windows) {
        await renderOne(id, async () => entry.component, { c, t, theme: c, setInputDialog: noop, onClose: noop });
    }
    for (const w of EXTRA_MODALS) {
        const url = pathToFileURL(resolve(dirname(REGISTRY), w.rel)).href;
        await renderOne(w.name, async () => (await import(url))[w.name], { c, t, onClose: noop, ...(w.props || {}) });
    }

    // The tables the docking layer reads to open, label and help-link a window.
    if (reg) {
        ok(reg.WINDOW_REGISTRY && typeof reg.WINDOW_REGISTRY === 'object', 'WINDOW_REGISTRY export missing');
        ok(reg.TOOL_CONFIGS && Object.keys(reg.TOOL_CONFIGS).length > 0, 'TOOL_CONFIGS derived table empty');
        ok(reg.TOOL_LABELS && Object.keys(reg.TOOL_LABELS).length > 0, 'TOOL_LABELS derived table empty');
        ok(typeof reg.helpAnchorFor === 'function', 'helpAnchorFor export missing');
    }

    console.log('');
    if (fails === 0) { console.log(`PASS — all windows render to static markup.`); process.exit(0); }
    console.error(`${fails} render failure(s).`); process.exit(1);
}

main();
