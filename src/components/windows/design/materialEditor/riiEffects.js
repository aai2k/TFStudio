/**
 * RIIBrowser — effect bodies for catalog loading, offline-mirror status, and
 * material fetching.
 *
 * Each function is called directly as a useEffect callback (`useEffect(() =>
 * fn(...), deps)`) and returns the effect's cleanup function, keeping the
 * hook itself free of inline effect logic.
 */

import { loadCatalog, getDatabaseStatus, fetchMaterial } from '../../../../utils/materials/riiDatabase.js';

// Load the shelf/book/page catalog once on mount.
export function loadRiiCatalogTree({ setCatalogTree, setLoadErr, setCatalogLoading }) {
    let alive = true;
    setCatalogLoading(true);
    setLoadErr(null);
    loadCatalog()
        .then(tree => { if (alive) { setCatalogTree(tree); setCatalogLoading(false); } })
        .catch(err  => { if (alive) { setLoadErr(err.message); setCatalogLoading(false); } });
    return () => { alive = false; };
}

// Offline-mirror status + live update progress (main-process download/extract events).
export function trackRiiDbStatus({ rii, setDbStatus, setUpdateMsg }) {
    let alive = true;
    getDatabaseStatus().then(s => { if (alive) setDbStatus(s); });
    const off = window.electronAPI?.onRiiUpdateProgress?.((info) => {
        if (!alive) return;
        if (info.phase === 'downloading') setUpdateMsg(rii.updateDownloading);
        else if (info.phase === 'extracting') setUpdateMsg(rii.updateExtracting);
    });
    return () => { alive = false; if (typeof off === 'function') off(); };
}

// Fetch the material data for the current selection.
export function fetchSelectedMaterial(selected, { setMat, setMatLoading, setMatErr, setPhase }) {
    if (!selected) { setMat(null); return () => {}; }
    let alive = true;
    setMatLoading(true);
    setMatErr(null);
    setMat(null);
    setPhase('idle');
    fetchMaterial(selected.dataPath)
        .then(m => { if (alive) { setMat(m); setMatLoading(false); } })
        .catch(err => { if (alive) { setMatErr(err.message); setMatLoading(false); } });
    return () => { alive = false; };
}

// Toggle membership of `key` in a Set, returning a new Set (immutable update
// for useState setters).
export function toggleInSet(set, key) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
}
