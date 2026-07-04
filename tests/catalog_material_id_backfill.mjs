/**
 * Regression — catalog materials without an `id` field.
 *
 * Some persisted catalogs (e.g. the legacy multipassband sample) stored material
 * entries keyed by name but WITHOUT an explicit `id` field. In the Material
 * Editor those rendered as dead grey rows that sorted to the very top (empty id
 * sorts first) and crashed on click — materialToDraft did `mat.id.replace(...)`
 * on an undefined id (TypeError: Cannot read properties of undefined).
 *
 * The registry now backfills `id` from the map key at the registration boundary
 * (initCatalogs + addCatalog), so a material's id is always its key. This test
 * pins that: an id-less material loaded via initCatalogs or addCatalog comes
 * back with id === key, and searchMaterials reports no id-less entries.
 *
 * Run: node tests/catalog_material_id_backfill.mjs
 */

globalThis.window = { electronAPI: { saveCatalog() {}, deleteCatalog() {} } };

const { initCatalogs, addCatalog, searchMaterials, getCatalog } =
    await import('../src/utils/materials/catalogManager.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ✓', msg); } };

// ── 1. initCatalogs backfills id from the map key ─────────────────────────────
initCatalogs({
    legacy_mpb: {
        id: 'legacy_mpb', name: 'Legacy MPB', source: 'user',
        materials: {
            // No `id` field — exactly the stale on-disk shape.
            TiO2: { name: 'TiO2', formulaNum: -1, tabData: [[400, 2.4, 0], [700, 2.3, 0]], group: 'Dielectric' },
            SiO2: { name: 'SiO2', formulaNum: -1, tabData: [[400, 1.47, 0], [700, 1.45, 0]], group: 'Dielectric' },
        },
    },
});
const mpb = getCatalog('legacy_mpb');
ok(mpb.materials.TiO2.id === 'TiO2', 'initCatalogs: TiO2 id backfilled from key');
ok(mpb.materials.SiO2.id === 'SiO2', 'initCatalogs: SiO2 id backfilled from key');

const res = searchMaterials('', 'legacy_mpb');
ok(res.length === 2, 'searchMaterials returns both materials');
ok(res.every(r => r.material.id), 'no id-less (top-sorting, crash-on-click) phantom remains');

// ── 2. addCatalog backfills too ───────────────────────────────────────────────
addCatalog({
    id: 'rt_inject', name: 'Runtime', source: 'user',
    materials: { ZrO2: { name: 'ZrO2', formulaNum: -1, tabData: [[500, 2.1, 0]] } },
});
ok(getCatalog('rt_inject').materials.ZrO2.id === 'ZrO2', 'addCatalog: id backfilled from key');

// ── 3. An explicit id is preserved (not clobbered by the key) ─────────────────
addCatalog({
    id: 'keep_id', name: 'KeepId', source: 'user',
    materials: { somekey: { id: 'RealId', name: 'X', formulaNum: -1, tabData: [[500, 1.5, 0]] } },
});
ok(getCatalog('keep_id').materials.somekey.id === 'RealId', 'existing id is NOT overwritten by the key');

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll tests passed.');
