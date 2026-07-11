/**
 * UI window smoke test.
 *
 * The ~31 dockable tool windows (src/components/windows/*) had ZERO automated
 * coverage — every other test hits the engine. This smoke test targets the
 * cheapest, highest-value UI regression class: a window whose MODULE fails to
 * load (broken import after a refactor, syntax error, top-level throw, missing
 * export) → "white screen on open" at runtime.
 *
 * It is dependency-free: the windows use React.createElement (no JSX) and dev
 * mode loads raw ES modules from src/ unchanged, so Node can import them
 * directly under the minimal browser-global shim in _uiShim.mjs.
 *
 * What it asserts per window:
 *   1. the module imports without throwing
 *   2. the named export referenced by the registry exists and is a function
 *      (a valid React component)
 * Plus: the registry module itself imports and its derived tables build.
 *
 * This does NOT render the components — that is ui_window_render.mjs, which
 * server-renders each window to catch render-time regressions.
 *
 * Run: node tests/ui_window_smoke.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, '../src/components/docking/windowRegistry.js');

// ── Parse the registry's window imports: `import { Name } from '../windows/X.js'`
function parseWindowImports() {
    const src = readFileSync(REGISTRY, 'utf8');
    const re = /import\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from\s*'(\.\.\/windows\/(?:[A-Za-z0-9_]+\/)*[A-Za-z0-9_]+\.js)'/g;
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
