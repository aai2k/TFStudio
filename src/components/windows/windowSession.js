/**
 * Per-window session state — controls that outlive a remount.
 *
 * Only the active tab of a dock group is mounted, so switching tabs, moving a
 * window between groups, or closing and reopening it unmounts the component and
 * discards every `useState` it held. Controls kept in React state alone
 * therefore snap back to their defaults after a layout change, which loses the
 * ranges, modes and toggles the user selected.
 *
 * A store created here lives at module scope, so it outlives any number of
 * remounts and is shared by every mount of that window. It lasts for the app
 * session only: nothing is written to disk, and a restart starts from the
 * defaults. Settings that must survive a restart use `usePersistentState`
 * instead.
 *
 * Two kinds of state belong in a store: the user's control values, and results
 * that came from an explicit run and would otherwise have to be recomputed by
 * hand. Results an effect recomputes on mount do not belong here, and neither
 * does transient UI state (hover, open menus, input buffers, progress flags),
 * which is meant to reset.
 *
 * Design scoping
 * --------------
 * `scope: 'design'` keeps one slot per design id, so switching designs and
 * coming back restores what that design had. `scope: 'shared'` (the default)
 * keeps a single slot for all designs.
 *
 * Either way, values whose meaning depends on the design must not carry across
 * a design change. `onDesignChange(design, current)` returns a patch applied
 * when the design id changes: use it to reseed those keys from the new design
 * and to drop stale results. Display preferences left out of the patch are
 * preserved, which is the rule the windows are expected to follow.
 *
 * `normalize(state)` runs on every read and write and enforces invariants
 * between keys — combinations that are unreachable through the UI but could be
 * produced by a patch that sets one key without the other.
 *
 * Defaults a store cannot build
 * -----------------------------
 * Some defaults depend on values the store never sees, such as the evaluation
 * mode or the configured palette. Those keys start `null` here and the window
 * substitutes a default while the stored value is still empty. Memoise that
 * substitution: an unmemoised fallback allocates a new object on every render,
 * which invalidates every memo and effect keyed on it, and loops outright where
 * one of them sets state.
 */

const identity = state => state;
const noPatch = () => null;

/**
 * Create a session store for one window.
 *
 * @param {object} defaults           Initial values. Every key the window keeps
 *                                    across a remount must appear here.
 * @param {object} [options]
 * @param {'shared'|'design'} [options.scope]
 *        `'design'` keeps one slot per design id; `'shared'` keeps one slot for
 *        all designs. Default `'shared'`.
 * @param {(design: object, current: object) => (object|null)} [options.onDesignChange]
 *        Patch applied when the design id changes. Return `null` to keep the
 *        current values.
 * @param {(state: object) => object} [options.normalize]
 *        Invariant applied on every read and write.
 * @returns {{read: Function, write: Function, reset: Function}}
 */
export function createWindowSession(defaults, options = {}) {
    const { scope = 'shared', onDesignChange = noPatch, normalize = identity } = options;
    const base = Object.freeze({ ...defaults });
    const slots = new Map();
    // A design-scoped store keys its slots by design id; a shared store keeps
    // everything in one slot, so the key is constant.
    const SHARED_KEY = Symbol('shared');
    let lastDesignId;

    const slotKey = design => (scope === 'design' ? (design?.id ?? null) : SHARED_KEY);

    function slotFor(design) {
        const key = slotKey(design);
        if (!slots.has(key)) slots.set(key, normalize({ ...base }));
        return key;
    }

    /**
     * Current values for `design`, applying `onDesignChange` the first time a
     * new design id is seen. Returns a copy: callers hold it in React state and
     * must not mutate the store.
     */
    function read(design) {
        const key = slotFor(design);
        const designId = design?.id ?? null;
        if (designId !== lastDesignId) {
            lastDesignId = designId;
            const patch = onDesignChange(design, slots.get(key));
            if (patch) slots.set(key, normalize({ ...slots.get(key), ...patch }));
        }
        return { ...slots.get(key) };
    }

    /** Merge `patch` into the slot for `design` and return the new values. */
    function write(design, patch) {
        const key = slotFor(design);
        slots.set(key, normalize({ ...slots.get(key), ...patch }));
        return { ...slots.get(key) };
    }

    // Closing a design drops its slot, so a design-scoped store does not hold a
    // result for every design opened during the session.
    if (scope === 'design' && typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('tfstudio:design-evict', event => {
            const id = event.detail?.id;
            if (id == null) return;
            slots.delete(id);
            if (lastDesignId === id) lastDesignId = undefined;
        });
    }

    /** Drop stored values, for `design` alone or for every design. */
    function reset(design) {
        if (arguments.length === 0) {
            slots.clear();
            lastDesignId = undefined;
            return { ...base };
        }
        const key = slotKey(design);
        slots.delete(key);
        return { ...slots.get(slotFor(design)) };
    }

    return { read, write, reset };
}

/**
 * Bind a store to a component, so its controls survive a remount.
 *
 * Returns `[state, setField, patch]`. `setField(key, value)` takes a value or an
 * updater, matching `useState`; `patch(object)` sets several keys at once, for
 * changes that must land together to keep an invariant.
 */
export function useWindowSession(store, design) {
    // Read off the global inside the hook rather than at module load, so a store
    // definition stays importable from a plain Node test with no React present.
    const { useCallback, useEffect, useState } = React;
    const [state, setState] = useState(() => store.read(design));

    const patch = useCallback(next => {
        setState(current => store.write(design, typeof next === 'function' ? next(current) : next));
    }, [store, design]);

    const setField = useCallback((key, value) => {
        setState(current => store.write(design, {
            [key]: typeof value === 'function' ? value(current[key]) : value,
        }));
    }, [store, design]);

    // Re-reads on a design change so `onDesignChange` reseeds the design-dependent
    // keys. Keyed on the id rather than the object: a design edit keeps the
    // controls as they are, only selecting a different design reseeds them.
    useEffect(() => {
        setState(store.read(design));
    }, [store, design?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    return [state, setField, patch];
}
