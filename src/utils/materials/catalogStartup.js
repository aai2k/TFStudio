/**
 * Bringing the material catalogs up at startup, and again after the data folder
 * moves: the saved catalog files, the one-time migration out of localStorage,
 * and the AGF files the user has dropped in.
 */

import { initCatalogs, addCatalog } from './catalogManager.js';
import { parseAGF } from './agfParser.js';

// If no catalog files exist yet, promote any catalogs that were previously kept
// in localStorage (before catalogs were stored in Documents) to disk files.
async function migrateLegacyCatalogsFromLocalStorage(persistedCatalogs) {
    const OLD_KEY = 'tf_catalogs';
    try {
        const raw = localStorage.getItem(OLD_KEY);
        if (!raw) return;
        const legacy = JSON.parse(raw);
        for (const cat of Object.values(legacy)) {
            if (cat.id && cat.id !== 'builtin' && window.electronAPI?.saveCatalog) {
                await window.electronAPI.saveCatalog(cat);
                persistedCatalogs[cat.id] = cat;
            }
        }
        localStorage.removeItem(OLD_KEY);
    } catch (_) { /* corrupt legacy data — ignore */ }
}

// Auto-scan Documents\TFStudio\Materials\agf\ for .agf files and register any
// not already present in the persisted catalog set.
async function scanAndRegisterAgfCatalogs(persistedCatalogs) {
    if (!window.electronAPI?.scanAgfDir) return;
    try {
        const agfResult = await window.electronAPI.scanAgfDir();
        if (!agfResult.success) return;
        for (const { name, text } of agfResult.files) {
            const catId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
            if (!persistedCatalogs[catId]) {
                addCatalog(parseAGF(text, catId));
            }
        }
    } catch (_) {}
}

export async function loadCatalogsFromDisk() {
    let persistedCatalogs = {};

    if (window.electronAPI?.loadCatalogs) {
        const result = await window.electronAPI.loadCatalogs();
        if (result.success) persistedCatalogs = result.catalogs;
    }

    if (Object.keys(persistedCatalogs).length === 0) {
        await migrateLegacyCatalogsFromLocalStorage(persistedCatalogs);
    }

    initCatalogs(persistedCatalogs);

    await scanAndRegisterAgfCatalogs(persistedCatalogs);

    // Notify any already-mounted catalog consumers to refresh.
    window.dispatchEvent(new CustomEvent('catalogs-loaded'));
}
