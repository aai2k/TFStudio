/**
 * Opening a design from the explorer focuses the Design Editor it already has.
 *
 * A double-click on a design row fires the row's click handler twice and its
 * double-click handler once, and the double-click handler is the one that opens
 * the editor. Since every window may now have several instances, an `openTool`
 * call that does not ask to focus an existing one docks another, so the ordinary
 * "open this design" gesture left two Design Editors on the same design. The
 * context menu's Open is the same handler and did the same.
 *
 * A second editor is still available deliberately, from the ribbon.
 *
 * Run: node tests/explorer_open_design.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

// ── The explorer's open path asks to focus ───────────────────────────────────

const app = read('App.js');
const handler = app.slice(app.indexOf('onOpenDesign:'), app.indexOf('h(DockingLayout'));
assert.ok(handler.includes('onOpenDesign:'), 'App still passes an onOpenDesign handler to the explorer');
assert.match(handler, /openTool\('design-editor',\s*\{[^}]*focusExisting:\s*true/,
    'opening a design focuses the Design Editor already on screen instead of docking a second one');

// ── Both ways in run through that one handler ────────────────────────────────

const explorer = read('components/panels/ProjectExplorer.js');
assert.match(explorer, /onDoubleClick:\s*\(\)\s*=>\s*onOpenDesign\s*&&\s*onOpenDesign\(item,\s*folder\)/,
    'the row double-click opens through onOpenDesign');
assert.match(explorer, /label:\s*t\.explorer\.open[\s\S]{0,120}onOpenDesign\(item,\s*folder\)/,
    "the context menu's Open opens through the same handler, so one fix covers both");

// ── The flag survives the whole way to the dock tree ─────────────────────────
//
// `openTool` spreads its options, so nothing between the caller and the tree
// names this flag. Asking for one the far end does not read would leave the
// handler looking fixed and behaving exactly as before.

assert.match(read('components/docking/DockingLayout.js'),
    /answerToolRequest\(toolRequests\[toolRequests\.length - 1\]/,
    'the docking layout answers the latest request through answerToolRequest');

assert.match(read('components/docking/useDockTree.js'),
    /openTool\(req\.toolId,\s*\{[^}]*focusExisting:\s*req\.focusExisting/,
    'which forwards focusExisting from the request');

assert.match(read('components/docking/useDockTree.js'),
    /if\s*\(opts\.focusExisting\)/,
    'and the dock tree activates the open tab instead of adding one');

// ── A torn-off Design Editor is the one brought forward ──────────────────────
//
// The dock tree holds only the docked tabs. With the Design Editor torn off and
// none left docked, opening a design found no editor to focus and docked a
// second one. The real hooks run here on the hook harness, wired as
// DockingLayout wires them, and each request goes through answerToolRequest,
// the function DockingLayout's request effect calls.

shimBrowserGlobals();
await loadApp();
// The windows the registry names load with the real React; only the two hooks run on the harness.
await import('../src/components/docking/windowRegistry.js');
const rt = makeHookRuntime();
const { useDockTree, answerToolRequest } = await importWithHookRuntime('../src/components/docking/useDockTree.js', rt);
const { useFloatWindows } = await importWithHookRuntime('../src/components/docking/useFloatWindows.js', rt);
const { makeGroup, tabsIn } = await import('../src/components/docking/treeUtils.js');

let dock;
let floating;
const render = () => {
    const real = globalThis.React;
    globalThis.React = rt.React;
    try {
        rt.render(() => {
            dock = useDockTree();
            floating = useFloatWindows({
                setTree: dock.setTree, placeTab: dock.placeTab, lastGroupRef: dock.lastGroupRef,
                setDragActive() {}, setForcedZone() {},
            });
        });
        for (const effect of rt.pendingEffects()) effect();
    } finally {
        globalThis.React = real;
    }
};
const request = (req) => {
    answerToolRequest(req, {
        tree: dock.treeRef.current, floats: floating.floatsRef.current,
        floatWins: floating.floatWinsRef.current, openTool: dock.openTool,
    });
    render();
};
const openDesign = () => request({ toolId: 'design-editor', focusExisting: true });
const editors = () => [...tabsIn(dock.tree), ...floating.floats].filter(tab => tab.toolId === 'design-editor').map(tab => tab.id);

const editor = { id: 'editor', title: 'Design Editor', toolId: 'design-editor' };
render();
dock.setTree(makeGroup([editor, { id: 'evaluation', title: 'Optical Evaluation', toolId: 'optical-eval' }]));
render();
floating.tearOff(editor, { x: 900, y: 300 }, { width: 700, height: 500 });
render();
const focused = [];
floating.floatWinsRef.current.set('editor', { focus: () => focused.push('editor') });

openDesign();
assert.deepEqual(editors(), ['editor'], 'opening a design with the Design Editor torn off docks no second one');
assert.deepEqual(focused, ['editor'], 'and brings the torn-off window forward');

request({ toolId: 'design-editor' });
const docked = tabsIn(dock.tree).find(tab => tab.toolId === 'design-editor');
assert.ok(docked && editors().length === 2, 'the ribbon still docks a second Design Editor while one is torn off');

request({ toolId: 'optical-eval', focusExisting: true });
const group = dock.tree.type === 'tabs' ? dock.tree : null;
assert.ok(group && group.tabs[group.activeTab].toolId === 'optical-eval', 'with another tab in front of the docked one');
openDesign();
assert.equal(editors().length, 2, 'opening a design then opens nothing');
assert.equal(group.tabs.length, dock.tree.tabs.length, 'and adds no tab');
assert.equal(dock.tree.tabs[dock.tree.activeTab].id, docked.id, 'it brings the docked Design Editor to the front, as before');
assert.deepEqual(focused, ['editor'], 'and leaves the torn-off window where it is');

console.log('explorer_open_design: passed');
