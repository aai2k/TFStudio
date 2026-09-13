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
 * remounts.
 *
 * One slot per open copy
 * ----------------------
 * The same tool can be open more than once, as two tabs or as a docked window
 * and a torn-off one, and comparing two quantities at once is the reason to open
 * it twice. Each open copy therefore reads and writes a slot of its own:
 * switching one GD/GDD window to GDD leaves the other on GD.
 *
 * A copy is identified by the tab it is drawn in, which the docking layout puts
 * in context around the window (`WindowCopyProvider`). A mount with no copy
 * around it, such as App-level state or a modal, gets a single slot shared by
 * every such mount. A copy is dropped when its window is closed
 * (`releaseWindowCopy`); tab ids are not reused, so nothing could reach it
 * again.
 *
 * `copies: 'shared'` puts every mount on that one slot, for state two different
 * windows are meant to agree on: the Process Simulator and the Report both read
 * the Monitor Worksheet's chip plan, and Spectrum Exchange seeds its export grid
 * from Optical Evaluation's evaluation grid.
 *
 * A window reading another window's store does so through `peek` and `watch`,
 * which are shown the copy the user changed last.
 *
 * Saved defaults
 * --------------
 * A store that declares an `id` and a `savable` key list can start from values
 * the user saved rather than from the shipped ones. The saved values are read
 * from the preferences file at startup and handed to `applySavedWindowDefaults`;
 * `savable` is what the window's Save button writes back, so results,
 * work-in-progress and anything `onDesignChange` reseeds are left out of it.
 * Everything else in a store is session-only and a restart starts it from the
 * shipped value. Save and Restore act on the copy whose button was pressed, and
 * a copy opened afterwards starts from the saved values.
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
 * keeps a single slot for all designs. Either way the slots belong to one copy.
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

// The slot a mount with no copy around it uses, and the one every mount of a
// `copies: 'shared'` store uses.
const NO_COPY = Symbol('no copy');

// ── What a store holds for one open copy ─────────────────────────────────────
//
// A slot per design, the design that slot was last read for, whether the user
// has changed anything in this copy, and the mounts to tell when it is written.

const newCopy = () => ({
    slots: new Map(), lastDesignId: undefined, touched: false, subscribers: new Set(),
});

/** A copy for an outside reader to fall back to when the one it was shown closes. */
function lastOpenKey(copies) {
    let last = NO_COPY;
    for (const key of copies.keys()) last = key;
    return last;
}

/** Empty every copy, leaving the mounts subscribed to them in place. */
function clearCopies(copies) {
    for (const copy of copies.values()) {
        copy.slots.clear();
        copy.lastDesignId = undefined;
        copy.touched = false;
    }
}

/** Drop one slot in every copy. */
function dropSlot(copies, slot) {
    for (const copy of copies.values()) copy.slots.delete(slot);
}

/**
 * Forget a design the user has closed: its slot in every copy, and the marker
 * that would otherwise stop `onDesignChange` reseeding if that design is opened
 * again.
 */
function forgetDesign(copies, designId) {
    dropSlot(copies, designId);
    for (const copy of copies.values()) {
        if (copy.lastDesignId === designId) copy.lastDesignId = undefined;
    }
}

/** Merge `patch` into every slot of one copy. */
function patchSlots(copy, patch, normalize) {
    for (const [key, state] of copy.slots) {
        copy.slots.set(key, normalize({ ...state, ...patch }));
    }
}

/** The keys a window saves as its defaults, taken out of `state`. */
function pickSavable(savable, state) {
    const out = {};
    for (const key of savable) {
        if (Object.prototype.hasOwnProperty.call(state, key)) out[key] = state[key];
    }
    return out;
}

// A saved value that is a plain object is merged over the shipped one rather
// than replacing it, so a file written before a release added a field to that
// object does not leave the field undefined.
function adoptSavable(savable, shipped, values) {
    const out = pickSavable(savable, values);
    for (const [key, value] of Object.entries(out)) {
        if (isPlainObject(value) && isPlainObject(shipped[key])) {
            out[key] = { ...shipped[key], ...value };
        }
    }
    return out;
}

// Stores that declared an id, so the saved defaults for a window can be applied
// to it and its current values collected when the user saves. A window may
// register more than one store, which is why the value is a list.
const registered = new Map();
// Every store, id or not, so the slots of a closed copy can be dropped.
const allStores = new Set();
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
 * Forget what one copy was holding, for a window the user has closed.
 *
 * Closing is the only thing that drops a copy. A relayout that rebuilds the tree
 * gives every tab a new id, and the records the old ids held are left behind
 * rather than cleared: they are a few small objects, and dropping them would put
 * every window the relayout kept open back to its shipped values.
 */
