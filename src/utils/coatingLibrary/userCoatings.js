/**
 * The user's own coating library on disk: one .tfsc file per coating in the
 * Coatings folder (Settings, Data Folders), read and written by the main
 * process. Entries come back in the shape `entryModel.js` defines.
 */
import { makeCoatingEntry, slugify } from './entryModel.js';

/** Fired on `window` after a save or delete, so an open library window can reload its list. */
export const USER_COATINGS_CHANGED = 'tfstudio:coatings-changed';

function announce() {
    try { window.dispatchEvent(new CustomEvent(USER_COATINGS_CHANGED)); } catch (_) { /* no window */ }
}

/** Every saved coating, newest first. Empty outside the desktop app. */
export async function listUserCoatings() {
    const api = window.electronAPI;
    if (!api?.listCoatings) return [];
    const result = await api.listCoatings();
    if (!result?.success) return [];
    return (result.presets || [])
        .filter(item => item.record)
        .map(item => makeCoatingEntry({ ...item.record, id: `user-${slugify(item.record.name || item.name)}` }))
        .sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
}

/**
 * Write one coating. The file is named after the entry. A coating already
 * saved under that file is replaced only when `options.overwrite` is set;
 * otherwise the answer is the error 'exists' with the `name` saved there.
 */
export async function saveUserCoating(entry, options) {
    const api = window.electronAPI;
    if (!api?.saveCoating) return { success: false, errorKey: 'desktopOnly' };
    const record = Object.fromEntries(Object.entries(entry).filter(([, value]) => value != null));
    const result = await api.saveCoating(record, options);
    if (result?.success) announce();
    return result;
}

/**
 * Delete one coating, to the Recycle Bin. Where the bin refuses the file, it
 * stays and the answer is the error 'no-bin'; `options.permanent` deletes it
 * for good.
 */
export async function deleteUserCoating(name, options) {
    const api = window.electronAPI;
    if (!api?.deleteCoating) return { success: false, errorKey: 'desktopOnly' };
    const result = await api.deleteCoating(name, options);
    if (result?.success) announce();
    return result;
}
