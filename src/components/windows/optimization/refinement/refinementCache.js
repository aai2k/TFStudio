// Refinement Reset/Best/run-history baseline survives a docking window/tab
// switch (which unmounts the Refinement component). Keyed by design.id, same
// pattern as NeedleVariation's _needleCache. The live DLSOptimizer instance is
// NOT cached (it cannot be serialized) — Reset restores the saved baseline; undo
// also returns to the single pre-run checkpoint pushed when the run started.
export const _refineCache = {};   // { [designId]: { savedDesign, histEntries, histRunCount } }

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('tfstudio:design-evict', (e) => { delete _refineCache[e.detail?.id]; });
}

export function _rc(id) {
    if (!id) return null;
    if (!_refineCache[id]) _refineCache[id] = { savedDesign: null, histEntries: [], histRunCount: 0 };
    return _refineCache[id];
}
