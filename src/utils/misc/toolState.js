/**
 * Per-window state kept between sessions, keyed by tool id: the `toolState`
 * block of the preferences file.
 *
 * This module holds the only in-memory copy, because a save replaces the whole
 * block and two copies would overwrite each other's keys.
 */

let cache = null;

/** Seed from a preferences read. Called once at startup. */
export function setToolState(block) {
    cache = block && typeof block === 'object' ? block : {};
}

/** Everything one tool has stored, never null. */
export function toolState(toolId) {
    return (cache && cache[toolId]) || {};
}

/**
 * Merge keys into one tool's state and write the block back.
 * Returns once the write has been acknowledged.
 */
export async function patchToolState(toolId, patch) {
    const next = { ...(cache || {}) };
    next[toolId] = { ...(next[toolId] || {}), ...patch };
    cache = next;
    await window.electronAPI?.saveToolState?.(next);
    return next;
}
