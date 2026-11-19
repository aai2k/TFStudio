/**
 * The Design Cleaner takes a thin layer out by merging its optical thickness
 * into a neighbour.
 *
 * Tikhonravov, Trubetskov and DeBell, Appl. Opt. 46, 704 (2007), p. 706: a thin
 * layer is removed by giving it the refractive index of the layer before or
 * after it, "to keep design total optical thicknesses unchanged". The layer's
 * optical thickness n d at the design's reference wavelength goes to the
 * neighbour, d_neighbour += d n_removed / n_neighbour, with the real part of
 * each index. Of two neighbours the one with the closer index takes it. A
 * locked layer takes nothing.
 *
 *   1. A thin layer between two layers of one material: the stack's total
 *      optical thickness at the reference wavelength is the same after the
 *      cleanup, merge on or off.
 *   2. Between two materials, the neighbour with the closer index takes it, by
 *      d n_removed / n_neighbour, and the other is left as it was.
 *   3. A locked neighbour takes nothing; with no free neighbour the layer is
 *      taken out alone.
 *   4. The thinnest layer goes first, so a chain of thin layers ends in the
 *      right materials, and it keeps the total optical thickness.
 *   5. A metal (n not above k at the reference wavelength) neither hands its
 *      thickness over nor takes any: SiO2 90 / Ag 100 / Cr 2, Au 100 / Cr 2 and
 *      SiO2 90 / Au 3 / Ag 15 / SiO2 90 keep their metal thickness.
 *   6. The report still lists one 'remove' per layer taken out.
 *
 * Run: node tests/design_cleaner_optical_thickness.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { cleanupDesign } = await import('../src/utils/synthesis/designCleaner.js');

const REF = 600;
const nOf = id => getMaterial(id).getNK(REF)[0];
const layer = (id, material, thickness, locked = false) => ({ id, material, thickness, locked });
const design = (frontLayers, extra = {}) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [], referenceWavelength: REF, frontLayers, ...extra,
});
const optical = layers => layers.reduce((sum, l) => sum + nOf(l.material) * l.thickness, 0);
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), `${message} (${a} vs ${b})`);

// 1. Between two layers of one material.
for (const mergeAdjacent of [true, false]) {
    const start = [layer('a', 'TiO2', 100), layer('b', 'SiO2', 3), layer('c', 'TiO2', 80)];
    const { design: out, removedCount } = cleanupDesign(design(start), { dMin: 5, mergeAdjacent });
    assert.equal(removedCount, 1, 'one layer taken out');
    near(optical(out.frontLayers), optical(start), `the total optical thickness is kept (merge ${mergeAdjacent})`);
}

// 2. Two materials: the closer index takes it.
{
    const start = [layer('a', 'SiO2', 100), layer('b', 'TiO2', 2), layer('c', 'MgF2', 80)];
    const { design: out } = cleanupDesign(design(start), { dMin: 5 });
    assert.deepEqual(out.frontLayers.map(l => l.material), ['SiO2', 'MgF2'], 'the thin TiO2 layer is gone');
    near(out.frontLayers[0].thickness, 100 + 2 * nOf('TiO2') / nOf('SiO2'), 'SiO2, the closer index, takes its optical thickness');
    near(out.frontLayers[1].thickness, 80, 'MgF2 is as it was');
}
{
    const start = [layer('a', 'MgF2', 100), layer('b', 'TiO2', 2), layer('c', 'SiO2', 80)];
    const { design: out } = cleanupDesign(design(start), { dMin: 5 });
    near(out.frontLayers[1].thickness, 80 + 2 * nOf('TiO2') / nOf('SiO2'), 'the next layer takes it when its index is closer');
    near(out.frontLayers[0].thickness, 100, 'and the one before is as it was');
}

// 3. Locked layers take nothing.
{
    const start = [layer('a', 'SiO2', 100, true), layer('b', 'TiO2', 2), layer('c', 'MgF2', 80)];
    const { design: out } = cleanupDesign(design(start), { dMin: 5 });
    near(out.frontLayers[0].thickness, 100, 'a locked neighbour keeps its thickness');
    near(out.frontLayers[1].thickness, 80 + 2 * nOf('TiO2') / nOf('MgF2'), 'the free neighbour takes it');
}
{
    const start = [layer('a', 'SiO2', 100, true), layer('b', 'TiO2', 2), layer('c', 'MgF2', 80, true)];
    const { design: out, removedCount } = cleanupDesign(design(start), { dMin: 5 });
    assert.equal(removedCount, 1, 'the layer is taken out');
    assert.deepEqual(out.frontLayers.map(l => l.thickness), [100, 80], 'between two locked layers nothing takes it');
}

// 4. A chain of thin layers.
{
    const start = [layer('a', 'TiO2', 100), layer('b', 'SiO2', 2), layer('c', 'TiO2', 1), layer('d', 'SiO2', 2), layer('e', 'TiO2', 100)];
    const { design: out, removedCount } = cleanupDesign(design(start), { dMin: 5, mergeAdjacent: false });
    assert.equal(removedCount, 2, 'the thinnest two are taken out, and the SiO2 layer that took their thickness is above the floor');
    assert.deepEqual(out.frontLayers.map(l => l.material), ['TiO2', 'SiO2', 'TiO2'], 'so the stack keeps its materials');
    near(optical(out.frontLayers), optical(start), 'the chain leaves the total optical thickness as it was');
}
{
    // The thinnest goes first, so the 4.9 nm Ta2O5 layer takes the 0.5 nm TiO2 layer's thickness and stays,
    // where taking them in stack order would hand the Ta2O5 to the SiO2.
    const start = [layer('a', 'SiO2', 100), layer('b', 'Ta2O5', 4.9), layer('c', 'TiO2', 0.5), layer('d', 'SiO2', 80)];
    const { design: out } = cleanupDesign(design(start), { dMin: 5, mergeAdjacent: false });
    assert.deepEqual(out.frontLayers.map(l => l.material), ['SiO2', 'Ta2O5', 'SiO2'], 'the thinnest layer goes first and its neighbour stays');
    near(optical(out.frontLayers), optical(start), 'with the total optical thickness kept');
}

// 5. Metals: n d is not a metal's phase thickness, so a metal neither hands thickness over nor takes it.
{
    const thicknesses = start => cleanupDesign(design(start), { dMin: 5 }).design.frontLayers.map(l => [l.material, l.thickness]);
    assert.deepEqual(thicknesses([layer('a', 'SiO2', 90), layer('b', 'Ag', 100), layer('c', 'Cr', 2)]),
        [['SiO2', 90], ['Ag', 100]], 'a thin Cr layer next to Ag is taken out and the Ag keeps its thickness');
    assert.deepEqual(thicknesses([layer('a', 'Au', 100), layer('b', 'Cr', 2)]),
        [['Au', 100]], 'a thin Cr layer on gold is taken out and the gold keeps its thickness');
    assert.deepEqual(thicknesses([layer('a', 'SiO2', 90), layer('b', 'Au', 3), layer('c', 'Ag', 15), layer('d', 'SiO2', 90)]),
        [['SiO2', 90], ['Ag', 15], ['SiO2', 90]], 'a thin gold layer is taken out alone, between silica and silver, and neither takes its thickness');
    assert.deepEqual(thicknesses([layer('a', 'SiO2', 90), layer('b', 'TiO2', 2), layer('c', 'Ag', 100)]).map(([m]) => m),
        ['SiO2', 'Ag'], 'a thin dielectric layer next to a metal hands its thickness to the dielectric, not the metal');
    // TiO2's index is closer to Cr's than to silica's, so without the guard the metal would take it.
    const beside = cleanupDesign(design([layer('a', 'SiO2', 100), layer('b', 'TiO2', 2), layer('c', 'Cr', 50)]), { dMin: 5 }).design.frontLayers;
    assert.deepEqual(beside.map(l => l.material), ['SiO2', 'Cr'], 'the thin TiO2 layer is taken out');
    assert.equal(beside[1].thickness, 50, 'the Cr beside it, closer in index, keeps its thickness');
    near(beside[0].thickness, 100 + 2 * nOf('TiO2') / nOf('SiO2'), 'and the silica takes its optical thickness');
}

// 6. The report.
{
    const start = [layer('a', 'SiO2', 100), layer('b', 'TiO2', 2), layer('c', 'MgF2', 80)];
    const { ops } = cleanupDesign(design(start), { dMin: 5 });
    assert.deepEqual(ops.map(op => [op.kind, op.srcIdx, op.materialId, op.thickness]), [['remove', 1, 'TiO2', 2]], 'one remove, with the layer\'s own thickness');
}

console.log('PASS design_cleaner_optical_thickness');
