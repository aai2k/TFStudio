const structuralCache = {};

export const getCached = id => (id && structuralCache[id]) || null;

export function setCached(id, state) {
    if (id) structuralCache[id] = state;
}

export function clearCached(id) {
    if (id) delete structuralCache[id];
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('tfstudio:design-evict', event => clearCached(event.detail?.id));
}
