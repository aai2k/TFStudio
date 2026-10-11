/**
 * Why a data folder cannot be used, in the user's language. `code` is what the
 * main process found (see src/main/dataFolderCheck.js): not found, access
 * denied, read-only and not a folder are worded; anything else shows `reason`,
 * the system's error code.
 */
export function dataFolderReason(t, code, reason) {
    return t.settings.folders.reasons[code] || reason;
}