export function releaseWindowCopy(copyId) {
    if (copyId == null) return;
    for (const store of allStores) store.dropCopy(copyId);
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
 * to and has to be visible there. It reaches the copy it was pressed in and no
 * other, for the same reason: a second copy of the window is a separate view
 * and must not snap back under the user.
 */
export function resetWindowSessions(windowId, values, copyId) {
    for (const store of windowSessionStores(windowId)) {
        store.rebase(values || {}, { force: true, copyId });
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
 * @param {'separate'|'shared'} [options.copies]
 *        `'separate'` gives every open copy of the window its own values;
 *        `'shared'` puts every mount on one slot, for state two windows are
 *        meant to agree on. Default `'separate'`.
 * @param {(design: object, current: object) => (object|null)} [options.onDesignChange]
 *        Patch applied when the design id changes. Return `null` to keep the
 *        current values.
 * @param {(state: object) => object} [options.normalize]
 *        Invariant applied on every read and write.
 * @param {string} [options.id]
 *        Window id this store belongs to. Required for saved defaults.
 * @param {string[]} [options.savable]
 *        Keys the window's Save button writes to the preferences file.
 * @returns {{read: Function, peek: Function, write: Function, reset: Function}}
 */
export function createWindowSession(defaults, options = {}) {
    const {
        scope = 'shared', copies = 'separate', onDesignChange = noPatch,
        normalize = identity, id = null, savable = [],
    } = options;
    // What the release ships with, kept apart from `base` so Restore has
    // something to go back to after saved defaults have been adopted.
    const shipped = Object.freeze({ ...defaults });
    let base = shipped;
    // A design-scoped store keys its slots by design id; a shared store keeps
    // everything in one slot, so the key is constant.
    const SHARED_KEY = Symbol('shared');

    const openCopies = new Map();
    // The copy a reader outside the window is shown: the one last written, which
    // with a single copy open is that one. Only a write moves it, so a second
    // window merely being opened does not take the reader off the first.
    let lastCopy = NO_COPY;
    // Mounts of another window watching this store, told after every write
    // whichever copy it landed in: the Report follows the Monte-Carlo run and
    // the chip plan as they are produced.
    const watchers = new Set();

    const copyKey = copyId => (copies === 'shared' || copyId == null ? NO_COPY : copyId);
    const slotKey = design => (scope === 'design' ? (design?.id ?? null) : SHARED_KEY);

    function copyFor(copyId) {
        const key = copyKey(copyId);
        if (!openCopies.has(key)) openCopies.set(key, newCopy());
        return openCopies.get(key);
    }

    function slotFor(copy, design) {
        const key = slotKey(design);
        if (!copy.slots.has(key)) copy.slots.set(key, normalize({ ...base }));
        return key;
    }

    /**
     * Current values for `design` in `copyId`, applying `onDesignChange` the
     * first time that copy sees a new design id. Returns a copy: callers hold it
     * in React state and must not mutate the store.
     */
    function read(design, copyId) {
        const copy = copyFor(copyId);
        const key = slotFor(copy, design);
        const designId = design?.id ?? null;
        if (designId !== copy.lastDesignId) {
            copy.lastDesignId = designId;
            const patch = onDesignChange(design, copy.slots.get(key));
            if (patch) copy.slots.set(key, normalize({ ...copy.slots.get(key), ...patch }));
        }
        return { ...copy.slots.get(key) };
    }

    /**
     * What `read` would return, for a reader other than the window itself:
     * nothing is stored, no slot is created and the design the window last read
     * stays as it was, so the window's own reseeding is undisturbed.
     *
     * Called without a copy argument at all, by a reader in another window, it
     * is shown the copy the user changed last, or the values a window would open
     * with if none is open. Passing `null` is not that: it names the slot a mount
     * outside the layout reads, which is what the hook does.
     */
    function peek(design, copyId) {
        const copy = openCopies.get(arguments.length < 2 ? lastCopy : copyKey(copyId));
        const current = copy?.slots.get(slotKey(design)) || normalize({ ...base });
        const patch = (design?.id ?? null) !== copy?.lastDesignId ? onDesignChange(design, current) : null;
        return patch ? normalize({ ...current, ...patch }) : { ...current };
    }

    /**
     * Told after every write to `copyId`: the window's other mounts, and the
     * mounts of a window that shares the store outright.
     */
    function subscribe(fn, copyId) {
        const { subscribers } = copyFor(copyId);
        subscribers.add(fn);
        return () => subscribers.delete(fn);
    }

    /** Told after every write to any copy, for a window watching another's store. */
    function watch(fn) {
        watchers.add(fn);
        return () => watchers.delete(fn);
    }

    /** Merge `patch` into `copyId`'s slot for `design` and return the new values. */
    function write(design, patch, copyId) {
        const copy = copyFor(copyId);
        const slot = slotFor(copy, design);
        lastCopy = copyKey(copyId);
        copy.touched = true;
        copy.slots.set(slot, normalize({ ...copy.slots.get(slot), ...patch }));
        for (const fn of copy.subscribers) fn();
        for (const fn of watchers) fn();
        return { ...copy.slots.get(slot) };
    }

    /** The values a Save would write: this store's savable keys, as one copy shows them. */
    function savableValues(design, copyId) {
        return pickSavable(savable, read(design, copyId));
    }

    /**
     * Start from `values` instead of the shipped defaults.
     *
     * Existing slots are patched rather than cleared, so a result already on
     * screen and the keys `onDesignChange` seeded from the design survive.
     * `force` is for Restore, which has to reach a copy the user has changed;
     * it names that copy, and leaves the window's other copies alone. No copy
     * named, whether left out or `null`, reaches every copy: a Restore pressed
     * in a window drawn outside the layout has to do something.
     */
    function rebase(values, { force = false, copyId } = {}) {
        base = Object.freeze(normalize({ ...shipped, ...adoptSavable(savable, shipped, values || {}) }));
        const patch = pickSavable(savable, base);
        const only = copyId == null ? null : copyKey(copyId);
        const reaches = (key, copy) =>
            (only === null || key === only) && (force || !copy.touched);
        for (const [key, copy] of openCopies) {
            if (reaches(key, copy)) patchSlots(copy, patch, normalize);
        }
    }

    // Closing a design drops its slot, so a design-scoped store does not hold a
    // result for every design opened during the session.
    if (scope === 'design' && typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('tfstudio:design-evict', event => {
            if (event.detail?.id != null) forgetDesign(openCopies, event.detail.id);
        });
    }

    /**
     * Drop stored values, for `design` in every copy or for everything.
     *
     * The copies themselves stay, emptied: a mount subscribes to the copy it
     * belongs to, and dropping the record would leave every open window holding
     * a subscription nothing writes to.
     */
    function reset(design) {
        if (arguments.length === 0) {
            clearCopies(openCopies);
            return { ...base };
        }
        // The slot alone. `lastDesignId` is left as it is, so a design still on
        // screen is not reseeded from underneath the window showing it.
        dropSlot(openCopies, slotKey(design));
        return read(design);
    }

    /** Forget a closed window's copy, and take any reader off it. */
    function dropCopy(copyId) {
        const key = copyKey(copyId);
        if (key === NO_COPY) return;
        openCopies.delete(key);
        if (lastCopy === key) lastCopy = lastOpenKey(openCopies);
    }

    const store = {
        read, peek, write, reset, subscribe, watch, id, savableKeys: savable,
        savableValues, rebase, dropCopy,
    };
    allStores.add(store);
    if (id) registered.set(id, [...windowSessionStores(id), store]);
    return store;
}

// The open copy a mount belongs to. Created on first use rather than at module
// load, so a store definition stays importable from a plain Node test with no
// React present.
let copyContext = null;
function windowCopyContext() {
    if (!copyContext) copyContext = React.createContext(null);
    return copyContext;
}

/** Draw a window as one open copy, identified by the tab it is drawn in. */
export function WindowCopyProvider({ copyId = null, children }) {
    return React.createElement(windowCopyContext().Provider, { value: copyId }, children);
}

/** Which open copy the calling component belongs to, or `null` outside the layout. */
export function useWindowCopy() {
    return React.useContext(windowCopyContext());
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
    const copyId = useWindowCopy();
    const [state, setState] = useState(() => store.read(design, copyId));

    // The store is written here, at the call, and never from inside a setState
    // updater. React runs an updater during the render pass, and a write tells
    // every other mount of the store to re-read: from an updater that lands as
    // one component setting state on another mid-render, which React refuses.
    // Current values come from the store rather than from React state, which is
    // both what they are merged into and the fresher of the two.
    const patch = useCallback(next => {
        setState(store.write(
            design, typeof next === 'function' ? next(store.peek(design, copyId)) : next, copyId));
    }, [store, design, copyId]);

    const setField = useCallback((key, value) => {
        const next = typeof value === 'function' ? value(store.peek(design, copyId)[key]) : value;
        setState(store.write(design, { [key]: next }, copyId));
    }, [store, design, copyId]);

    // Re-reads on a design change so `onDesignChange` reseeds the design-dependent
    // keys. Keyed on the id rather than the object: a design edit keeps the
    // controls as they are, only selecting a different design reseeds them.
    useEffect(() => {
        setState(store.read(design, copyId));
    }, [store, design?.id, copyId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Another mount of the same copy wrote to it: re-read, so a window and its
    // panels never disagree.
    useEffect(
        () => store.subscribe(() => setState(store.read(design, copyId)), copyId),
        [store, design?.id, copyId], // eslint-disable-line react-hooks/exhaustive-deps
    );

    // Saving or restoring the window's defaults rebases the store underneath an
    // open window, and the preferences file arrives shortly after startup.
    useEffect(
        () => onSavedWindowDefaults(() => setState(store.read(design, copyId))),
        [store, design?.id, copyId], // eslint-disable-line react-hooks/exhaustive-deps
    );

    return [state, setField, patch];
}
