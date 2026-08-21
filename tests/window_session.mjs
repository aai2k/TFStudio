/**
 * Shared window-session store — the state-lifetime rule every window follows.
 *
 * Only the active tab of a dock group is mounted, so a tab switch, a dock move
 * and a close/reopen all unmount the window. These cases assert what a store
 * must carry across that unmount and what it must reseed, independently of any
 * one window's controls.
 *
 * Run: node tests/window_session.mjs
 */

import assert from 'node:assert/strict';
import {
    applySavedWindowDefaults, createWindowSession, windowSessionStores,
} from '../src/components/windows/windowSession.js';

const designA = { id: 'design-a', referenceWavelength: 625 };
const designB = { id: 'design-b', referenceWavelength: 780 };

// ── Controls survive a remount ────────────────────────────────────────────────
{
    const store = createWindowSession({ lamStart: 400, lamEnd: 800, showTable: false });

    assert.deepEqual(store.read(designA), { lamStart: 400, lamEnd: 800, showTable: false },
        'a first read returns the defaults');

    store.write(designA, { lamStart: 610, showTable: true });

    // A remount calls read() again with no memory of the unmounted component.
    assert.deepEqual(store.read(designA), { lamStart: 610, lamEnd: 800, showTable: true },
        'values set before an unmount are still there after it');
}

// ── A returned snapshot cannot mutate the store ──────────────────────────────
{
    const store = createWindowSession({ quantity: 'gd' });
    const snapshot = store.read(designA);
    snapshot.quantity = 'phase';
    assert.equal(store.read(designA).quantity, 'gd',
        'callers hold a copy, so writing to it does not reach the store');

    const written = store.write(designA, { quantity: 'tod' });
    written.quantity = 'phase';
    assert.equal(store.read(designA).quantity, 'tod',
        'the value returned from a write is a copy too');
}

// ── A design change reseeds only design-dependent keys ───────────────────────
{
    const store = createWindowSession({ refLam: 550, showTable: false, lamStart: 400 }, {
        onDesignChange: design => ({ refLam: design?.referenceWavelength || 550 }),
    });

    store.read(designA);
    store.write(designA, { showTable: true, lamStart: 610 });

    const afterSwitch = store.read(designB);
    assert.equal(afterSwitch.refLam, 780, 'a design-dependent key is reseeded from the new design');
    assert.equal(afterSwitch.showTable, true, 'a display preference survives a design change');
    assert.equal(afterSwitch.lamStart, 610, 'an unrelated control survives a design change');

    // Re-reading the same design must not reseed again, or a control the user
    // changed after selecting the design would be overwritten on every remount.
    store.write(designB, { refLam: 900 });
    assert.equal(store.read(designB).refLam, 900,
        'reseeding happens on a design change, not on every read');
}

// ── normalize() holds an invariant on read and on write ──────────────────────
{
    const store = createWindowSession({ target: 'T', side: 'total' }, {
        normalize: state => (state.target === 'R' && state.side === 'total'
            ? { ...state, side: 'front' }
            : state),
    });

    assert.equal(store.write(designA, { target: 'R' }).side, 'front',
        'a write that breaks the invariant is corrected');

    const seeded = createWindowSession({ target: 'R', side: 'total' }, {
        normalize: state => (state.target === 'R' && state.side === 'total'
            ? { ...state, side: 'front' }
            : state),
    });
    assert.equal(seeded.read(designA).side, 'front',
        'defaults that break the invariant are corrected on the first read');
}

// ── scope: 'design' keeps one slot per design ────────────────────────────────
{
    const store = createWindowSession({ nTrials: 200, result: null }, { scope: 'design' });

    store.read(designA);
    store.write(designA, { nTrials: 500, result: 'A' });
    store.read(designB);
    store.write(designB, { nTrials: 50, result: 'B' });

    assert.equal(store.read(designA).nTrials, 500, 'each design keeps its own settings');
    assert.equal(store.read(designA).result, 'A', 'each design keeps its own run result');
    assert.equal(store.read(designB).result, 'B');
}

// ── scope: 'shared' keeps one slot for every design ──────────────────────────
{
    const store = createWindowSession({ materialId: 'builtin:SiO2' });
    store.write(designA, { materialId: 'builtin:TiO2' });
    assert.equal(store.read(designB).materialId, 'builtin:TiO2',
        'a window whose controls do not depend on the design keeps one slot');
}

// ── reset() ──────────────────────────────────────────────────────────────────
{
    const store = createWindowSession({ nTrials: 200 }, { scope: 'design' });
    store.write(designA, { nTrials: 500 });
    store.write(designB, { nTrials: 50 });

    store.reset(designA);
    assert.equal(store.read(designA).nTrials, 200, 'reset(design) clears that design');
    assert.equal(store.read(designB).nTrials, 50, 'reset(design) leaves other designs alone');

    store.reset();
    assert.equal(store.read(designB).nTrials, 200, 'reset() clears every design');
}

