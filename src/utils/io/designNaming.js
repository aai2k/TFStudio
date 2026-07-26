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
