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

// A short tag of a file name, the same for that file in every listing.
function fileTag(file) {
    let h = 2166136261;
    for (let i = 0; i < file.length; i++) h = Math.imul(h ^ file.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
}

// The id of each saved coating: the slug of its name when no other coating's
// name gives the same slug. Each coating is a file named after its whole name,
// so names that slugify alike ('AR 1' and 'AR-1', or names in Cyrillic or
// Chinese, which leave no slug at all) are separate coatings; each of them
// takes a tag of its own file name after the slug. An id belongs to one file,
// so a save or a delete never hands it to another coating.
function withUniqueIds(items) {
    const slugOf = item => slugify(item.record.name || item.name);
    const count = new Map();
    for (const item of items) count.set(slugOf(item), (count.get(slugOf(item)) || 0) + 1);
    return items.map(item => {
        const slug = slugOf(item);
        const id = slug && count.get(slug) === 1
            ? `user-${slug}`
            : `user-${slug || 'coating'}-${fileTag(String(item.file || item.name))}`;
        return { ...item.record, id };
    });
}

/** Every saved coating, newest first. Empty outside the desktop app. */
export async function listUserCoatings() {
    const api = window.electronAPI;
    if (!api?.listCoatings) return [];
    const result = await api.listCoatings();
    if (!result?.success) return [];
    return withUniqueIds((result.presets || []).filter(item => item.record))
        .map(record => makeCoatingEntry(record))
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
