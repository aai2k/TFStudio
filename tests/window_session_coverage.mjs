/**
 * Every dockable window keeps its controls for the session.
 *
 * Only the active tab of a dock group is mounted, so a window that holds its
 * controls in React state alone loses them on a tab switch, a dock move or a
 * reopen. This walks the registry and requires each window to either own a
 * session store or be listed below with the reason it does not need one.
 *
 * A new window will fail here until it does one or the other. Adding it to the
 * exempt list is a deliberate choice that has to carry a reason.
 *
 * Run: node tests/window_session_coverage.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TESTS_DIR, '..');
const WINDOWS_DIR = join(ROOT, 'src/components/windows');

// Windows that keep nothing across a remount, and why.
const EXEMPT = {
    'process-sim': 'writes its whole setup through persistence.js, which also survives a restart',
    history: 'renders the design history and holds no controls of its own',
};

const registrySrc = readFileSync(join(ROOT, 'src/components/docking/windowRegistry.js'), 'utf8');

const importPaths = {};
for (const match of registrySrc.matchAll(/import \{ (\w+) \} from '(\.\.\/windows\/[^']+)'/g)) {
    importPaths[match[1]] = match[2];
}

const entries = [...registrySrc.matchAll(/'([\w-]+)':\s*\{\s*component:\s*(\w+)/g)]
    .map(([, id, component]) => ({ id, component }));

assert.ok(entries.length >= 30, `expected the full registry, found ${entries.length} windows`);

const missing = [];
for (const { id, component } of entries) {
    if (EXEMPT[id]) continue;
    const importPath = importPaths[component];
    assert.ok(importPath, `${id}: no import found for ${component}`);
    const folder = join(WINDOWS_DIR, dirname(importPath.replace(/^\.\.\/windows\//, '')));
    if (!existsSync(join(folder, 'sessionState.js'))) missing.push(`${id} (${folder})`);
}

assert.deepEqual(missing, [],
    'every dockable window needs a sessionState.js, or an entry in EXEMPT saying why not');

// ── One mechanism, not several ───────────────────────────────────────────────
// Before this rule the windows had grown five separate hand-rolled stores. Each
// store must be built by the shared helper so they all reseed, normalise and
// evict the same way.
function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, out);
        else if (entry.name === 'sessionState.js') out.push(path);
    }
    return out;
}

const stores = walk(WINDOWS_DIR);
assert.ok(stores.length >= 25, `expected a store per window, found ${stores.length}`);
for (const path of stores) {
    const source = readFileSync(path, 'utf8');
    assert.ok(source.includes('createWindowSession'),
        `${path}: a session store must be built with createWindowSession`);
}

// A per-design Map keyed by design id, written back through an effect, is the
// pattern the shared store replaced. Catching it here keeps one from growing back.
const ADHOC = /window\.addEventListener\(\s*'tfstudio:design-evict'/;
const offenders = [];
function scanForAdhoc(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) scanForAdhoc(path);
        // windowSession.js is where eviction is handled, once, for every store.
        else if (entry.name.endsWith('.js') && entry.name !== 'windowSession.js'
            && ADHOC.test(readFileSync(path, 'utf8'))) {
            offenders.push(path);
        }
    }
}
scanForAdhoc(WINDOWS_DIR);
assert.deepEqual(offenders, [],
    'design eviction is handled by createWindowSession; a window must not listen for it itself');

console.log(`window_session_coverage: passed (${entries.length} windows, ${stores.length} stores)`);
