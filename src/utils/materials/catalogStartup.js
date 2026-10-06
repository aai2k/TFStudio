/**
 * Bringing the material catalogs up at startup, and again after the data folder
 * moves: the saved catalog files, the one-time migration out of localStorage,
 * and the AGF files the user has dropped in.
 */

import { initCatalogs, addCatalog, stampCatalogs, getCatalogs } from './catalogManager.js';
import { persistCatalog } from './catalogManager/persistence.js';
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

// ── AGF files and their catalogs ─────────────────────────────────────────────
//
// An AGF catalog records the file it was made from (`sourceFile`, the name with
// its extension) and, for a file in Materials\agf, that file's size and time
// (`sourceSize`, `sourceMtime`). The scan finds a file's catalog by that record,
// so the id never depends on the file name again, and rebuilds the catalog when
// the file changed.

const baseName = fileName => String(fileName).replace(/\.[^.]*$/, '');

// The id the scan and the import gave a file before catalogs recorded their
// file: the base name lower-cased, every other character an underscore. The
// main process keeps the same rule (ipc/catalogs.js).
const legacyAgfId = base => base.toLowerCase().replace(/[^a-z0-9]/g, '_');

// Ids an AGF file never gets: the built-in library's, and the one the Material
// Editor gives the open design's own materials.
const RESERVED_IDS = new Set(['builtin', 'design']);

// FNV-1a of a string, as 8 hex digits: short, and the same for the same file
// name on every computer.
function nameHash(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * The catalog made from this AGF file before, or null: the one that records the
 * file, else one an earlier build made under the file's slug that holds a glass
 * the file defines. Two names that gave the same slug (any two Cyrillic names of
 * one length) left one catalog behind, holding the glasses of whichever file
 * came last; the glass check gives it back to that file.
 */
function agfCatalogOf(fileName, catalogs, fileGlassIds) {
    const wanted = fileName.toLowerCase();
    const recorded = catalogs.find(cat => cat.source === 'agf' && String(cat.sourceFile || '').toLowerCase() === wanted);
    if (recorded) return recorded;
    const legacy = catalogs.find(cat => cat.source === 'agf' && !cat.sourceFile && cat.id === legacyAgfId(baseName(fileName)));
    if (!legacy) return null;
    const held = Object.keys(legacy.materials);
    return held.length === 0 || fileGlassIds().some(id => legacy.materials[id]) ? legacy : null;
}

/**
 * The id for a catalog made from a new AGF file: the slug of its name, as
 * before. When the slug lost characters of the name, is reserved, or another
 * catalog has it, a hash of the name follows it, so two files never share one;
 * the slug's runs of underscores are shortened then, and a name with no letter
 * or digit it keeps ('ЛЗОС') becomes 'agf'.
 */
function newAgfId(fileName, catalogs) {
    const base = baseName(fileName);
    const slug = legacyAgfId(base);
    const taken = id => RESERVED_IDS.has(id) || catalogs.some(cat => cat.id === id);
    if (slug && slug === base.toLowerCase() && !taken(slug)) return slug;
    const readable = slug.replace(/_+/g, '_').replace(/^_|_$/g, '') || 'agf';
    const hashed = `${readable}_${nameHash(base.toLowerCase())}`;
    let id = hashed, n = 2;
    while (taken(id)) id = `${hashed}_${n++}`;
    return id;
}

// A catalog with no recorded size or time was made before they were recorded
// and counts as current, so nothing is rebuilt on the first start.
function isCurrent(cat, file) {
    if (cat.sourceSize == null || cat.sourceMtime == null) return true;
    return cat.sourceSize === file.size && cat.sourceMtime === file.mtimeMs;
}

const sourceFields = file => ({ sourceFile: file.fileName, sourceSize: file.size ?? null, sourceMtime: file.mtimeMs ?? null });

/**
 * Make or refresh the catalog of one AGF file.
 *
 * A new file gets a catalog named after it. A file that has one gets it rebuilt
 * when it changed, or always with `force` (the user imported it): the file's
 * glasses replace the ones it defines, and every other material of the catalog
 * stays, so a design that uses one keeps it. The catalog keeps its id, name and
 * stamp. An unchanged file only has its record completed.
 *
 * @param {{ fileName: string, text: string, size?: number, mtimeMs?: number }} file
 * @returns {{ catalog: Object, rejected: Array }|null} null when nothing was rebuilt
 */
export function registerAgfFile(file, { force = false } = {}) {
    const catalogs = getCatalogs();
    let parsed = null;
    const parse = () => parsed || (parsed = parseAGF(file.text, 'agf'));
    const existing = agfCatalogOf(file.fileName, catalogs, () => Object.keys(parse().materials));

    if (existing && !force && isCurrent(existing, file)) {
        if (existing.sourceFile !== file.fileName || existing.sourceSize == null) {
            Object.assign(existing, sourceFields(file));
            persistCatalog(existing);
        }
        return null;
    }

    const { materials, rejected } = parse();
    const catalog = existing
        ? addCatalog({ ...existing, ...sourceFields(file), materials: { ...existing.materials, ...materials } })
        : addCatalog({
            id: newAgfId(file.fileName, catalogs), name: baseName(file.fileName) || 'AGF',
            source: 'agf', ...sourceFields(file), materials,
        });
    return { catalog, rejected };
}

// Auto-scan Documents\TFStudio\Materials\agf\ for .agf files and register or
// refresh their catalogs. Each file is handled on its own, so one that fails
// does not stop the rest. Nothing is on screen yet to report a glass the parser
// left out, so the console names it.
async function scanAndRegisterAgfCatalogs() {
    if (!window.electronAPI?.scanAgfDir) return;
    let agfResult;
    try { agfResult = await window.electronAPI.scanAgfDir(); } catch (_) { return; }
    if (!agfResult?.success) return;
    for (const file of agfResult.files) {
        try {
            const result = registerAgfFile(file);
            for (const glass of result?.rejected || []) {
                console.warn(`AGF ${file.fileName}: glass "${glass.name}" not imported, formula number "${glass.formula}" is not a Zemax formula.`);
            }
        } catch (err) {
            console.warn(`AGF ${file.fileName}: not imported, ${err.message}`);
        }
    }
}

/**
 * Load every catalog. The 'catalogs-loaded' event it ends with carries
 * `unreadable`, the catalog files that could not be read and were left out
 * (see useCatalogSaveFailures).
 */
export async function loadCatalogsFromDisk() {
    let persistedCatalogs = {};
    let unreadable = [];

    if (window.electronAPI?.loadCatalogs) {
        const result = await window.electronAPI.loadCatalogs();
        if (result.success) persistedCatalogs = result.catalogs;
        unreadable = result.unreadable || [];
    }

    if (Object.keys(persistedCatalogs).length === 0) {
        await migrateLegacyCatalogsFromLocalStorage(persistedCatalogs);
    }

    initCatalogs(persistedCatalogs);

    await scanAndRegisterAgfCatalogs();
    stampCatalogs();

    // Notify any already-mounted catalog consumers to refresh.
    window.dispatchEvent(new CustomEvent('catalogs-loaded', { detail: { unreadable } }));
    return { unreadable };
}
