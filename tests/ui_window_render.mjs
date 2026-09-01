/**
 * UI window render smoke test.
 *
 * Server-renders every registry window plus the modal wizards to static markup.
 * That exercises the full initial-render tree — every render-time closure,
 * `.map`, destructure and JSX branch — so a change that drops a prop, mis-names
 * a variable, or breaks a sub-component render is caught automatically instead
 * of only by clicking through the app. A window whose module fails to load at
 * all (broken import, syntax error, top-level throw, missing export) surfaces
 * here too, as "white screen on open" would.
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

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeTheme, makeLocale, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, '../src/components/docking/windowRegistry.js');

function parseWindowImports() {
    const src = readFileSync(REGISTRY, 'utf8');
    const re = /import\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from\s*'(\.\.\/windows\/(?:[A-Za-z0-9_]+\/)*[A-Za-z0-9_]+\.js)'/g;
    const out = [];
    let m;
    while ((m = re.exec(src))) out.push({ name: m[1], abs: resolve(dirname(REGISTRY), m[2]) });
    return out;
}

// Modal wizards are opened from renderer.js, not the docking registry, so
// they aren't in the registry import scan — render them explicitly here. They
// take { c, t, onClose }.
const EXTRA_MODALS = [
    { name: 'BBMWizard',          rel: '../windows/simulation/bbmWizard/BBMWizard.js' },
    { name: 'MonoWizard',         rel: '../windows/simulation/monoWizard/MonoWizard.js' },
    { name: 'FilterDesignWizard', rel: '../windows/optimization/filterDesignWizard/FilterDesignWizard.js' },
    { name: 'StackFormulaDialog', rel: '../windows/design/stackFormula/StackFormulaDialog.js',
      props: { folderName: 'Demo', hasActiveDesign: false, onCreateNew: () => {} } },
    { name: 'ReportGenerator',    rel: '../windows/information/reportGenerator/ReportGenerator.js',
      props: { designs: [], activeDesignId: null, folderName: 'Demo' } },
];

const noop = () => {};
let c, t;

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('  FAIL:', msg); fails++; } };

async function renderOne(name, abs, props) {
    try {
        const mod = await import(pathToFileURL(abs).href);
        const Comp = mod[name];
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
    const windows = parseWindowImports();
    console.log(`UI window render — ${windows.length} registry windows + ${EXTRA_MODALS.length} modals\n`);

    for (const w of windows) {
        await renderOne(w.name, w.abs, { c, t, theme: c, setInputDialog: noop, onClose: noop });
    }
    for (const w of EXTRA_MODALS) {
        await renderOne(w.name, resolve(dirname(REGISTRY), w.rel), { c, t, onClose: noop, ...(w.props || {}) });
    }

    // The registry itself must import and build the tables the docking layer
    // reads to open, label and help-link a window.
    try {
        const reg = await import(pathToFileURL(REGISTRY).href);
        ok(reg.WINDOW_REGISTRY && typeof reg.WINDOW_REGISTRY === 'object', 'WINDOW_REGISTRY export missing');
        ok(reg.TOOL_CONFIGS && Object.keys(reg.TOOL_CONFIGS).length > 0, 'TOOL_CONFIGS derived table empty');
        ok(reg.TOOL_LABELS && Object.keys(reg.TOOL_LABELS).length > 0, 'TOOL_LABELS derived table empty');
        ok(typeof reg.helpAnchorFor === 'function', 'helpAnchorFor export missing');
        for (const [id, entry] of Object.entries(reg.WINDOW_REGISTRY)) {
            if (entry.component != null)
                ok(typeof entry.component === 'function', `registry '${id}'.component is not a function`);
        }
    } catch (e) {
        console.error(`  FAIL: windowRegistry.js import threw: ${e && e.message ? e.message : e}`);
        fails++;
    }

    console.log('');
    if (fails === 0) { console.log(`PASS — all windows render to static markup.`); process.exit(0); }
    console.error(`${fails} render failure(s).`); process.exit(1);
}

main();
