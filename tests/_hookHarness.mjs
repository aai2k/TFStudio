/**
 * A hook runtime small enough to run a hook again and again and watch what it
 * returns.
 *
 * There is no test renderer in the project. The property worth guarding, that a
 * re-render with nothing changed hands the rows the props they already had,
 * only exists across renders, so a single server render cannot see it. This
 * implements the five hooks the table's own hooks use, with slots that persist
 * between renders exactly as React's do.
 *
 * Effects are recorded, not run: every effect in the hooks under test only
 * schedules state, and running them here would mix React's commit rules into a
 * harness whose whole point is to be simple enough to trust.
 *
 * Install it in place of the global React BEFORE importing the module under
 * test, since a window module reads `React` at its top level, and put the real
 * one back afterwards.
 */
const sameDeps = (before, after) =>
    Array.isArray(before) && Array.isArray(after)
    && before.length === after.length
    && before.every((value, index) => Object.is(value, after[index]));

export function makeHookRuntime() {
    const slots = [];
    const effects = [];
    let cursor = 0;

    const slotAt = make => {
        const index = cursor++;
        if (slots.length <= index) slots[index] = make();
        return slots[index];
    };

    const React = {
        // The setter is built once and kept, as React's is. A harness that
        // handed back a fresh one each render would report every consumer of it
        // as having changed, which is the very thing these tests measure.
        useState(initial) {
            const slot = slotAt(() => {
                const made = {
                    value: typeof initial === 'function' ? initial() : initial,
                };
                made.set = next => {
                    made.value = typeof next === 'function' ? next(made.value) : next;
                };
                return made;
            });
            return [slot.value, slot.set];
        },
        useRef(initial) {
            return slotAt(() => ({ current: initial }));
        },
        useMemo(compute, deps) {
            const slot = slotAt(() => ({ deps: null, value: undefined, first: true }));
            if (slot.first || !sameDeps(slot.deps, deps)) {
                slot.value = compute();
                slot.deps = deps;
                slot.first = false;
            }
            return slot.value;
        },
        useCallback(fn, deps) {
            return React.useMemo(() => fn, deps);
        },
        useEffect(fn, deps) {
            const slot = slotAt(() => ({ deps: null, first: true }));
            if (slot.first || !sameDeps(slot.deps, deps)) effects.push(fn);
            slot.deps = deps;
            slot.first = false;
        },
    };
    React.useLayoutEffect = React.useEffect;

    return {
        React,
        /** Run `hook` as one render, returning what it returned. */
        render(hook) {
            cursor = 0;
            effects.length = 0;
            return hook();
        },
        /** The effects this render would have scheduled. */
        pendingEffects: () => [...effects],
    };
}

/**
 * Import a module with the harness installed as the global React, so the
 * `const { useState } = React` a window module runs at load time picks it up.
 * The real React is restored before returning.
 */
export async function importWithHookRuntime(specifier, runtime) {
    const real = globalThis.React;
    globalThis.React = runtime.React;
    try {
        return await import(specifier);
    } finally {
        globalThis.React = real;
    }
}
