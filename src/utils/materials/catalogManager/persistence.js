function serializeCatalog(cat) {
    // Strip non-serializable function references
    const mats = {};
    for (const [id, m] of Object.entries(cat.materials)) {
        // eslint-disable-next-line no-unused-vars
        const { getNK, ...rest } = m;
        mats[id] = rest;
    }
    return { ...cat, materials: mats };
}

// Persist one catalog to Documents\TFStudio\Materials\ via IPC (fire-and-forget).
export function persistCatalog(cat) {
    if (!cat || cat.source === 'builtin') return;
    window.electronAPI?.saveCatalog(serializeCatalog(cat));
}

// Delete a catalog file via IPC (fire-and-forget).
export function deleteCatalogFile(catalogId, source) {
    window.electronAPI?.deleteCatalog(catalogId, source);
}

// Backfill a missing/blank material `id` from its map key. A catalog material's
// key in `cat.materials` IS its id by contract, but some sources persisted
// entries without an explicit `id` field (e.g. the legacy multipassband sample
// catalog) — those rendered as dead grey rows that sorted to the top (empty id)
// and crashed materialToDraft (`mat.id.replace`). Normalising here, at the one
// registration boundary, heals existing AND future catalogs in place.
export function normalizeCatalogMaterials(cat) {
    if (!cat || !cat.materials) return cat;
    for (const [key, m] of Object.entries(cat.materials)) {
        if (m && (m.id == null || m.id === '')) m.id = key;
    }
    return cat;
}
