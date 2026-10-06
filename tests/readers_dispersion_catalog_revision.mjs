/**
 * Material Dispersion follows the catalogs.
 *
 * The window plots one material picked from the catalogs, usually one the open
 * design does not use, so nothing about the design changes when that material
 * is edited or deleted in the Material Editor. The material it plots has to be
 * resolved again on the catalog notice, or the window keeps drawing the old n,k
 * until it is closed, and an empty plot after a delete.
 */
import assert from 'node:assert/strict';
import { importWithHookRuntime, makeHookRuntime } from './_hookHarness.mjs';

// A window that delivers events, so the catalog notice reaches the hook.
globalThis.window = Object.assign(new EventTarget(), {
    electronAPI: { saveCatalog() {}, deleteCatalog() {} },
});

const catalogManager = await import('../src/utils/materials/catalogManager.js');
const runtime = makeHookRuntime();
const { useDispersionMaterial } = await importWithHookRuntime(
    '../src/components/windows/analysis/materialDispersion/useDispersionMaterial.js', runtime);

catalogManager.initCatalogs({});
const catalog = catalogManager.createUserCatalog('Glass');
const glass = index => ({ id: 'G', name: 'G', formulaNum: -1, tabData: [[300, index, 0], [1200, index, 0]] });
catalogManager.saveUserMaterial(catalog.id, glass(1.5));
const id = `${catalog.id}:G`;
const design = {
    id: 'd', name: 'd', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [{ id: 'a', material: 'builtin:SiO2', thickness: 100 }], backLayers: [],
};
// The harness stands in for React while the hook runs: the catalog-revision
// hook reads React when it is called.
const plotted = () => {
    const real = globalThis.React;
    globalThis.React = runtime.React;
    try { return runtime.render(() => useDispersionMaterial(design, id)); } finally { globalThis.React = real; }
};

let shown = plotted();
assert.equal(shown.missing, false);
assert.ok(Math.abs(shown.material.getNK(550)[0] - 1.5) < 1e-9);
// Mount: the effects subscribe to the catalog notice.
for (const effect of runtime.pendingEffects()) effect();

catalogManager.saveUserMaterial(catalog.id, glass(1.6));
shown = plotted();
assert.ok(Math.abs(shown.material.getNK(550)[0] - 1.6) < 1e-9,
    `an edit in the Material Editor reaches the plot: n(550) = ${shown.material.getNK(550)[0]}`);

catalogManager.removeCatalog(catalog.id);
shown = plotted();
assert.equal(shown.missing, true, 'deleting the catalog is seen without any change to the design');
assert.equal(shown.material, null);

console.log('PASS: readers_dispersion_catalog_revision');
