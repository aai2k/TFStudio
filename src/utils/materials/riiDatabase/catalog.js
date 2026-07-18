/**
 * Catalog tree loading (catalog-nk.yml) and offline-mirror status/update.
 */

import { fetchYamlCached, CATALOG_URL } from './fetch.js';
import { cache, resetCache } from './cache.js';
import { _stripHtml } from './htmlUtils.js';

function _buildPage(pageItem) {
    if (pageItem.PAGE === undefined) return null;  // skip DIVIDERs within book
    return { page: pageItem.PAGE, name: _stripHtml(pageItem.name || pageItem.PAGE), dataPath: pageItem.data || '' };
}

function _buildBook(bookItem) {
    if (bookItem.BOOK === undefined) return null;  // skip DIVIDERs within shelf
    const book = { book: bookItem.BOOK, name: _stripHtml(bookItem.name || bookItem.BOOK), pages: [] };
    for (const pageItem of (bookItem.content || [])) {
        const page = _buildPage(pageItem);
        if (page) book.pages.push(page);
    }
    return book;
}

function _buildShelf(shelfItem) {
    if (shelfItem.SHELF === undefined) return null;  // skip top-level DIVIDERs
    const shelf = { shelf: shelfItem.SHELF, name: _stripHtml(shelfItem.name || shelfItem.SHELF), books: [] };
    for (const bookItem of (shelfItem.content || [])) {
        const book = _buildBook(bookItem);
        if (book) shelf.books.push(book);
    }
    return shelf;
}

/**
 * Load and parse the catalog-nk.yml.
 * Returns an array of shelf objects:
 *   { shelf, name, books: [{ book, name, pages: [{ page, name, dataPath }] }] }
 */
export async function loadCatalog() {
    if (cache.catalog) return cache.catalog;

    const raw = await fetchYamlCached('catalog-nk.yml', CATALOG_URL);  // SHELF / DIVIDER items
    const shelves = [];
    for (const shelfItem of raw) {
        const shelf = _buildShelf(shelfItem);
        if (shelf) shelves.push(shelf);
    }

    cache.catalog = shelves;
    return shelves;
}

/** Clear cached catalog (force re-fetch on next call). */
export function clearCatalogCache() {
    resetCache();
}

/** Offline-mirror status: { hasLocal, lastUpdated, materialCount, source }. */
export async function getDatabaseStatus() {
    if (!window.electronAPI?.riiGetStatus) return { hasLocal: false, lastUpdated: null, materialCount: 0, source: 'none' };
    try { return await window.electronAPI.riiGetStatus(); }
    catch (e) { return { hasLocal: false, lastUpdated: null, materialCount: 0, source: 'none', error: e.message }; }
}

/**
 * Download the latest database from GitHub into the offline mirror, then drop
 * the in-session caches so subsequent reads use the refreshed data.
 * Returns { success, lastUpdated, materialCount }.
 */
export async function updateDatabase() {
    if (!window.electronAPI?.riiUpdate) return { success: false, error: 'Update not available' };
    const res = await window.electronAPI.riiUpdate();
    if (res.success) clearCatalogCache();
    return res;
}
