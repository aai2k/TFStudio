// Per-session Gradual-Evolution run cache, keyed by design id. Lets the window
// (and its run engines) persist cycles / best design across window switches and
// restore them on return. Cleared when a design is evicted from the workspace.

const _geCache = {};

export const getCached   = (id) => (id && _geCache[id]) || null;
export const setCached   = (id, s) => { if (id) _geCache[id] = s; };
export const clearCached = (id) => { if (id) delete _geCache[id]; };

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
    window.addEventListener('tfstudio:design-evict', (e) => clearCached(e.detail?.id));
