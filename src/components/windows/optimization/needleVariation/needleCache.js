/**
 * Per-session Needle Variation run cache, keyed by design id. Lets the window
 * persist generations / best design across window switches and restore them on
 * return. Cleared when a design is evicted from the workspace.
 */

const _needleCache = {};

export const getCachedOptState   = (id) => (id && _needleCache[id]) || null;
export const setCachedOptState   = (id, state) => { if (id) _needleCache[id] = state; };
export const clearCachedOptState = (id) => { if (id) delete _needleCache[id]; };

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
    window.addEventListener('tfstudio:design-evict', (e) => clearCachedOptState(e.detail?.id));
