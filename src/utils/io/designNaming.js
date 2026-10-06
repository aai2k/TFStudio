/**
 * Design name ↔ .tfs filename rules.
 *
 * A design is persisted as `<name>.tfs` inside its project folder, and that
 * filename is also the key used to rename and delete it. Two designs in the
 * tree must therefore never resolve to the same file, or saving one silently
 * overwrites the other.
 *
 * Names are compared through `designFileKey` rather than directly: the main
 * process replaces characters that are illegal in a filename, and Windows
 * matches filenames case-insensitively and ignores trailing dots and spaces.
 * `A/B`, `A_B` and `a_b ` all reach the same file and so count as one name.
 */

// Character class mirrors safeName() in src/main/paths.js.
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/g;

/** Identity of the file a design name resolves to. */
export function designFileKey(name) {
    return String(name ?? '')
        .replace(ILLEGAL_FILENAME_CHARS, '_')
        .replace(/[. ]+$/, '')
        .toLowerCase();
}

// Device names Windows reserves, alone or with an extension: a file called
// NUL.tfs or COM1.tfs is the device, not a file.
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * True for a name Windows cannot use for a folder: a device name, or one ending
 * in a dot or a space. Node creates such folders on request, but Explorer, other
 * programs and sync clients then cannot open, rename or delete them.
 */
export function isUnusableFileName(name) {
    const text = String(name ?? '');
    return /[. ]$/.test(text) || isUnusableDesignName(text);
}

/**
 * True for a design name whose file, `<name>.tfs`, Windows takes for a device.
 * A trailing dot or space is fine here: the extension follows it.
 */
export function isUnusableDesignName(name) {
    return DEVICE_NAME.test(String(name ?? '').trim());
}

/**
 * The design names one project folder holds.
 *
 * A name has to be unique inside its folder, because that is what decides the
 * filename there. Two folders are two directories, so each may hold a design of
 * the same name; the names to check a new one against are therefore the target
 * folder's, not the whole tree's.
 *
 * A folder that cannot be resolved throws rather than answering "no names":
 * an empty list reads as "nothing is taken here" and would let a caller that
 * lost track of its folder create a second design over the first one's file.
 */
export function folderDesignNames(folders, folderId) {
    const folder = (folders || []).find((candidate) => candidate.id === folderId);
    if (!folder) throw new Error(`folderDesignNames: no folder with id ${JSON.stringify(folderId)}`);
    return folder.items.map((item) => item.name);
}

/**
 * `base`, or the first `formatSuffix(base, k)` for k = 2, 3, … whose file key is
 * not already taken. `existingNames` is any iterable of design names.
 */
export function uniqueDesignName(base, existingNames, formatSuffix) {
    const taken = new Set();
    for (const name of existingNames) taken.add(designFileKey(name));
    let candidate = base;
    let k = 2;
    while (taken.has(designFileKey(candidate))) candidate = formatSuffix(base, k++);
    return candidate;
}
