/**
 * With no design open, windows get a placeholder that nothing keeps.
 *
 * At startup, and after the open design is deleted, the explorer has no active
 * design, yet every window can still be opened from the ribbon and still offers
 * its imports and edits. The provider hands those windows a placeholder, ignores
 * every write to it and reports `hasActiveDesign` false, which is what an import
 * window checks before it writes. A write made then must not reach the store,
 * push an undo step, land in a design of the provider's own that the windows
 * then show, or turn up in the first design the user opens.
 *
 * Drives the real DesignProvider with the props App.js passes it.
 *
 * Run: node tests/design_no_selection.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();

const runtime = makeHookRuntime();
Object.assign(runtime.React, { createElement: React.createElement, createContext: React.createContext });
const { DesignProvider } = await importWithHookRuntime('../src/state/DesignContext.js', runtime);

// The app's design store, reduced to what the provider talks to: the designs,
// and a record of every write, checkpoint and history jump that reaches it.
const app = {
    designs: {},
    activeDesignId: null,
    changes: [], checkpoints: [], jumps: [],
};
const appProps = () => ({
    activeDesignId: app.activeDesignId,
    designs: app.designs,
    folders: [],
    onDesignChange: (id, design) => {
        app.changes.push(id);
        app.designs = { ...app.designs, [id]: design };
    },
    onCheckpoint: id => app.checkpoints.push(id),
    historyView: { entries: [], currentIndex: -1 },
    onJumpToHistory: index => app.jumps.push(index),
});

// One render of the provider, as the app would draw it after the last change,
// returning what windows read from it. The slots persist between calls, so this
// is one mounted provider rendered again and again. The provider reads some
// hooks off React at call time, so the harness stands in for React meanwhile.
function render() {
    const real = globalThis.React;
    globalThis.React = runtime.React;
    try { return runtime.render(() => DesignProvider(appProps())).props.value; } finally { globalThis.React = real; }
}

// Every write a window can make, each on a fresh render as a user's clicks are.
function writeEverything(layerId) {
    render().updateDesign({
        frontLayers: [
            { id: 'imp1', material: 'TiO2', thickness: 60, locked: false },
            { id: 'imp2', material: 'SiO2', thickness: 95, locked: false },
        ],
    });
    render().updateLayer('front', layerId, { thickness: 123 });
    render().duplicateLayer('front', layerId);
    render().moveLayer('front', layerId, 'down');
    render().removeLayer('front', layerId);
    render().checkpoint();
    render().jumpToHistory(0);
}

// ── Startup: nothing selected ───────────────────────────────────────────────
const atStartup = render();
assert.equal(atStartup.hasActiveDesign, false, 'with nothing selected there is no active design');
assert.equal(atStartup.activeDesignId, null, 'and no active id');
assert.ok(atStartup.design && Array.isArray(atStartup.design.frontLayers) && Array.isArray(atStartup.design.backLayers),
    'windows are still given a design to draw');
const placeholderId = atStartup.design.id;

writeEverything('imp1');
const afterWrites = render();
assert.deepEqual(app.changes, [], 'no write reaches the store');
assert.deepEqual(app.checkpoints, [], 'no undo checkpoint is pushed, not even for a null id');
assert.deepEqual(app.jumps, [], 'no history jump is made');
assert.deepEqual(app.designs, {}, 'the store holds no design');
assert.equal(afterWrites.design.frontLayers.length, 0, 'the windows go on showing a bare placeholder: the import landed nowhere');
assert.equal(afterWrites.hasActiveDesign, false, 'and still report no active design');
assert.equal(afterWrites.getDesignRevision(), 0, 'no edit is counted');
assert.equal(afterWrites.design.id, placeholderId, 'the placeholder keeps one id, so window state keyed on it stays put');

// ── The user opens a design ─────────────────────────────────────────────────
const opened = {
    id: 'd1', name: 'Opened', surfaceMode: 'front_only', mfEvalMode: 'side',
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [
        { id: 'f1', material: 'Ta2O5', thickness: 40, locked: false },
        { id: 'f2', material: 'MgF2', thickness: 88, locked: false },
    ],
    backLayers: [],
    referenceWavelength: 550,
};
app.designs = { d1: opened };
app.activeDesignId = 'd1';

const open = render();
assert.equal(open.hasActiveDesign, true, 'an open design is an active one');
assert.equal(open.activeDesignId, 'd1', 'with its id');
assert.equal(open.design, opened, 'windows get the stored design');
assert.notEqual(open.design.id, placeholderId, 'under an id of its own');

open.updateLayer('front', 'f1', { thickness: 41 });
assert.deepEqual(app.changes, ['d1'], 'a layer edit reaches the store for that design');
assert.equal(app.designs.d1.frontLayers[0].thickness, 41, 'with the edit in it');

render().updateDesign({ notes: 'checked' });
render().duplicateLayer('front', 'f1');
render().moveLayer('front', 'f2', 'up');
render().removeLayer('front', 'f1');
assert.equal(app.changes.length, 5, 'every kind of write reaches the store');
assert.ok(app.changes.every(id => id === 'd1'), 'and only for the open design');
assert.equal(app.designs.d1.notes, 'checked', 'a design-level edit lands');
assert.deepEqual(app.designs.d1.frontLayers.map(l => l.material), ['MgF2', 'Ta2O5'],
    'duplicate, move and remove land in order');

render().checkpoint();
render().jumpToHistory(0);
assert.deepEqual(app.checkpoints, ['d1'], 'a checkpoint is pushed for the open design');
assert.deepEqual(app.jumps, [0], 'and a history jump goes through');
assert.ok(render().getDesignRevision() > 0, 'edits to it are counted');

// ── The design is deleted: nothing selected again ───────────────────────────
app.designs = {};
app.activeDesignId = null;
const closed = render();
assert.equal(closed.hasActiveDesign, false, 'with the open design gone there is no active design again');
assert.equal(closed.design.id, placeholderId, 'the windows are back on the same placeholder');
assert.equal(closed.design.frontLayers.length, 0, 'still bare');
const changesBefore = app.changes.length;
writeEverything('imp2');
assert.equal(app.changes.length, changesBefore, 'and writes are ignored again');
assert.deepEqual(app.checkpoints, ['d1'], 'with no checkpoint pushed');

console.log('PASS: design_no_selection');