// ── Closing a design drops its slot ──────────────────────────────────────────
{
    const listeners = [];
    globalThis.window = {
        addEventListener: (name, fn) => { if (name === 'tfstudio:design-evict') listeners.push(fn); },
    };
    const store = createWindowSession({ result: null }, { scope: 'design' });
    delete globalThis.window;

    store.write(designA, { result: 'A' });
    store.write(designB, { result: 'B' });
    assert.equal(listeners.length, 1, 'a design-scoped store listens for evictions');

    listeners[0]({ detail: { id: 'design-a' } });
    assert.equal(store.read(designA).result, null, 'the closed design is dropped');
    assert.equal(store.read(designB).result, 'B', 'other designs are untouched');
}

// ── A shared store does not listen for evictions ─────────────────────────────
{
    const listeners = [];
    globalThis.window = {
        addEventListener: (name, fn) => { if (name === 'tfstudio:design-evict') listeners.push(fn); },
    };
    createWindowSession({ unit: 'nm' });
    delete globalThis.window;
    assert.equal(listeners.length, 0,
        'a shared store has one slot for every design, so there is nothing to evict');
}

// ── A window with no design still works ──────────────────────────────────────
{
    const store = createWindowSession({ start: 400 }, {
        onDesignChange: design => ({ start: design?.referenceWavelength || 400 }),
    });
    assert.equal(store.read(null).start, 400, 'a null design falls back to the defaults');
    store.write(null, { start: 500 });
    assert.equal(store.read(null).start, 500, 'a null design still keeps its controls');
}

// ── Saved defaults replace the shipped ones ──────────────────────────────────
{
    const store = createWindowSession({ lamStart: 400, lamEnd: 800, result: null }, {
        id: 'test-saved',
        savable: ['lamStart', 'lamEnd'],
    });

    assert.deepEqual(windowSessionStores('test-saved'), [store],
        'a store with an id can be found by the window that owns it');

    applySavedWindowDefaults({ 'test-saved': { lamStart: 8000, lamEnd: 12000 } });
    assert.deepEqual(store.read(designA), { lamStart: 8000, lamEnd: 12000, result: null },
        'a window opens on the saved range rather than the shipped one');

    assert.deepEqual(store.savableValues(designA), { lamStart: 8000, lamEnd: 12000 },
        'savableValues reports the settings and not the result');

    store.rebase({}, { force: true });
    assert.deepEqual(store.read(designA), { lamStart: 400, lamEnd: 800, result: null },
        'Restore puts the shipped values back');
}

// ── A late file read does not pull controls out from under the user ──────────
{
    const store = createWindowSession({ lamStart: 400, result: null }, {
        id: 'test-late',
        savable: ['lamStart'],
    });

    // A restored layout can mount the window before the preferences file lands.
    store.write(designA, { lamStart: 633, result: 'measured' });
    applySavedWindowDefaults({ 'test-late': { lamStart: 8000 } });

    assert.equal(store.read(designA).lamStart, 633,
        'what the user typed wins over the file that arrived after they typed it');
    assert.equal(store.reset().lamStart, 8000,
        'but the saved value is what a fresh slot starts from');
}

// ── Restore keeps a result that took minutes to compute ──────────────────────
{
    const store = createWindowSession({ nTrials: 200, result: null }, {
        id: 'test-result', scope: 'design', savable: ['nTrials'],
    });

    store.write(designA, { nTrials: 500, result: { yield: 0.9 } });
    store.rebase({}, { force: true });

    const after = store.read(designA);
    assert.equal(after.nTrials, 200, 'the setting goes back to the shipped value');
    assert.deepEqual(after.result, { yield: 0.9 },
        'the run itself is not a setting, so Restore leaves it alone');
}

// ── An object saved by an older release keeps fields added since ─────────────
{
    const store = createWindowSession({
        sweep: { param: 'globalThicknessScale', from: 0.95, to: 1.05, offsetUnit: 'nm' },
    }, { id: 'test-object', savable: ['sweep'] });

    applySavedWindowDefaults({ 'test-object': { sweep: { param: 'globalDeltaN', from: -0.02 } } });

    assert.deepEqual(store.read(designA).sweep,
        { param: 'globalDeltaN', from: -0.02, to: 1.05, offsetUnit: 'nm' },
        'a saved object is merged over the shipped one, so a new field is not left undefined');
}

// ── A key left out of `savable` is never written or restored ─────────────────
{
    const store = createWindowSession({ mode: 'relative', side: 'front' }, {
        id: 'test-partial', savable: ['mode'],
    });

    store.write(designA, { side: 'back' });
    applySavedWindowDefaults({ 'test-partial': { mode: 'absolute', side: 'total' } });

    assert.equal(store.read(designA).side, 'back',
        'a key the window does not save cannot be set from the file either');
    assert.deepEqual(store.savableValues(designA), { mode: 'relative' });
}

console.log('window_session: passed');
