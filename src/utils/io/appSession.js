/**
 * The working copy, mirrored in localStorage.
 *
 * Every design with unsaved edits or undo history is saved here with its
 * undo/redo stacks, so an app restart keeps unsaved edits and keeps Ctrl+Z
 * working. The .tfs files on disk are the last explicit save; the session is what
 * the user was working on.
 *
 * Each design is its own entry, rewritten only when that design changes. An
 * entry holds the design's timeline (the undo steps, the design itself, the redo
 * steps) and `base`, the fingerprint of the saved file the working copy started
 * from. At startup the entry wins over the file only while the file still
 * matches `base`; see mergeSessionOverDisk.
 */

const ENTRY_PREFIX = 'tfstudio-session-v4:';
const V3_SESSION_KEY = 'tfstudio-session-v3';
const V2_SESSION_KEY = 'tfstudio-session-v2';

// Longest undo and redo chain kept per design, in each direction.
export const MAX_HISTORY = 50;

// A field holding a list of objects (layers, operands, measured points) is
// stored element by element: an edit usually changes one element and keeps the
// rest, so most elements are shared between the steps of a timeline.
function splitsIntoElements(value) {
    return Array.isArray(value) && value.length > 0
        && value.every(el => el !== null && typeof el === 'object');
}

/**
 * A run of design snapshots with every distinct value written once.
 *
 * Each snapshot becomes { field: i } or, for a list of objects,
 * { field: [i, ...] }, the indexes pointing into `values`. `texts` holds the
 * JSON of each value, so the caller can write them without serializing again.
 * Consecutive undo steps differ in a field or two, and the rest of each step is
 * the value the step before already stored.
 */
export function encodeTimeline(snapshots) {
    const texts = [];
    const indexOf = new Map();
    const ref = (value) => {
        const text = JSON.stringify(value);
        let i = indexOf.get(text);
        if (i === undefined) {
            i = texts.length;
            texts.push(text);
            indexOf.set(text, i);
        }
        return i;
    };
    const snaps = snapshots.map(snapshot => {
        const out = {};
        for (const [key, value] of Object.entries(snapshot)) {
            if (value === undefined || typeof value === 'function') continue;
            out[key] = splitsIntoElements(value) ? value.map(ref) : ref(value);
        }
        return out;
    });
    return { snaps, texts };
}

// The inverse of encodeTimeline. A value several snapshots point at comes back
// as one shared object, as it was in memory before it was stored.
export function decodeTimeline(values, snaps) {
    return snaps.map(snap => {
        const out = {};
        for (const [key, ref] of Object.entries(snap)) {
            out[key] = Array.isArray(ref) ? ref.map(i => values[i]) : values[ref];
        }
        return out;
    });
}

// The stored text of one entry. `history` is trimmed to MAX_HISTORY steps each
// way: the newest undo steps and the oldest redo steps.
export function serializeEntry({ design, history, base }) {
    const past   = (history?.past   || []).slice(-MAX_HISTORY);
    const future = (history?.future || []).slice(0, MAX_HISTORY);
    const { snaps, texts } = encodeTimeline([...past, design, ...future]);
    return `{"base":${JSON.stringify(base ?? null)},"at":${past.length},`
        + `"snaps":${JSON.stringify(snaps)},"values":[${texts.join(',')}]}`;
}

export function parseEntry(text) {
    const e = JSON.parse(text);
    if (!e || !Array.isArray(e.snaps) || !Array.isArray(e.values)) return null;
    const timeline = decodeTimeline(e.values, e.snaps);
    const at = e.at | 0;
    if (!timeline[at]) return null;
    return {
        design: timeline[at],
        history: { past: timeline.slice(0, at), future: timeline.slice(at + 1) },
        base: typeof e.base === 'string' ? e.base : null,
    };
}

// Write one design's entry, or remove it when `entry` is null. False when the
// storage refused the write.
export function writeSessionEntry(id, entry) {
    try {
        if (entry) localStorage.setItem(ENTRY_PREFIX + id, serializeEntry(entry));
        else       localStorage.removeItem(ENTRY_PREFIX + id);
        return true;
    } catch (_) {
        return false;
    }
}

function readEntries() {
    const entries = {};
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(ENTRY_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
        try {
            const entry = parseEntry(localStorage.getItem(key));
            if (entry) entries[key.slice(ENTRY_PREFIX.length)] = entry;
        } catch (_) {}
    }
    return entries;
}

// A session written by 1.8.1 or earlier: one value holding every design, with
// no record of the file each working copy started from, so `base` is null.
function readLegacySession() {
    for (const [key, version] of [[V3_SESSION_KEY, 3], [V2_SESSION_KEY, 2]]) {
        try {
            const s = JSON.parse(localStorage.getItem(key) || 'null');
            if (s?.version !== version || !s.designs) continue;
            const history = s.history || {};
            const entries = {};
            for (const [id, design] of Object.entries(s.designs)) {
                const h = history[id];
                entries[id] = {
                    design,
                    history: {
                        past:   Array.isArray(h?.past)   ? h.past   : [],
                        future: Array.isArray(h?.future) ? h.future : [],
                    },
                    base: null,
                };
            }
            return entries;
        } catch (_) {}
    }
    return null;
}

/**
 * Every stored entry by design id. `legacy` is true when they were read from a
 * 1.8.1-or-earlier session; the caller rewrites them as entries and then calls
 * clearLegacySession.
 */
export function loadSession() {
    try {
        const entries = readEntries();
        if (Object.keys(entries).length > 0) return { entries, legacy: false };
        const legacy = readLegacySession();
        if (legacy) return { entries: legacy, legacy: true };
    } catch (_) {}
    return null;
}

export function clearLegacySession() {
    try {
        localStorage.removeItem(V3_SESSION_KEY);
        localStorage.removeItem(V2_SESSION_KEY);
    } catch (_) {}
}
