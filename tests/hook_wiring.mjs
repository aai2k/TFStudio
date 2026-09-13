/**
 * Every name a hook hands out is a name the hook still returns.
 *
 * The shell's hooks pass state to each other in two ways that nothing else
 * checks. The project-tree actions read every setter and ref out of one bag
 * refreshed each render, and the shell and its dialogs read their props off the
 * hook objects by dotted path. Rename or drop one member of what a hook returns
 * and the bundle still builds, the module graph is still whole, and the shell
 * still renders, because none of those calls an action or opens a dialog. The
 * user finds it: a dead Save button, or a welcome screen with no starter
 * designs.
 *
 * So this reads the source. Every `a.key` an action file uses has to be in that
 * file's bag, and every `settings.key` / `project.key` the shell and its dialogs
 * read has to be a key that hook returns.
 *
 * Run: node tests/hook_wiring.mjs
 */

import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

let passed = 0;
function ok(condition, message) {
    if (!condition) throw new Error(message);
    passed++;
}

const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// The object literal that starts at the first `{` after `marker`, which is
// either the text to look for or an index already found.
function literalAfter(text, marker, what) {
    const from = typeof marker === 'number' ? marker : text.indexOf(marker);
    ok(from >= 0, `${what}: no "${marker}" in the file`);
    const open = text.indexOf('{', from);
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
    }
    throw new Error(`${what}: "${marker}" has no closing brace`);
}

// The top-level names an object literal defines, and the objects it spreads in.
function entriesOf(literal) {
    const keys = new Set();
    const spreads = [];
    const take = (entry) => {
        const m = entry.trim().match(/^(?:\.\.\.(\w+)|(\w+))/);
        if (!m) return;
        if (m[1]) spreads.push(m[1]);
        else keys.add(m[2]);
    };
    let depth = 0;
    let buf = '';
    for (const ch of stripComments(literal)) {
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
        if (ch === ',' && depth === 0) { take(buf); buf = ''; continue; }
        buf += ch;
    }
    take(buf);
    return { keys, spreads };
}

const FILES = {
    app:      'App.js',
    modals:   'components/AppModals.js',
    settings: 'hooks/useAppSettings.js',
    dialogs:  'hooks/useAppDialogs.js',
    welcome:  'hooks/useWelcomeAndTutorials.js',
    workspace:'hooks/useWorkspaceLayout.js',
    store:    'hooks/useDesignStore.js',
    projectTree: 'hooks/useProjectTree.js',
    designActions: 'hooks/useDesignActions.js',
    removal:  'hooks/useProjectRemoval.js',
    imports:  'hooks/useDesignImport.js',
    folders:  'hooks/useFolderActions.js',
};
const source = Object.fromEntries(Object.entries(FILES).map(([id, rel]) => [id, read(rel)]));

// A hook's own return is the last object literal it returns.
const returnsOf = (id) =>
    entriesOf(literalAfter(source[id], source[id].lastIndexOf('return {'), FILES[id]));

const hookKeys = Object.fromEntries(
    Object.keys(FILES).filter(id => id !== 'app' && id !== 'modals')
        .map(id => [id, returnsOf(id)]));

// What useProjectTree hands out is its own return plus the four action hooks it
// spreads into it.
const ACTION_HOOKS = ['designActions', 'removal', 'imports', 'folders'];
ok(hookKeys.projectTree.spreads.length === ACTION_HOOKS.length,
   `useProjectTree spreads ${ACTION_HOOKS.length} action hooks, found ${hookKeys.projectTree.spreads.length}`);
const projectKeys = new Set([
    ...hookKeys.projectTree.keys,
    ...ACTION_HOOKS.flatMap(id => [...hookKeys[id].keys]),
]);

// The primitives useProjectTree passes down to those action hooks.
const treeKeys = entriesOf(
    literalAfter(source.projectTree, 'const tree = {', 'useProjectTree tree')).keys;

// ── Every bag member an action reads is in the bag ───────────────────────────

const BAGS = [
    { id: 'projectTree',   name: 'p' },
    { id: 'designActions', name: 'a' },
    { id: 'removal',       name: 'a' },
    { id: 'imports',       name: 'a' },
    { id: 'folders',       name: 'a' },
    { id: 'store',         name: 's' },
    { id: 'welcome',       name: 'w' },
];

const SPREAD_SOURCES = { store: () => hookKeys.store.keys, tree: () => treeKeys };

for (const bag of BAGS) {
    const text = source[bag.id];
    const literal = literalAfter(text, `${bag.name}.current = `, FILES[bag.id]);
    const { keys, spreads } = entriesOf(literal);
    const available = new Set(keys);
    for (const spread of spreads) {
        ok(SPREAD_SOURCES[spread], `${FILES[bag.id]}: the bag spreads "${spread}", which this test cannot resolve`);
        for (const key of SPREAD_SOURCES[spread]()) available.add(key);
    }

    const used = new Set();
    const refs = new RegExp(`\\b${bag.name}\\.(\\w+)`, 'g');
    for (const [, key] of stripComments(text).matchAll(refs)) {
        if (key !== 'current') used.add(key);
    }
    ok(used.size > 0, `${FILES[bag.id]}: no bag reads found, so this check is not looking at anything`);

    const missing = [...used].filter(key => !available.has(key));
    ok(missing.length === 0,
       `${FILES[bag.id]}: ${bag.name}.${missing[0]} is read but is not in the bag`);
}

// ── Every dotted path into a hook object is a name that hook returns ─────────

const PATHS = [
    { id: 'app',         provides: { store: hookKeys.store.keys, workspace: hookKeys.workspace.keys, project: projectKeys } },
    { id: 'modals',      provides: { settings: hookKeys.settings.keys, dialogs: hookKeys.dialogs.keys, welcome: hookKeys.welcome.keys, project: projectKeys } },
    { id: 'projectTree', provides: { store: hookKeys.store.keys } },
    { id: 'designActions', provides: { tree: treeKeys } },
    { id: 'imports',     provides: { tree: treeKeys } },
];

for (const entry of PATHS) {
    const text = stripComments(source[entry.id]);
    for (const [owner, available] of Object.entries(entry.provides)) {
        const refs = new RegExp(`\\b${owner}\\.(\\w+)`, 'g');
        const used = [...text.matchAll(refs)].map(([, key]) => key);
        const missing = used.filter(key => !available.has(key));
        ok(missing.length === 0,
           `${FILES[entry.id]}: ${owner}.${missing[0]} is read but ${owner} does not hand it out`);
    }
}

// The shell reads its dialogs' state off those objects, so the check above is
// only worth anything while it has paths to look at.
{
    const modals = stripComments(source.modals);
    const counted = ['settings', 'dialogs', 'welcome', 'project']
        .reduce((sum, owner) => sum + [...modals.matchAll(new RegExp(`\\b${owner}\\.(\\w+)`, 'g'))].length, 0);
    ok(counted > 30, `AppModals.js: only ${counted} hook paths found, expected the whole dialog wiring`);
}

console.log(`hook_wiring: ${passed} passed`);
