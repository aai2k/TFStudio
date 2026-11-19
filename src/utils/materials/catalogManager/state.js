import { buildBuiltinCatalog } from './builtinCatalog.js';

// The registry: id → catalog object. Lazily seeded with the builtin catalog on
// first access, or wholesale-replaced by initCatalogs() at app start.
let _catalogs = {};
let _initialized = false;

function ensureInit() {
    if (_initialized) return;
    _catalogs = { builtin: buildBuiltinCatalog() };
    _initialized = true;
}

/** Live registry map (id → catalog); mutate in place to add/remove/update entries. */
export function getRegistry() {
    ensureInit();
    return _catalogs;
}

/**
 * Raw registry map with NO lazy-init side effect: it does not seed the built-in
 * catalog, so a caller before initCatalogs sees the registry empty.
 */
export function peekRegistry() {
    return _catalogs;
}

/** Replace the entire registry wholesale (used by initCatalogs at app start). */
export function replaceRegistry(newCatalogs) {
    _catalogs = newCatalogs;
    _initialized = true;
}
