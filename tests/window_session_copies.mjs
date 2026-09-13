/**
 * Two windows of the same kind hold two sets of controls.
 *
 * The toolbar opens a second copy of any window and the docking tree holds it as
 * a tab of its own, so comparing two quantities side by side is what opening one
 * twice is for. Every copy therefore reads and writes a slot of its own, and the
 * cases here fix what is per copy and what two windows still share.
 *
 * Run: node tests/window_session_copies.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    applySavedWindowDefaults, createWindowSession, releaseWindowCopy,
    resetWindowSessions,
} from '../src/components/windows/windowSession.js';
import {
    addTab, adoptTabIds, makeGroup, makeSplit, newTabId, tabsIn,
} from '../src/components/docking/treeUtils.js';

const designA = { id: 'design-a', referenceWavelength: 625 };
const designB = { id: 'design-b', referenceWavelength: 780 };

// ── Each copy keeps its own controls ─────────────────────────────────────────
{
    const store = createWindowSession({ quantity: 'gd', side: 'front' });

    store.write(designA, { quantity: 'gdd' }, 'tab-1');

    assert.equal(store.read(designA, 'tab-1').quantity, 'gdd');
    assert.equal(store.read(designA, 'tab-2').quantity, 'gd',
        'the second window stays on what it was showing');

    store.write(designA, { side: 'back' }, 'tab-2');
    assert.equal(store.read(designA, 'tab-1').side, 'front',
        'and the first one is not pulled over by the second either');
}

// ── A write reaches the copy's own mounts, and every watcher ─────────────────
{
    const store = createWindowSession({ result: null });
    const heard = [];
    store.subscribe(() => heard.push('tab-1'), 'tab-1');
    store.subscribe(() => heard.push('tab-2'), 'tab-2');
    store.watch(() => heard.push('report'));

    store.write(designA, { result: 'run' }, 'tab-1');

    assert.deepEqual(heard, ['tab-1', 'report'],
        'the window that was written re-reads, the other copy is left alone, '
        + 'and a window following the run is told either way');
}

// ── copies: shared puts every mount on one slot ──────────────────────────────
{
    const store = createWindowSession({ chipByStep: null }, { copies: 'shared' });

    store.write(designA, { chipByStep: { 1: 'A' } }, 'worksheet-tab');

    assert.deepEqual(store.read(designA, 'process-sim-tab').chipByStep, { 1: 'A' },
        'a worksheet the next window runs is one worksheet, not a copy each');
}

// ── A slot per design, per copy ──────────────────────────────────────────────
{
    const store = createWindowSession({ nTrials: 200, result: null }, { scope: 'design' });

    store.write(designA, { result: 'A1' }, 'tab-1');
    store.write(designB, { result: 'B1' }, 'tab-1');
    store.write(designA, { result: 'A2' }, 'tab-2');

    assert.equal(store.read(designA, 'tab-1').result, 'A1');
    assert.equal(store.read(designB, 'tab-1').result, 'B1');
    assert.equal(store.read(designA, 'tab-2').result, 'A2',
        'switching designs in one window does not reach what the other holds for that design');
}

// ── Each copy reseeds on its own first sight of a design ─────────────────────
{
    const store = createWindowSession({ refLam: 550, quantity: 'gd' }, {
        onDesignChange: design => ({ refLam: design?.referenceWavelength || 550 }),
    });

    store.read(designA, 'tab-1');
    store.write(designA, { quantity: 'gdd' }, 'tab-1');

    assert.equal(store.read(designA, 'tab-2').refLam, 625,
        'a window opened on a design is seeded from it');
    assert.equal(store.read(designB, 'tab-1').refLam, 780,
        'and each copy reseeds when the design it is showing changes');
    assert.equal(store.read(designB, 'tab-1').quantity, 'gdd',
        'while keeping what the user set in that copy');
}

// ── A reader outside the window is shown the copy changed last ───────────────
{
    const store = createWindowSession({ lambdaStart: 400 });

    assert.equal(store.peek(designA).lambdaStart, 400,
        'a window that has not been opened reads as the values it would open with');

    store.write(designA, { lambdaStart: 450 }, 'tab-1');
    store.write(designA, { lambdaStart: 500 }, 'tab-2');
    assert.equal(store.peek(designA).lambdaStart, 500,
        'a report block copies its range from the window the user was working in');

    store.write(designA, { lambdaStart: 480 }, 'tab-1');
    assert.equal(store.peek(designA).lambdaStart, 480);

    // Opening a second window mounts it, which reads the store. Only a change
    // moves the reader: otherwise the report would go blank the moment a second
    // copy of the window it prints was opened.
    store.read(designA, 'tab-3');
    assert.equal(store.peek(designA).lambdaStart, 480,
        'a window merely opened does not take an outside reader off the one in use');

    assert.equal(store.peek(designA, null).lambdaStart, 400,
        'while naming no copy outright is the slot a mount outside the layout reads');
}

// ── Closing a window takes its controls with it ──────────────────────────────
{
    const store = createWindowSession({ side: 'front' });
    store.write(designA, { side: 'back' }, 'tab-1');
    store.write(designA, { side: 'total' }, 'tab-2');

    releaseWindowCopy('tab-2');

    assert.equal(store.peek(designA).side, 'back',
        'an outside reader falls back to a window that is still open');
    assert.equal(store.read(designA, 'tab-1').side, 'back', 'the window still open is untouched');
    assert.equal(store.read(designA, 'tab-2').side, 'front',
        'the closed one leaves nothing behind: tab ids are not reused, so it could not be read again');
}

// ── What the layout reports as open ──────────────────────────────────────────
{
    // Two tabs of one tool in the left pane, only one of them on screen.
    const tree = makeSplit('h', [
        makeGroup([{ id: 't1', toolId: 'gd-gdd' }, { id: 't2', toolId: 'gd-gdd' }]),
        makeGroup([{ id: 't3', toolId: 'optical-eval' }]),
    ]);

    assert.deepEqual(tabsIn(tree).map(tab => tab.id), ['t1', 't2', 't3'],
        'a tab that is open but not showing is still open, and keeps its controls');
    assert.deepEqual(tabsIn(addTab(tree, tree.children[1].id, { id: 't4' })).map(tab => tab.id),
        ['t1', 't2', 't3', 't4'], 'a window opened into a pane joins the list');
    assert.deepEqual(tabsIn(tree).map(tab => tab.toolId),
        ['gd-gdd', 'gd-gdd', 'optical-eval'], 'and the tool list reads the same walk');
    assert.deepEqual(tabsIn(null), [], 'an empty workspace holds no copies');
    assert.notEqual(newTabId(), newTabId(), 'a tab id names one copy and is never reused');
}

// ── A relayout keeps the copies of the tools it leaves open ──────────────
{
    const open = [
        { id: 't1', toolId: 'design-editor' },
        { id: 't2', toolId: 'optical-eval' },
        { id: 't3', toolId: 'optical-eval' },
        { id: 't9', toolId: 'admittance' },
    ];
    // What a preset builds: fresh tabs, none of them the ones on screen.
    const preset = makeSplit('h', [
        makeGroup([{ id: 'p1', toolId: 'design-editor' }]),
        makeGroup([{ id: 'p2', toolId: 'optical-eval' }]),
        makeGroup([{ id: 'p3', toolId: 'gd-gdd' }]),
    ]);

    const adopted = tabsIn(adoptTabIds(preset, open));
    assert.deepEqual(adopted.map(tab => tab.id), ['t1', 't2', 'p3'],
        'a tool the preset keeps open keeps the copy it was showing, and a new one is new');
    assert.deepEqual(adopted.map(tab => tab.toolId),
        ['design-editor', 'optical-eval', 'gd-gdd'], 'and the preset is still the layout');

    const twice = tabsIn(adoptTabIds(makeSplit('h', [
        makeGroup([{ id: 'q1', toolId: 'optical-eval' }]),
        makeGroup([{ id: 'q2', toolId: 'optical-eval' }]),
        makeGroup([{ id: 'q3', toolId: 'optical-eval' }]),
    ]), open));
    assert.deepEqual(twice.map(tab => tab.id), ['t2', 't3', 'q3'],
        'each open copy is handed over once, so two windows never land on one set of controls');

    assert.deepEqual(tabsIn(adoptTabIds(preset, [])).map(tab => tab.id), ['p1', 'p2', 'p3'],
        'with nothing open there is nothing to carry over');
}

// ── Saved defaults: what a new copy opens with ───────────────────────────────
{
    const store = createWindowSession({ lambdaStart: 400, result: null }, {
        id: 'test-copies-saved', savable: ['lambdaStart'],
    });

    store.write(designA, { lambdaStart: 633 }, 'tab-1');
    applySavedWindowDefaults({ 'test-copies-saved': { lambdaStart: 8000 } });

    assert.equal(store.read(designA, 'tab-1').lambdaStart, 633,
        'the window the user typed in keeps what they typed');
    assert.equal(store.read(designA, 'tab-2').lambdaStart, 8000,
        'a window opened afterwards starts from the saved value');
}

// ── Restore puts back the copy its button was pressed in ─────────────────────
{
    const store = createWindowSession({ lambdaStart: 400 }, {
        id: 'test-copies-restore', savable: ['lambdaStart'],
    });

    store.write(designA, { lambdaStart: 1064 }, 'tab-1');
    store.write(designA, { lambdaStart: 550 }, 'tab-2');

    assert.deepEqual(store.savableValues(designA, 'tab-2'), { lambdaStart: 550 },
        'Save writes what the copy it was pressed in is set to');

    resetWindowSessions('test-copies-restore', {}, 'tab-2');

    assert.equal(store.read(designA, 'tab-2').lambdaStart, 400, 'that copy goes back to shipped');
    assert.equal(store.read(designA, 'tab-1').lambdaStart, 1064,
        'and the other window is left as the user set it');
}

// ── Restore from a window drawn outside the layout reaches every copy ─────
{
    const store = createWindowSession({ lambdaStart: 400 }, {
        id: 'test-copies-nocopy', savable: ['lambdaStart'],
    });

    store.write(designA, { lambdaStart: 1064 }, 'tab-1');
    store.write(designA, { lambdaStart: 550 }, 'tab-2');

    // No copy around the window, so its Restore button has none to name. Acting
    // on the no-copy slot alone would leave the button doing nothing at all.
    resetWindowSessions('test-copies-nocopy', {}, null);

    assert.equal(store.read(designA, 'tab-1').lambdaStart, 400);
    assert.equal(store.read(designA, 'tab-2').lambdaStart, 400,
        'Restore with no copy to name puts every copy back rather than none');
}

// ── reset() leaves the open windows subscribed ───────────────────────
{
    const store = createWindowSession({ result: null });
    const heard = [];
    store.subscribe(() => heard.push('panel'), 'tab-1');
    store.write(designA, { result: 'first' }, 'tab-1');

    store.reset();

    assert.equal(store.read(designA, 'tab-1').result, null, 'the values are gone');
    store.write(designA, { result: 'second' }, 'tab-1');
    assert.deepEqual(heard, ['panel', 'panel'],
        'and a window still on screen is still told when its store is written');
}

// ── reset(design) drops the slot without arming a reseed ────────────────
{
    const store = createWindowSession({ refLam: 550, nTrials: 200 }, {
        scope: 'design',
        onDesignChange: design => ({ refLam: design?.referenceWavelength || 550 }),
    });

    store.read(designA, 'tab-1');
    store.write(designA, { refLam: 1030, nTrials: 500 }, 'tab-1');

    store.reset(designA);

    const after = store.read(designA, 'tab-1');
    assert.equal(after.nTrials, 200, 'the design starts from the shipped values again');
    assert.equal(after.refLam, 550,
        'from the shipped value, not reseeded from a design the window never left');
}

// ── The layout wiring a store cannot reach ───────────────────────────────────
{
    const source = readFileSync(
        new URL('../src/components/docking/DockingLayout.js', import.meta.url), 'utf8');

    assert.match(source, /copyId: tab\.id/,
        'a docked window is drawn as the copy its tab names');
    assert.match(source, /copyId: f\.id/, 'and a torn-off one as the copy it was torn off as');
    assert.match(source, /const tab = \{ id: float\.id,/,
        'docking a float back is the same copy, so its controls come back with it');
    assert.match(source, /releaseWindowCopy\(tabId\)/,
        'closing a tab is what drops a copy, so a relayout that re-keys the tabs does not');
    assert.match(source, /releaseWindowCopy\(floatId\)/,
        'and so is closing a torn-off window, as against docking it back');
    assert.match(source, /adoptTabIds\(next, \[\.\.\.tabsIn\(prev\)/,
        'a preset or a restore carries the open copies onto the tabs it builds');
}

console.log('window_session_copies: passed');
