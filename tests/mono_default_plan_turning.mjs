/**
 * The default Mono plan cuts a layer that is 6 % or more off a whole number of
 * quarter waves on a turning point, at the wavelength where its signal turns
 * nearest its target.
 *
 * A level cut on such a layer can miss with ordinary index errors (it then runs
 * to the scan budget). A turning cut at the reference wavelength would stop at
 * the turning point, not at the target. The default plan therefore looks, in
 * 0.7 to 1.3 times the reference wavelength to the nearest nm, for the wavelength
 * where the model signal on the nominal stack turns nearest the target, and cuts
 * on that turn (order 1). A layer with no turn within 6 % of a quarter wave of
 * its target in that band keeps its level cut at the reference.
 *
 *   1. The narrowband lesson design (nine layers, quarter waves at 550 nm,
 *      TiO2 / SiO2 on BK7) with its reference set to 600 nm, where every layer
 *      is about 0.9 quarter waves: every layer is a turning cut, at 550 nm on
 *      layers 1-6 and 8, 632 nm on layer 7 and 421 nm on layer 9 (layer 1 is
 *      on the glass).
 *   2. A 9 nm TiO2 layer on BK7, whose signal turns nowhere near 9 nm in the
 *      band: level at the reference.
 *   3. Layers within 6 % of a whole number of quarter waves keep their turning
 *      cut at the reference, and the table is aligned to the design.
 *
 * Run: node tests/mono_default_plan_turning.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { defaultMonoTable } = await import('../src/utils/monitoring/monoSim.js');

const resolveMat = id => getMaterial(id);
const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const design = (frontLayers, referenceWavelength) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', backLayers: [], referenceWavelength, frontLayers,
});

// 1. Layer 1 is next to the glass, so it is the last in storage order.
{
    const onGlass = [['TiO2', 54.64], ['SiO2', 94.18], ['TiO2', 54.64], ['SiO2', 94.18], ['TiO2', 109.28], ['SiO2', 94.18], ['TiO2', 54.64], ['SiO2', 94.18], ['TiO2', 54.64]];
    const front = onGlass.map(([material, thickness], k) => layer(`L${k + 1}`, material, thickness)).reverse();
    const table = defaultMonoTable(design(front, 600), resolveMat);
    const fromGlass = table.slice().reverse();
    assert.deepEqual(fromGlass.map(row => row.strategy), Array(9).fill('turning'), 'every layer is a turning cut');
    assert.deepEqual(fromGlass.map(row => row.lambda), [550, 550, 550, 550, 550, 550, 632, 550, 421], 'each at the wavelength its signal turns nearest the target');
    assert.ok(table.every(row => row.order === 1 && row.sigmaRelPct === 0), 'first order, no extra error');
}

// 2. A layer with no turn near its target.
{
    const table = defaultMonoTable(design([layer('A', 'TiO2', 9)], 550), resolveMat);
    assert.deepEqual(table, [{ lambda: 550, strategy: 'level', order: 1, sigmaRelPct: 0 }], 'a 9 nm layer keeps its level cut at the reference');
}

// 3. A quarter-wave stack at its own reference.
{
    const nH = getMaterial('TiO2').getNK(550)[0], nL = getMaterial('SiO2').getNK(550)[0];
    const front = [layer('H', 'TiO2', 550 / (4 * nH)), layer('L', 'SiO2', 550 / (4 * nL)), layer('H2', 'TiO2', 550 / (4 * nH))];
    const table = defaultMonoTable(design(front, 550), resolveMat);
    assert.equal(table.length, 3, 'one row per layer');
    assert.ok(table.every(row => row.lambda === 550 && row.strategy === 'turning'), 'quarter waves keep their turning cut at the reference');
}

console.log('PASS mono_default_plan_turning');
