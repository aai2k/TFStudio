import { getCatalogs } from '../../../../utils/materials/catalogManager.js';
import { DESIGN_CATALOG_ID, buildDesignCatalog } from '../../../../utils/materials/designCatalog.js';
import { designMaterialIds } from '../../../../utils/materials/designMaterials.js';
import { poolMatEntries } from './catalogPool.js';

// Every catalog the pool can offer. The design catalog is not in the registry,
// so it is named explicitly; selecting an id with no catalog behind it
// contributes nothing, which is what happens for a design that has none.
const allCatalogIds = () => new Set([DESIGN_CATALOG_ID, ...getCatalogs().map(cat => cat.id)]);

// Materials the layers of both coatings are made of.
function layerMaterialIds(design) {
    const layers = [...(design?.frontLayers || []), ...(design?.backLayers || [])];
    return new Set(layers.map(layer => layer.material).filter(Boolean));
}

/**
 * The pool a design starts with: the design catalog, with every material that no
 * layer uses left out. The substrate and the media stay listed there unticked and
 * no other catalog is ticked, so a run inserts only what the stack is already
 * made of until the user widens the pool. With no layer material to offer, as for
 * a design with no layers, nothing is ticked.
 *
 * @returns {{cats: Set<string>, excl: Set<string>}}  selected catalog ids and
 *          excluded material ids, in the form the pool panel stores.
 */
export function defaultPoolSelection(design) {
    const catalog = design ? buildDesignCatalog(design, '') : null;
    const listed = catalog ? poolMatEntries(catalog).map(entry => entry.fullId) : [];
    const layerIds = layerMaterialIds(design);
    const excl = new Set(listed.filter(id => !layerIds.has(id)));
    return excl.size < listed.length
        ? { cats: new Set([DESIGN_CATALOG_ID]), excl }
        : { cats: new Set(), excl: new Set() };
}

// What the default pool is computed from, so it is rebuilt only when that changes.
const defaultPoolKey = design =>
    JSON.stringify([designMaterialIds(design), [...layerMaterialIds(design)]]);

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

// The pool the user last set in this window, limited to catalogs that still
// exist, or null when they never changed it or none of its catalogs is left.
function loadUserPool(storageKey, exclKey) {
    const saved = loadSavedCatSelection(storageKey);
    if (!saved) return null;
    const cats = new Set([...allCatalogIds()].filter(id => saved.has(id)));
    return cats.size > 0 ? { cats, excl: loadSavedCatSelection(exclKey) || new Set() } : null;
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
// The pool of one synthesis window: the selected catalogs, and the materials left
// out of them (stored as EXCLUDED full ids, so a selected catalog with nothing
// excluded offers every material it holds). Until the user changes it the pool
// follows `design` (defaultPoolSelection); a change is stored under `storageKey`
// and kept from then on. Returns `selectedCatsRef` and `excludedMatsRef` so the
// run loop can read the latest selection synchronously.
export function useCatSelection(storageKey, design) {
    const { useState, useRef, useEffect, useCallback, useMemo } = React;
    const exclKey = storageKey + '_excl';
    const [userPool, setUserPool] = useState(() => loadUserPool(storageKey, exclKey));
    const poolKey = defaultPoolKey(design);
    const designPool = useMemo(() => defaultPoolSelection(design), [poolKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const { cats: selectedCats, excl: excludedMats } = userPool || designPool;

    const selectedCatsRef = useRef(selectedCats);
    const excludedMatsRef = useRef(excludedMats);
    useEffect(() => {
        selectedCatsRef.current = selectedCats;
        excludedMatsRef.current = excludedMats;
    }, [selectedCats, excludedMats]);

    // Apply a new (cats, excl) selection: update the synchronous mirror refs,
    // persist both, and re-render.
    const commit = useCallback((nextCats, nextExcl) => {
        selectedCatsRef.current = nextCats; excludedMatsRef.current = nextExcl;
        saveCatSelection(storageKey, nextCats); saveCatSelection(exclKey, nextExcl);
        setUserPool({ cats: nextCats, excl: nextExcl });
    }, [storageKey, exclKey]);

    const handleToggleCat = useCallback((catId, catMatIds = []) => {
        const { nextCats, nextExcl } = computeToggleCat(selectedCatsRef.current, excludedMatsRef.current, catId, catMatIds);
        commit(nextCats, nextExcl);
    }, [commit]);
    // All/Clear act on whole catalogs AND wipe per-material exclusions, so each
    // is an unambiguous reset ("All" really means every material is in play).
    const handleSelectAllCats = useCallback(() => {
        commit(allCatalogIds(), new Set());
    }, [commit]);
    const handleClearCats = useCallback(() => {
        commit(new Set(), new Set());
    }, [commit]);
    const handleToggleMat = useCallback((catId, fullId, catMatIds = []) => {
        const { nextCats, nextExcl } = computeToggleMat(selectedCatsRef.current, excludedMatsRef.current, catId, fullId, catMatIds);
        commit(nextCats, nextExcl);
    }, [commit]);

    return { selectedCats, selectedCatsRef,
             handleToggleCat, handleSelectAllCats, handleClearCats,
             excludedMats, excludedMatsRef, handleToggleMat };
}
