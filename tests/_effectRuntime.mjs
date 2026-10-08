/**
 * A stand-in for React that runs effects, for hooks whose behaviour lives in
 * them: a worker started and terminated, a store subscribed to.
 *
 * After each render the effects whose dependencies changed run in the order
 * declared, each after its previous cleanup; `run` renders again until no state
 * changes, and `unmount` runs every cleanup and forgets the slots, as for a
 * component taken out of the tree. A context is an object whose `value` the
 * test sets. Install it as the global React before importing the module under
 * test, since a window module reads `React` at its top level.
 *
 * _hookHarness.mjs is the other kind: it records effects without running them.
 */
export function makeEffectRuntime() {
    let slots = [];
    let cursor = 0;
    let pending = [];
    let dirty = false;
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const slot = make => {
        const i = cursor++;
        if (slots.length <= i) slots[i] = make();
        return slots[i];
    };
    return {
        createContext: value => ({ value, Provider: 'Provider' }),
        useContext: context => context.value,
        createElement: () => null,
        useState(initial) {
            const s = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
            return [s.value, next => {
                s.value = typeof next === 'function' ? next(s.value) : next;
                dirty = true;
            }];
        },
        useRef: initial => slot(() => ({ current: initial })),
        useMemo(fn, deps) {
            const s = slot(() => ({}));
            if (!same(s.deps, deps)) { s.value = fn(); s.deps = deps; }
            return s.value;
        },
        useCallback(fn, deps) {
            const s = slot(() => ({}));
            if (!same(s.deps, deps)) { s.value = fn; s.deps = deps; }
            return s.value;
        },
        useEffect(fn, deps) {
            const s = slot(() => ({}));
            if (deps && same(s.deps, deps)) return;
            s.deps = deps;
            pending.push(() => { s.cleanup?.(); s.cleanup = fn(); });
        },
        run(render) {
            let renders = 0;
            do {
                dirty = false;
                cursor = 0;
                pending = [];
                render();
                pending.splice(0).forEach(effect => effect());
                if (++renders >= 30) throw new Error('the hook never settles');
            } while (dirty);
        },
        unmount() {
            slots.forEach(s => s?.cleanup?.());
            slots = [];
        },
    };
}
