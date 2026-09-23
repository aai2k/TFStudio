/**
 * settings.json and the preferences file, as the renderer reads and writes them.
 *
 * Neither read throws: the app must open with the values it ships when a file is
 * missing or unreadable, and the caller must still be told the read is over or
 * it waits for a block that never arrives.
 */

import { pruneBuiltInThemeNames, migrateThemeName, saveAppearance } from '../theme/appearance.js';

/**
 * The saved settings, normalized, or null when there are none to apply.
 * `theme`, `locale`, `ribbonStyle` and `skippedVersion` are null when the file
 * does not name them, which leaves the value the app started with in place.
 * The two toggles are opt-out: a missing setting reads as on.
 */
export async function readAppSettings() {
    let settings = null;
    try {
        if (!window.electronAPI?.loadSettings) return null;
        const result = await window.electronAPI.loadSettings();
        settings = (result?.success && result.settings) || null;
    } catch (_) {
        return null;
    }
    if (!settings) return null;
    return {
        customThemes: settings.customThemes && typeof settings.customThemes === 'object'
            ? pruneBuiltInThemeNames(settings.customThemes)
            : null,
        // A persisted theme that was a now-pruned dupe resolves to its built-in
        // twin by the same name — nothing else to do.
        theme:       settings.theme ? migrateThemeName(settings.theme) : null,
        locale:      settings.locale || null,
        ribbonStyle: settings.ribbonStyle || null,
        wasmTmm:            settings.wasmTmm !== false,
        updateCheckEnabled: settings.updateCheckEnabled !== false,
        skippedVersion: typeof settings.skippedVersion === 'string' ? settings.skippedVersion : null,
    };
}

// Write settings.json, and mirror the appearance part where the next launch can
// read it synchronously.
export async function writeAppSettings(values) {
    if (window.electronAPI?.saveSettings) {
        await window.electronAPI.saveSettings(values);
    }
    const { theme, ribbonStyle, customThemes } = values;
    saveAppearance({ theme, ribbonStyle, customThemes });
}

const plainObject = (value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/**
 * The analysis-window defaults live in the preferences file rather than in
 * settings.json, so they are in Documents and survive a reinstall. A missing or
 * unreadable file leaves every window on the values the release ships with.
 *
 * Every block the file holds must be returned: the caller seeds its in-memory
 * copy from this and the next save writes that copy back, so a block dropped
 * here is deleted from the file.
 */
export async function readPreferences() {
    let prefs = null;
    try { prefs = (await window.electronAPI?.loadPreferences?.())?.prefs || null; }
    catch (_) { /* shipped defaults */ }
    return {
        analysis: plainObject(prefs?.analysis),
        quickAccess: Array.isArray(prefs?.quickAccess) ? prefs.quickAccess : null,
        toolState: plainObject(prefs?.toolState),
    };
}
