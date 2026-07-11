/**
 * UI window RENDER smoke test.
 *
 * Goes one step beyond ui_window_smoke.mjs (which only imports each window
 * module): this actually server-renders every registry window plus the modal
 * wizards to static markup. That exercises the full initial-render tree — every
 * render-time closure, `.map`, destructure and JSX branch — so a refactor that
 * drops a prop, mis-names a variable, or breaks a sub-component render is caught
 * automatically instead of only by clicking through the app.
 *
 * `useEffect` does not run under server render, so effect-only paths (Plotly
 * init, worker wiring, network) are intentionally out of scope — those stay with
 * manual QA. What this locks down is that each window RENDERS without throwing
 * under a realistic theme + locale + active-design context.
 *
 * Run: node tests/ui_window_render.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeTheme, makeLocale, withDesign } from './_uiShim.mjs';

// `--hash` prints a JSON map of window → render-markup hash instead of pass/fail,
// for before/after bit-identity checks when refactoring a window's render path.
const HASH = process.argv.includes('--hash');

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

// Modal wizards are opened from renderer-modular, not the docking registry, so
// they aren't in the registry import scan — render them explicitly here. They
// take { c, t, onClose }.
const EXTRA_MODALS = [
    { name: 'BBMWizard',          rel: '../windows/simulation/BBMWizard.js' },
    { name: 'MonoWizard',         rel: '../windows/simulation/MonoWizard.js' },
    { name: 'FilterDesignWizard', rel: '../windows/optimization/FilterDesignWizard.js' },
];

const noop = () => {};
let c, t;

let fails = 0;
const hashes = {};

async function renderOne(name, abs, props) {
    try {
        const mod = await import(pathToFileURL(abs).href);
        const Comp = mod[name];
        if (typeof Comp !== 'function') { console.error(`  FAIL ${name}: export is ${typeof Comp}`); fails++; return; }
        const el = withDesign(React.createElement(Comp, props));
        const html = renderToStaticMarkup(el);
        if (typeof html !== 'string') { console.error(`  FAIL ${name}: render produced ${typeof html}`); fails++; return; }
        if (HASH) hashes[name] = createHash('sha256').update(html).digest('hex').slice(0, 16);
        else console.log(`  ok   ${name}  (${html.length} chars)`);
    } catch (e) {
        if (HASH) hashes[name] = 'THREW';
        else { console.error(`  FAIL ${name}: render threw — ${e && e.message ? e.message : e}`); fails++; }
    }
}

async function main() {
    await loadApp();
    c = makeTheme();
    t = makeLocale();
    const windows = parseWindowImports();
    if (!HASH) console.log(`UI window render — ${windows.length} registry windows + ${EXTRA_MODALS.length} modals\n`);

    for (const w of windows) {
        await renderOne(w.name, w.abs, { c, t, theme: c, setInputDialog: noop, onClose: noop });
    }
    for (const w of EXTRA_MODALS) {
        await renderOne(w.name, resolve(dirname(REGISTRY), w.rel), { c, t, onClose: noop });
    }

    if (HASH) { console.log(JSON.stringify(hashes)); process.exit(0); }

    console.log('');
    if (fails === 0) { console.log(`PASS — all windows render to static markup.`); process.exit(0); }
    console.error(`${fails} render failure(s).`); process.exit(1);
}

main();
