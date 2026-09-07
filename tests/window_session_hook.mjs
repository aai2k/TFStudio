/**
 * `useWindowSession` writes the store at the call, not inside a setState updater.
 *
 * A write tells every other mount of the same store to re-read itself. React
 * runs a state updater during the render pass, so a write from inside one lands
 * as one component setting state on another mid-render: opening the material
 * picker selects its layer row, and the console filled with "Cannot update
 * DesignEditor while rendering LayerList" because the Design Editor mounts the
 * same store as its layer list.
 * Run: node tests/window_session_hook.mjs
 */
import assert from 'node:assert/strict';
import { createWindowSession, useWindowSession } from '../src/components/windows/windowSession.js';

// Just enough React to run the hook once and record what it hands setState.
function fakeReact() {
    const slots = [];
    const setStateCalls = [];
    let cursor = 0;
    const slotAt = make => {
        const index = cursor++;
        if (slots.length <= index) slots[index] = make();
        return slots[index];
    };
    return {
        setStateCalls,
        reset: () => { cursor = 0; },
        useState(initial) {
            const slot = slotAt(() => ({
                value: typeof initial === 'function' ? initial() : initial,
            }));
            const set = next => {
                setStateCalls.push(next);
                slot.value = typeof next === 'function' ? next(slot.value) : next;
            };
            return [slot.value, set];
        },
        useCallback: fn => fn,
        useEffect: () => {},
    };
}

const real = globalThis.React;
const runtime = fakeReact();
globalThis.React = runtime;

const store = createWindowSession({ side: 'front', open: true, params: { lam: 550 } });

// A second mount of the same store, standing in for the Design Editor beside
// its layer list. It re-reads whenever the store is written.
const notified = [];
store.subscribe(() => notified.push('read'));

let session = useWindowSession(store, null);
const [, setField, patch] = session;

// ── Neither setter hands React a function ───────────────────────────────────
{
    setField('side', 'back');
    patch({ open: false });
    setField('params', prev => ({ ...prev, lam: 632 }));
    patch(prev => ({ ...prev, side: prev.side === 'back' ? 'front' : 'back' }));

    assert.equal(runtime.setStateCalls.length, 4);
    for (const call of runtime.setStateCalls) {
        assert.notEqual(typeof call, 'function',
            'setState is given the written values, so no other mount is told to update from inside an updater');
    }
}

// ── The values written are still the right ones ─────────────────────────────
{
    const now = store.peek(null);
    assert.equal(now.side, 'front', 'the functional patch read the value the field setter had just written');
    assert.equal(now.open, false);
    assert.deepEqual(now.params, { lam: 632 }, 'a functional field setter merges into the stored object');
    assert.equal(notified.length, 4, 'every write reached the other mount');
    assert.deepEqual(runtime.setStateCalls[runtime.setStateCalls.length - 1], now,
        'and the state React is given is what the store now holds');
}

// ── A functional setter reads the store, not stale React state ──────────────
// Two calls in one handler: the second must see what the first wrote, even
// though React has not re-rendered in between.
{
    store.write(null, { count: 0 });
    runtime.reset();
    session = useWindowSession(store, null);
    const [, field] = session;
    field('count', n => n + 1);
    field('count', n => n + 1);
    assert.equal(store.peek(null).count, 2, 'the second call reads the first call\'s write');
}

globalThis.React = real;
console.log('window_session_hook: passed');
