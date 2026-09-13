/**
 * The working copy, mirrored in localStorage.
 *
 * Every in-memory design and its per-design undo/redo stacks are saved here, so
 * an app restart keeps unsaved edits and keeps Ctrl+Z working. The .tfs files on
 * disk are the last explicitly saved snapshot; the session is what the user was
 * working on. On startup the session wins over disk, and a design is dirty when
 * the two differ.
 */

const SESSION_KEY = 'tfstudio-session-v3';
const LEGACY_SESSION_KEY = 'tfstudio-session-v2';

// Longest undo and redo chain kept per design, in each direction.
export const MAX_HISTORY = 50;

export function loadSession() {
    try {
        let raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
            const s = JSON.parse(raw);
            if (s?.version === 3 && s.designs) {
                return { designs: s.designs, history: s.history || {} };
            }
        }
        // Migrate a v2 session (designs only) forward.
        raw = localStorage.getItem(LEGACY_SESSION_KEY);
        if (raw) {
            const s = JSON.parse(raw);
            if (s?.version === 2 && s.designs) return { designs: s.designs, history: {} };
        }
    } catch (_) {}
    return null;
}

export function saveSession(designs, history) {
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ version: 3, designs, history: history || {} }));
    } catch (_) {}
}

// The persisted form of the undo/redo stacks: the newest MAX_HISTORY entries
// behind the present, and the oldest MAX_HISTORY ahead of it.
export function serializeHistory(history) {
    const out = {};
    for (const [id, h] of Object.entries(history)) {
        if (!h) continue;
        out[id] = {
            past:   (h.past   || []).slice(-MAX_HISTORY),
            future: (h.future || []).slice(0, MAX_HISTORY),
        };
    }
    return out;
}

// Read the stacks back. Best-effort: a malformed entry is skipped rather than
// failing the whole load, since the designs themselves are still usable.
export function restoreSessionHistory(sessionHistory) {
    const restored = {};
    for (const [id, h] of Object.entries(sessionHistory)) {
        if (!h) continue;
        restored[id] = {
            past:   Array.isArray(h.past)   ? h.past   : [],
            future: Array.isArray(h.future) ? h.future : [],
        };
    }
    return restored;
}
