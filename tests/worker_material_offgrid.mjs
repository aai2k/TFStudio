/**
 * A compute worker asked for n,k at a wavelength its presampled table does not
 * hold computes it from the material's own dispersion model, bit for bit what
 * the main thread computes, instead of reading the nearest sample.
 *
 * The table goes through structuredClone first, as postMessage sends it, and
 * the worker resolver reads it with only the built-in catalog registered, as a
 * worker has it. Covered: built-in ids (compound
 * and bare legacy), catalog materials with a Sellmeier formula, a k table and a
 * tabulated entry, a material only the design carries, and the nearest-sample
 * fallback kept for an entry with no definition.
 */
import assert from 'node:assert/strict';

const warnings = [];
globalThis.postMessage = message => warnings.push(message);

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { buildPresampledTable } = await import('../src/utils/physics/optimizer.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');

const SELLMEIER_SILICA = [0.6961663, 0.0684043 ** 2, 0.4079426, 0.1162414 ** 2, 0.8974794, 9.896161 ** 2];
initCatalogs({
    user_lab: {
        id: 'user_lab', name: 'Lab materials', source: 'user',
        materials: {
            SiO2fit: { id: 'SiO2fit', name: 'Silica (lab fit)', formulaNum: 2, coefficients: SELLMEIER_SILICA, kTable: [] },
            SiO2lossy: {
                id: 'SiO2lossy', name: 'Silica (lossy)', formulaNum: 2, coefficients: SELLMEIER_SILICA,
                kTable: [{ lam_um: 0.4, k: 0.002 }, { lam_um: 0.8, k: 0.006 }],
            },
            TiO2tab: {
                id: 'TiO2tab', name: 'Titania (measured)', formulaNum: -1,
                tabData: [[400, 2.55, 0.004], [480, 2.47, 0.002], [550, 2.42, 0.001], [620, 2.39, 0.0007], [700, 2.36, 0.0004]],
                mechanical: { youngsModulusGPa: 140, poissonsRatio: 0.27, intrinsicStressMPa: -320 },
            },
        },
    },
});

// One material only the design carries: no catalog on this machine holds it.
const design = {
    incidentMedium: 'builtin:Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [
        { id: 'f1', material: 'user_lab:TiO2tab', thickness: 60 },
        { id: 'f2', material: 'user_lab:SiO2fit', thickness: 95 },
        { id: 'f3', material: 'user_lab:SiO2lossy', thickness: 40 },
        { id: 'f4', material: 'builtin:TiO2', thickness: 50 },
        { id: 'f5', material: 'travel:Nb2O5', thickness: 70 },
    ],
    backLayers: [],
    materials: {
        'travel:Nb2O5': {
            id: 'Nb2O5', name: 'Niobia (from another lab)', formulaNum: -1,
            tabData: [[400, 2.48, 0.003], [500, 2.36, 0.001], [600, 2.31, 0.0005], [700, 2.28, 0.0002]],
        },
    },
};
const ids = ['builtin:Air', 'Air', 'BK7', 'user_lab:TiO2tab', 'user_lab:SiO2fit', 'user_lab:SiO2lossy', 'builtin:TiO2', 'travel:Nb2O5'];

const lookup = designMaterialLookup(design);
const grid = [450, 500, 550, 600, 650];
const table = structuredClone(buildPresampledTable(grid, ids.map(id => ({ id, mat: lookup(id) }))));

// Off the grid, between samples, at a band edge and outside the grid.
const offGrid = [449.999, 501.2345678, 557.53261, 612.000001, 699.75];
const lambdas = [...grid, ...offGrid];
const mainThread = new Map(ids.map(id => [id, lambdas.map(lam => lookup(id).getNK(lam))]));
const titaniaMechanical = lookup('user_lab:TiO2tab').mechanical;

// A worker holds only the built-in catalog, so the user catalog leaves the
// registry before the worker side resolves anything.
initCatalogs({});
const resolve = makeResolveMat(table, 'test');
for (const id of ids) {
    lambdas.forEach((lam, i) => {
        assert.deepEqual(resolve(id).getNK(lam), mainThread.get(id)[i], `${id} at ${lam} nm matches the main thread`);
    });
}
assert.equal(warnings.length, 0, 'no wavelength fell back to the nearest sample');

assert.ok(table['user_lab:SiO2fit'].record, 'a catalog material carries its definition');
assert.ok(table['travel:Nb2O5'].record, 'a material only the design carries does too');
assert.equal(table['builtin:TiO2'].record, undefined, 'a built-in id carries none: the worker library serves it');
assert.equal(table.BK7.record, undefined, 'nor does a bare built-in id');
assert.deepEqual(resolve('user_lab:TiO2tab').mechanical, titaniaMechanical, 'mechanical constants still ride along');

// An id the table lacks reads Air, off its grid as well.
assert.deepEqual(resolve('user_lab:Missing').getNK(523.4), [1, 0], 'an id missing from the table reads Air');
assert.equal(warnings.length, 0, 'which needs no fallback either');

// An entry built without a definition, for an id the worker cannot serve,
// keeps the nearest-sample fallback and reports it once.
const legacy = structuredClone({ 'user_lab:SiO2fit': { lambdas: grid, n: grid.map(l => lookup('user_lab:SiO2fit').getNK(l)[0]), k: grid.map(() => 0) } });
const legacyResolve = makeResolveMat(legacy, 'legacy');
assert.deepEqual(legacyResolve('user_lab:SiO2fit').getNK(512), [legacy['user_lab:SiO2fit'].n[1], 0], 'nearest sample without a definition');
legacyResolve('user_lab:SiO2fit').getNK(613);
assert.equal(warnings.length, 1, 'the fallback is reported once');
assert.match(warnings[0].message, /legacy/);

console.log('worker_material_offgrid: ok');
