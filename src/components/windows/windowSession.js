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
 * remounts and is shared by every mount of that window.
 *
 * Saved defaults
 * --------------
 * A store that declares an `id` and a `savable` key list can start from values
 * the user saved rather than from the shipped ones. The saved values are read
 * from the preferences file at startup and handed to `applySavedWindowDefaults`;
 * `savable` is what the window's Save button writes back, so results,
 * work-in-progress and anything `onDesignChange` reseeds are left out of it.
 * Everything else in a store is session-only and a restart starts it from the
 * shipped value.
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
const isPlainObject = value =>
    !!value && typeof value === 'object' && !Array.isArray(value);

// Stores that declared an id, so the saved defaults for a window can be applied
// to it and its current values collected when the user saves. A window may
// register more than one store, which is why the value is a list.
const registered = new Map();
const listeners = new Set();

/** Run `fn` whenever the saved defaults are applied, so open windows re-read. */
export function onSavedWindowDefaults(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Stores registered under one window id. */
export function windowSessionStores(windowId) {
    return registered.get(windowId) || [];
}

/**
 * Adopt the saved defaults for every registered window.
 *
 * @param {object} block  windowId → { key: value }, as held in the preferences
 *                        file. A window missing from it goes back to shipped.
 */
export function applySavedWindowDefaults(block) {
    for (const [windowId, stores] of registered) {
        for (const store of stores) store.rebase(block?.[windowId] || {});
    }
    for (const fn of listeners) fn();
}

/**
 * Put one window's stores back to `values`, overriding what the user has set in
 * the window itself.
 *
 * `applySavedWindowDefaults` deliberately leaves a store the user has already
 * used alone: a value configured in Settings is what the window opens with at
 * the next launch, not something that reaches back into a window in use.
 * Restore is the exception, because it is pressed inside the window it applies
 * to and has to be visible there.
 */
export function resetWindowSessions(windowId, values) {
    for (const store of windowSessionStores(windowId)) {
        store.rebase(values || {}, { force: true });
    }
    for (const fn of listeners) fn();
}

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
 * @param {string} [options.id]
 *        Window id this store belongs to. Required for saved defaults.
 * @param {string[]} [options.savable]
 *        Keys the window's Save button writes to the preferences file.
 * @returns {{read: Function, write: Function, reset: Function}}
 */
export function createWindowSession(defaults, options = {}) {
    const {
        scope = 'shared', onDesignChange = noPatch, normalize = identity,
        id = null, savable = [],
    } = options;
    // What the release ships with, kept apart from `base` so Restore has
    // something to go back to after saved defaults have been adopted.
    const shipped = Object.freeze({ ...defaults });
    let base = shipped;
    // A store the user has already changed keeps what they set: the preferences
    // file is read a moment after startup, and a window opened from a restored
    // layout must not have its controls pulled out from under it.
    let touched = false;
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

    // Mounts told after every write, so two windows open on the same values,
    // the Monitor Worksheet and the Process Exporter on one chip plan, show
    // the same thing.
    const subscribers = new Set();
    function subscribe(fn) {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
    }

    /** Merge `patch` into the slot for `design` and return the new values. */
    function write(design, patch) {
        const key = slotFor(design);
        touched = true;
        slots.set(key, normalize({ ...slots.get(key), ...patch }));
        for (const fn of subscribers) fn();
        return { ...slots.get(key) };
    }

    function pickSavable(state) {
        const out = {};
        for (const key of savable) {
            if (Object.prototype.hasOwnProperty.call(state, key)) out[key] = state[key];
        }
        return out;
    }

    // A saved value that is a plain object is merged over the shipped one rather
    // than replacing it, so a file written before a release added a field to that
    // object does not leave the field undefined.
    function adoptSavable(values) {
        const out = pickSavable(values);
        for (const [key, value] of Object.entries(out)) {
            if (isPlainObject(value) && isPlainObject(shipped[key])) {
                out[key] = { ...shipped[key], ...value };
            }
        }
        return out;
    }

    /** The values a Save would write: this store's savable keys, as shown now. */
    function savableValues(design) {
        return pickSavable(read(design));
    }

    /**
     * Start from `values` instead of the shipped defaults.
     *
     * Existing slots are patched rather than cleared, so a result already on
     * screen and the keys `onDesignChange` seeded from the design survive.
     * `force` is for Restore, which has to reach a store the user has changed.
     */
    function rebase(values, { force = false } = {}) {
        base = Object.freeze(normalize({ ...shipped, ...adoptSavable(values || {}) }));
        if (!force && touched) return;
        const patch = pickSavable(base);
        for (const [key, state] of slots) slots.set(key, normalize({ ...state, ...patch }));
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

    const store = { read, write, reset, subscribe, id, savableKeys: savable, savableValues, rebase };
    if (id) registered.set(id, [...windowSessionStores(id), store]);
    return store;
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

    // Another mount of the same store wrote to it: re-read, so two windows on
    // one value never disagree.
    useEffect(
        () => store.subscribe(() => setState(store.read(design))),
        [store, design?.id], // eslint-disable-line react-hooks/exhaustive-deps
    );

    // Saving or restoring the window's defaults rebases the store underneath an
    // open window, and the preferences file arrives shortly after startup.
    useEffect(
        () => onSavedWindowDefaults(() => setState(store.read(design))),
        [store, design?.id], // eslint-disable-line react-hooks/exhaustive-deps
    );

    return [state, setField, patch];
}
