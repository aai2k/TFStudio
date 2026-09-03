/**
 * Narrowing the library list. Works on what an entry stores, so filtering a
 * list of any length costs no spectrum evaluation.
 */

/**
 * @param {object[]} entries
 * @param {object} criteria
 * @param {string}   [criteria.query]     matched against name, use text, type, tags, substrate and layer material ids
 * @param {string}   [criteria.type]      one of COATING_TYPES, or '' for all
 * @param {string[]} [criteria.tags]      every listed tag must be on the entry
 * @param {string}   [criteria.substrate] material id, or '' for any
 * @param {number}   [criteria.lambda]    nm; keeps entries with a design band containing it
 * @param {number}   [criteria.maxLayers] keeps entries with at most this many layers
 */
export function filterEntries(entries, {
    query = '', type = '', tags = [], substrate = '', lambda = null, maxLayers = null,
} = {}) {
    const q = String(query || '').trim().toLowerCase();
    const lam = Number(lambda);
    const max = Number(maxLayers);
    const wanted = Array.isArray(tags) ? tags : [];
    return entries.filter(entry => {
        if (type && entry.type !== type) return false;
        if (substrate && entry.substrate !== substrate) return false;
        if (!wanted.every(tag => entry.tags.includes(tag))) return false;
        if (lambda != null && Number.isFinite(lam) && !entry.bands.some(([from, to]) => lam >= from && lam <= to)) return false;
        if (maxLayers != null && Number.isFinite(max) && max > 0 && entry.layers.length > max) return false;
        if (q) {
            const haystack = [
                entry.name, entry.use, entry.type, ...entry.tags, entry.substrate,
                ...entry.layers.map(layer => layer.material),
            ].join(' ').toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        return true;
    });
}

/** Tags carried by `entries` with how many entries carry each, most common first. */
export function tagCounts(entries) {
    const counts = new Map();
    for (const entry of entries) {
        for (const tag of entry.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({ tag, count }));
}

/** Distinct substrate ids of `entries`, in first-seen order. */
export function substratesOf(entries) {
    return [...new Set(entries.map(entry => entry.substrate))];
}
