/**
 * Best scores, kept in the `toolState` block of the preferences file.
 *
 * Read from a copy in memory, because games read their best score while
 * drawing a frame. A new best is saved at once; they come at most once per
 * level, so there is nothing to batch.
 */

import { toolState, patchToolState } from '../../../../utils/misc/toolState.js';

let cache = null;

const save = () => patchToolState('games', { best: { ...cache } });

/** Load the stored scores. Safe to call on every mount. */
export function loadScores() {
    if (!cache) cache = { ...(toolState('games').best || {}) };
    return cache;
}

/**
 * The best score for one game, after offering a new one.
 * Pass 0 to read without offering.
 */
export function bestScore(key, value) {
    if (!cache) loadScores();
    const current = cache[key] || 0;
    if (value > current) {
        cache[key] = value;
        save();
        return value;
    }
    return current;
}

/**
 * The same, for a score where lower is better, such as turns taken. 0 means no
 * score yet, and passing 0 reads without offering.
 */
export function fewestScore(key, value) {
    if (!cache) loadScores();
    const current = cache[key] || 0;
    if (value > 0 && (current === 0 || value < current)) {
        cache[key] = value;
        save();
        return value;
    }
    return current;
}
