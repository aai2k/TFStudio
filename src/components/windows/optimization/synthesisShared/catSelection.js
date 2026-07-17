import { getCatalogs } from '../../../../utils/materials/catalogManager.js';

// ── Catalog-selection persistence (localStorage; key per window) ─────────────────
export function loadSavedCatSelection(key) {
    try {
        const raw = localStorage.getItem(key);
        if (raw) return new Set(JSON.parse(raw));
    } catch (_) {}
    return null;
}

export function saveCatSelection(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch (_) {}
}

// Toggling a catalog is an "all or nothing" action for its materials, so it also
// clears that catalog's per-material exclusions (checked → every material in
// play; unchecked → clean slate).
function computeToggleCat(curCats, curExcl, catId, catMatIds) {
    const nextCats = new Set(curCats);
    if (nextCats.has(catId)) nextCats.delete(catId); else nextCats.add(catId);
    const nextExcl = new Set(curExcl);
    for (const id of catMatIds) nextExcl.delete(id);
    return { nextCats, nextExcl };
}

// Toggle one material's membership. A material lives inside a catalog, but the
// user can pick individual materials from a catalog whose box is unchecked:
// turning one on selects the catalog and excludes every OTHER material, so only
// the chosen one is in play. Turning the last remaining material off collapses
// the catalog back to unchecked.
function computeToggleMat(curCats, curExcl, catId, fullId, catMatIds) {
    const nextCats = new Set(curCats);
    const nextExcl = new Set(curExcl);
    if (!nextCats.has(catId)) {
        nextCats.add(catId);
        for (const id of catMatIds) { if (id === fullId) nextExcl.delete(id); else nextExcl.add(id); }
    } else {
        if (nextExcl.has(fullId)) nextExcl.delete(fullId); else nextExcl.add(fullId);
        if (catMatIds.length && catMatIds.every(id => nextExcl.has(id))) {
            for (const id of catMatIds) nextExcl.delete(id);
            nextCats.delete(catId);
        }
    }
    return { nextCats, nextExcl };
}

// ── Catalog-selection state hook ────────────────────────────────────────────────
// The selectedCats useState (initialized from localStorage, filtered to existing
// catalogs), its mirror ref, and the toggle/all/clear handlers were identical in
// Needle+GE apart from the localStorage key. Returns `selectedCatsRef` so the run
// loop can read the latest selection synchronously (as both windows did).
export function useCatSelection(storageKey) {
    const { useState, useRef, useEffect, useCallback } = React;
    const [selectedCats, setSelectedCats] = useState(() => {
        const saved  = loadSavedCatSelection(storageKey);
        const allIds = new Set(getCatalogs().map(c => c.id));
        if (!saved) return allIds;
        const filtered = new Set([...allIds].filter(id => saved.has(id)));
        return filtered.size > 0 ? filtered : allIds;
    });
    const selectedCatsRef = useRef(selectedCats);
    useEffect(() => { selectedCatsRef.current = selectedCats; }, [selectedCats]);

    // Per-material deselection within selected catalogs (pool drill-down).
    // Stored as the set of EXCLUDED full material ids so the default (nothing
    // excluded) means "all materials of every selected catalog" — backward
    // compatible with the old catalog-only behavior. Separate localStorage key.
    const exclKey = storageKey + '_excl';
    const [excludedMats, setExcludedMats] = useState(() => loadSavedCatSelection(exclKey) || new Set());
    const excludedMatsRef = useRef(excludedMats);
    useEffect(() => { excludedMatsRef.current = excludedMats; }, [excludedMats]);

    // Apply a new (cats, excl) selection: update the synchronous mirror refs,
    // persist both, and re-render.
    const commit = useCallback((nextCats, nextExcl) => {
        selectedCatsRef.current = nextCats; excludedMatsRef.current = nextExcl;
        saveCatSelection(storageKey, nextCats); saveCatSelection(exclKey, nextExcl);
        setSelectedCats(nextCats); setExcludedMats(nextExcl);
    }, [storageKey, exclKey]);

    const handleToggleCat = useCallback((catId, catMatIds = []) => {
        const { nextCats, nextExcl } = computeToggleCat(selectedCatsRef.current, excludedMatsRef.current, catId, catMatIds);
        commit(nextCats, nextExcl);
    }, [commit]);
    // All/Clear act on whole catalogs AND wipe per-material exclusions, so each
    // is an unambiguous reset ("All" really means every material is in play).
    const handleSelectAllCats = useCallback(() => {
        commit(new Set(getCatalogs().map(cat => cat.id)), new Set());
    }, [commit]);
    const handleClearCats = useCallback(() => {
        commit(new Set(), new Set());
    }, [commit]);
    const handleToggleMat = useCallback((catId, fullId, catMatIds = []) => {
        const { nextCats, nextExcl } = computeToggleMat(selectedCatsRef.current, excludedMatsRef.current, catId, fullId, catMatIds);
        commit(nextCats, nextExcl);
    }, [commit]);

    return { selectedCats, setSelectedCats, selectedCatsRef,
             handleToggleCat, handleSelectAllCats, handleClearCats,
             excludedMats, excludedMatsRef, handleToggleMat };
}
