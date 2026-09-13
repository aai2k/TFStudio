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
import {
    createWindowSession, useWatchedSession, useWindowSession,
} from '../src/components/windows/windowSession.js';

// Just enough React to run the hook once and record what it hands setState.
// `runEffects` runs each effect as it is declared and keeps its cleanup, for the
// hooks whose whole behaviour is in an effect.
function fakeReact({ runEffects = false } = {}) {
    const slots = [];
    const setStateCalls = [];
    // What React would actually re-render for. It bails out when the new value
    // is the one already held, so a setState call and a render are not the same
    // event and a hook that guards its own writes has to be judged on this one.
    const renders = [];
    const cleanups = [];
    let cursor = 0;
    const slotAt = make => {
        const index = cursor++;
        if (slots.length <= index) slots[index] = make();
        return slots[index];
    };
    return {
        setStateCalls,
        renders,
        cleanups,
        reset: () => { cursor = 0; },
        useState(initial) {
            const slot = slotAt(() => ({
                value: typeof initial === 'function' ? initial() : initial,
            }));
            const set = next => {
                setStateCalls.push(next);
                const value = typeof next === 'function' ? next(slot.value) : next;
                if (!Object.is(value, slot.value)) renders.push(value);
                slot.value = value;
            };
            return [slot.value, set];
        },
        useCallback: fn => fn,
        useEffect: (fn) => { if (runEffects) cleanups.push(fn()); },
        // No layout around the hook, so the mount belongs to no open copy.
        createContext: value => ({ value }),
        useContext: context => context.value,
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

// ── useWatchedSession follows another window, whichever copy it is ───────────
//
// The Material Editor's working range follows Optical Evaluation, which can be
// open twice. The reader belongs to no copy, so it has to be told about a write
// to ANY of them: subscribing would only hear its own, and the range would
// quietly stop following the window the user is actually typing in.
{
    globalThis.React = fakeReact({ runEffects: true });
    const runtime = globalThis.React;
    const followed = createWindowSession({ lambdaStart: 400, lambdaEnd: 800 });

    const first = useWatchedSession(followed, null);
    assert.deepEqual(first, { lambdaStart: 400, lambdaEnd: 800 },
        'the reader starts on what the window would open with');
    assert.equal(runtime.renders.length, 0,
        'and mounting alone does not re-render: peek hands back a fresh object every '
        + 'time, so an unguarded sync would render every reader twice on every mount');

    // A copy of the window the reader has no connection to.
    followed.write(null, { lambdaStart: 250 }, 'oe-1');
    assert.equal(runtime.renders.length, 1,
        'a write to a copy reaches the reader, which is what watch does and subscribe does not');
    assert.equal(followed.peek(null).lambdaStart, 250);

    // A second copy takes over as the one changed last.
    followed.write(null, { lambdaStart: 1000 }, 'oe-2');
    assert.equal(runtime.renders.length, 2, 'and so does a write to a second copy');
    assert.equal(followed.peek(null).lambdaStart, 1000,
        'the reader follows whichever copy was changed last');

    // A write that changes nothing must not re-render.
    followed.write(null, { lambdaStart: 1000 }, 'oe-2');
    assert.equal(runtime.renders.length, 2,
        'a write that leaves the values as they were does not re-render the reader');

    // Unmounting takes the reader off the store.
    assert.equal(typeof runtime.cleanups[0], 'function',
        'the effect returns the unsubscribe, so unmounting can stop the watch');
    runtime.cleanups[0]();
    followed.write(null, { lambdaStart: 300 }, 'oe-1');
    assert.equal(runtime.renders.length, 2,
        'and after it runs the reader hears nothing more');
}

globalThis.React = real;
console.log('window_session_hook: passed');
