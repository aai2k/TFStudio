/**
 * The values an analysis window starts from.
 *
 * Every window setting is declared once, in constants/analysisDefaults.js, under
 * the window that owns it, and stored once, in the `analysis` block of the
 * preferences file. Settings → Analysis edits that block field by field; a
 * window's Save button writes what the window is set to into the same block.
 * There is no store on the side, so a setting cannot read one way in the pane
 * and another in the window.
 *
 * Each window keeps its own range, step and geometry. Two windows can sit on
 * different bands, which is the point: a scattering plot and a colour
 * calculation are not looking at the same thing.
 *
 * What is not here: which curves are drawn, which integral is highlighted, which
 * parameter a sweep is on. Those are what you are looking at right now, not what
 * the window should open with.
 */
import { ANALYSIS_DEFAULTS, registryKeys } from '../constants/analysisDefaults.js';
import { resolvedWindowValues } from './analysisSettings.js';
import {
    applySavedWindowDefaults, resetWindowSessions, windowSessionStores,
} from '../components/windows/windowSession.js';

/** Which registry section declares `key` for this window, if any. */
function registrySection(windowId, key) {
    const registry = ANALYSIS_DEFAULTS[windowId];
    if (!registry) return null;
    for (const section of ['numbers', 'enums', 'booleans', 'lists']) {
        if (registry[section] && key in registry[section]) return section;
    }
    return null;
}

/**
 * Point every registered store at the configured values.
 *
 * Called whenever the stored block changes: once when the preferences file
 * arrives, and again after any edit in Settings. A store the user has already
 * touched keeps what they set — a Settings edit applies the next time that
 * window opens fresh, which is what the pane says it does.
 */
export function applyAnalysisDefaults(stored) {
    const block = {};
    for (const windowId of Object.keys(ANALYSIS_DEFAULTS)) {
        block[windowId] = resolvedWindowValues(windowId, stored);
    }
    applySavedWindowDefaults(block);
}

/** True when the window has settings it can save. */
export function canSaveWindowDefaults(windowId) {
    return registryKeys(windowId).length > 0;
}

/**
 * The window's settings as they are set right now, gathered from every store
 * registered under its id. Optical Evaluation has two: its own, and the
 * evaluation grid that lives at App level.
 */
export function currentWindowValues(windowId, design) {
    return windowSessionStores(windowId).reduce(
        (values, store) => ({ ...values, ...store.savableValues(design) }), {});
}

/** Make the window's current settings the values it opens with. */
export function saveWindowDefaults(windowId, design, analysisSettings) {
    for (const [key, value] of Object.entries(currentWindowValues(windowId, design))) {
        const section = registrySection(windowId, key);
        if (section) analysisSettings?.setField(windowId, section, key, value);
    }
}

/**
 * Put the window back to the values the release ships with.
 *
 * Only the settings this window owns are cleared, so a curve colour changed in
 * Settings is left alone: it is not one of the window's controls.
 *
 * The window is put back as well as the stored values. Nothing else pushes into
 * a store the user has changed, and a Restore that only took effect at the next
 * launch would read as a button that does nothing.
 */
export function restoreWindowDefaults(windowId, analysisSettings) {
    const registry = ANALYSIS_DEFAULTS[windowId] || {};
    for (const section of ['numbers', 'enums', 'booleans', 'lists']) {
        for (const [key, spec] of Object.entries(registry[section] || {})) {
            const factory = section === 'booleans' ? spec : spec.def;
            analysisSettings?.setField(windowId, section, key,
                Array.isArray(factory) ? [...factory] : factory);
        }
    }
    // An empty set of saved values is the shipped ones, which is what Restore means.
    resetWindowSessions(windowId, {});
}

/** True when the window would start from something other than the shipped values. */
export function hasSavedWindowDefaults(windowId, analysisSettings) {
    const stored = analysisSettings?.stored?.[windowId];
    if (!stored) return false;
    return ['numbers', 'enums', 'booleans', 'lists']
        .some(section => Object.keys(stored[section] || {}).length > 0);
}
