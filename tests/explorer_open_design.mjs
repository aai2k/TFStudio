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
    /openTool\(req\.toolId,\s*\{[^}]*focusExisting:\s*req\.focusExisting/,
    'the docking layout forwards focusExisting from the request');

assert.match(read('components/docking/useDockTree.js'),
    /if\s*\(opts\.focusExisting\)/,
    'and the dock tree activates the open tab instead of adding one');

console.log('explorer_open_design: passed');
