import assert from 'node:assert/strict';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ initCatalogs }, { computeMonitor }, { designMaterialLookup }] = await Promise.all([
    import('../src/utils/materials/catalogManager.js'),
    import('../src/utils/physics/statusMonitorEvaluation.js'),
    import('../src/utils/materials/designMaterials.js'),
]);
initCatalogs({});

const design = {
    id: 'monitors', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'both_independent', mfEvalMode: 'total', referenceWavelength: 550,
    frontLayers: [
        { id: 'f1', material: 'TiO2', thickness: 65, locked: false },
        { id: 'f2', material: 'SiO2', thickness: 95, locked: false },
    ],
    backLayers: [{ id: 'b1', material: 'SiO2', thickness: 80, locked: false }],
};
const resolve = designMaterialLookup(design);

assert.equal(computeMonitor({ type: 'fact', fact: 'layerCount' }, design, resolve), 3);
assert.equal(computeMonitor({ type: 'fact', fact: 'materialCount' }, design, resolve), 2);
assert.equal(computeMonitor({ type: 'fact', fact: 'totalThickness' }, design, resolve), 240);
assert.equal(computeMonitor({ type: 'fact', fact: 'minThickness' }, design, resolve), 65);
assert.equal(computeMonitor({ type: 'fact', fact: 'maxThickness' }, design, resolve), 95);
assert.equal(computeMonitor({ type: 'TT' }, design, resolve), 240);
assert.equal(computeMonitor({ type: 'MNT', layerStart: 1, layerEnd: 3 }, design, resolve), 65);
assert.equal(computeMonitor({ type: 'MXT', layerStart: 1, layerEnd: 3 }, design, resolve), 95);

const point = computeMonitor({ type: 'point', qty: 'R', lambda: 550, aoi: 0, pol: 'avg' }, design, resolve);
assert.ok(Number.isFinite(point) && point >= 0 && point <= 100, 'legacy percentage monitor remains valid');

for (const monitor of [
    { type: 'GD', lambda: 550, aoi: 0, pol: 'avg' },
    { type: 'GDD', lambda: 550, aoi: 0, pol: 'avg' },
    { type: 'PSI', lambda: 550, aoi: 45, pol: 'avg' },
    { type: 'MXWR', lambdaStart: 450, lambdaEnd: 700, aoi: 0, pol: 'avg' },
    { type: 'EFMX', lambda: 550, aoi: 0, pol: 'avg' },
]) {
    assert.ok(Number.isFinite(computeMonitor(monitor, design, resolve)), `${monitor.type} monitor evaluates`);
}

console.log('PASS: status_monitor_types');
