/**
 * The values an analysis window starts from, as saved by the user.
 *
 * Every window opens at the shipped range, angle and mode, whatever the work
 * is. Somebody working on 8-12 µm filters would otherwise retype the same range
 * in every window at every launch, so a window's settings panel can write what
 * it is set to now into the preferences file and start there next time.
 *
 * Two stores, kept disjoint
 * ------------------------
 * A key the analysis registry declares (constants/analysisDefaults.js) is saved
 * through that registry, into the `analysis` block Settings → Analysis edits.
 * Everything else goes into the `windows` block. A setting therefore has one
 * home whichever screen it was changed on, and the pane and the window cannot
 * show different values for it.
 *
 * Both blocks live in the same preferences file under the Preferences folder,
 * which is in Documents rather than AppData and so survives a reinstall.
 */
import { ANALYSIS_DEFAULTS } from '../constants/analysisDefaults.js';
import { applySavedWindowDefaults, windowSessionStores } from '../components/windows/windowSession.js';

// windowId → { key: value }, mirroring the preferences file's `windows` block.
let saved = {};
const listeners = new Set();

function notify() {
    for (const fn of listeners) fn();
}

/** Run `fn` when the saved defaults change. Returns an unsubscribe. */
export function onSavedDefaultsChanged(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** The `windows` block as it currently stands. */
export function savedWindowDefaults() {
    return saved;
}

/** Values saved for one window, or an empty object. */
export function savedDefaultsFor(windowId) {
    return saved[windowId] || {};
}

/**
 * Adopt the block read from the preferences file. Called once at startup,
 * before or shortly after the first window mounts.
 */
export function initSavedWindowDefaults(block) {
    saved = block && typeof block === 'object' ? block : {};
    applySavedWindowDefaults(saved);
    notify();
}

/**
 * Windows whose settings panel also edits settings that belong to another id.
 *
 * Optical Evaluation's panel carries the spectral range, step, angle list and
 * display unit, which every evaluation window follows and which Settings →
 * Analysis → All windows edits. They are saved under `shared` so both screens
 * keep reading the same values; saving them under the window would give the same
 * setting two homes.
 */
const ALSO_EDITS = { opticalEvaluation: ['shared'] };

/** The ids a window's Save and Restore cover, its own first. */
function idsFor(windowId) {
    return [windowId, ...(ALSO_EDITS[windowId] || [])];
}

/** Which registry section declares `key` for this window, if any. */
function registrySection(windowId, key) {
    const registry = ANALYSIS_DEFAULTS[windowId];
    if (!registry) return null;
    for (const section of ['numbers', 'enums', 'booleans']) {
        if (registry[section] && key in registry[section]) return section;
    }
    return null;
}

/** Every savable key across the stores registered for one window. */
export function savableKeysFor(windowId) {
    return windowSessionStores(windowId).flatMap(store => store.savableKeys);
}

/** True when the window has at least one store that can save its settings. */
export function canSaveWindowDefaults(windowId) {
    return idsFor(windowId).some(id => savableKeysFor(id).length > 0);
}

/** The savable settings held under one id, as they are set right now. */
export function currentWindowValues(windowId, design) {
    return windowSessionStores(windowId).reduce(
        (values, store) => ({ ...values, ...store.savableValues(design) }), {});
}

/**
 * Split saved values into the two blocks that own them.
 *
 * @returns {{fields: Array<[string, string, *]>, session: object}}
 *          `fields` are `[section, key, value]` triples for the analysis block;
 *          `session` is everything the registry does not declare.
 */
export function splitWindowValues(windowId, values) {
    const fields = [];
    const session = {};
    for (const [key, value] of Object.entries(values)) {
        const section = registrySection(windowId, key);
        if (section) fields.push([section, key, value]);
        else session[key] = value;
    }
    return { fields, session };
}

// The whole block goes to the main process on every change; it is a handful of
// small objects, and one write of the current truth cannot leave the file
// holding a half-applied change the way a sequence of key writes could.
async function persist(block) {
    const save = window.electronAPI?.saveWindowDefaults;
    if (typeof save !== 'function') return 'unavailable';
    try {
        const result = await save(block);
        return result?.success === false ? (result.error || 'failed') : null;
    } catch (err) {
        return err?.message || 'failed';
    }
}

function commit(block) {
    saved = block;
    applySavedWindowDefaults(saved);
    notify();
    return persist(block);
}

/**
 * Make the window's current settings its defaults.
 *
 * @param {string} windowId
 * @param {object} design            the design whose slot is on screen
 * @param {object} analysisSettings  the AnalysisSettings context, for the keys
 *                                   the registry owns
 * @returns {Promise<string|null>}   an error message, or null on success
 */
export function saveWindowDefaults(windowId, design, analysisSettings) {
    const block = { ...saved };
    for (const id of idsFor(windowId)) {
        const values = currentWindowValues(id, design);
        if (Object.keys(values).length === 0) continue;
        const { fields, session } = splitWindowValues(id, values);
        for (const [section, key, value] of fields) {
            analysisSettings?.setField(id, section, key, value);
        }
        if (Object.keys(session).length > 0) block[id] = session;
        else delete block[id];
    }
    return commit(block);
}

/**
 * Shipped values for the savable keys the registry declares.
 *
 * A store's own default for one of those keys is a placeholder — the window
 * substitutes the configured value at mount — so Restore has to put the
 * registry's factory value back rather than the placeholder.
 */
function factoryValuesFor(windowId) {
    const out = {};
    for (const key of savableKeysFor(windowId)) {
        const section = registrySection(windowId, key);
        if (!section) continue;
        const spec = ANALYSIS_DEFAULTS[windowId][section][key];
        out[key] = section === 'booleans' ? spec : spec.def;
    }
    return out;
}

/** Drop one window's saved settings, leaving the analysis block alone. */
export function clearSavedWindowDefaults(windowId) {
    const factory = factoryValuesFor(windowId);
    for (const store of windowSessionStores(windowId)) store.rebase(factory, { force: true });
    const block = { ...saved };
    delete block[windowId];
    return commit(block);
}

/** Drop the saved settings of every window. */
export function clearAllSavedWindowDefaults() {
    for (const windowId of Object.keys(saved)) {
        for (const store of windowSessionStores(windowId)) {
            store.rebase(factoryValuesFor(windowId), { force: true });
        }
    }
    return commit({});
}

/**
 * Put the window back to the values the release ships with.
 *
 * Only the registry keys this window can save are cleared, so a curve colour
 * changed in Settings is left alone: it is not one of the window's controls.
 */
export function restoreWindowDefaults(windowId, analysisSettings) {
    const block = { ...saved };
    for (const id of idsFor(windowId)) {
        const factory = factoryValuesFor(id);
        for (const [key, value] of Object.entries(factory)) {
            analysisSettings?.setField(id, registrySection(id, key), key, value);
        }
        for (const store of windowSessionStores(id)) store.rebase(factory, { force: true });
        delete block[id];
    }
    return commit(block);
}

/**
 * True when the window would start from something other than the shipped
 * values. `block` is passed by the hook so a component re-renders when it
 * changes; it defaults to the current one for callers outside React.
 */
export function hasSavedWindowDefaults(windowId, analysisSettings, block = saved) {
    return idsFor(windowId).some(id => {
        if (Object.keys(block?.[id] || {}).length > 0) return true;
        const stored = analysisSettings?.stored?.[id];
        if (!stored) return false;
        return savableKeysFor(id).some(key => {
            const section = registrySection(id, key);
            return !!section && !!stored[section] && key in stored[section];
        });
    });
}

/** The saved defaults, re-rendering the caller whenever they change. */
export function useSavedWindowDefaults() {
    const { useEffect, useState } = React;
    const [block, setBlock] = useState(saved);
    useEffect(() => onSavedDefaultsChanged(() => setBlock(savedWindowDefaults())), []);
    return block;
}
