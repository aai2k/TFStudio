/**
 * An MNT or MXT status monitor keeps covering the layers synthesis adds.
 *
 * Picking MNT or MXT in the monitor form sets the range 1 to
 * DEFAULT_CONSTRAINT_LAST_LAYER, the range a new merit row gets, not 1 to the
 * layer count at that moment. A monitor made on a 2-layer stack still reads the
 * thinnest and thickest layer once the stack has grown to 4. A range the user
 * typed survives a switch between MNT and MXT.
 *
 * Run: node tests/monitor_layer_range_default.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ monitorTypePatch }, { computeMonitor }, { designMaterialLookup }, { DEFAULT_CONSTRAINT_LAST_LAYER }] = await Promise.all([
    import('../src/components/SpectralMonitor.js'),
    import('../src/utils/physics/statusMonitorEvaluation.js'),
    import('../src/utils/materials/designMaterials.js'),
    import('../src/utils/physics/optimizer.js'),
]);

const design = thicknesses => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: thicknesses.map((thickness, i) => ({ id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false })),
    backLayers: [],
});
const read = (monitor, d) => computeMonitor(monitor, d, designMaterialLookup(d));

const form = { qty: 'R', type: 'avg', lambda: 550, lambdaStart: 400, lambdaEnd: 800, aoi: 0, pol: 'avg' };
const mnt = { ...form, ...monitorTypePatch(form, 'MNT') };
const mxt = { ...form, ...monitorTypePatch(form, 'MXT') };
assert.deepEqual([mnt.layerStart, mnt.layerEnd], [1, DEFAULT_CONSTRAINT_LAST_LAYER], 'MNT covers every layer by default');
assert.deepEqual([mxt.layerStart, mxt.layerEnd], [1, DEFAULT_CONSTRAINT_LAST_LAYER], 'MXT covers every layer by default');

const grown = design([80, 60, 7, 300]);
assert.equal(read(mnt, grown), 7, 'MNT reads a thin layer synthesis added');
assert.equal(read(mxt, grown), 300, 'MXT reads a thick layer synthesis added');

const typed = { ...mnt, layerStart: 2, layerEnd: 3 };
const switched = { ...typed, ...monitorTypePatch(typed, 'MXT') };
assert.deepEqual([switched.type, switched.layerStart, switched.layerEnd], ['MXT', 2, 3], 'a typed range survives MNT to MXT');

console.log('PASS: monitor_layer_range_default');
