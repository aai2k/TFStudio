// Total thickness is the coated sides wherever it is shown: the status bar and
// the Report read the number the TT row reads, and a back stack a design is not
// evaluated with is counted by no Specification check, nor is a stored front on
// a design scored on its back alone.
import assert from 'node:assert/strict';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ initCatalogs }, { computeMonitor }, { designMaterialLookup }, optimizer, { designSummary }, { evaluateQualifier }] = await Promise.all([
    import('../src/utils/materials/catalogManager.js'),
    import('../src/utils/physics/statusMonitorEvaluation.js'),
    import('../src/utils/materials/designMaterials.js'),
    import('../src/utils/physics/optimizer.js'),
    import('../src/utils/report/reportData/sectionData.js'),
    import('../src/utils/synthesis/qualifiers.js'),
]);
initCatalogs({});

const side = [{ material: 'TiO2', thickness: 1000 }, { material: 'SiO2', thickness: 1000 }];
const base = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    referenceWavelength: 550, frontLayers: side,
};
const symmetric = { ...base, surfaceMode: 'symmetric', backLayers: [...side].reverse() };
const frontAlone = { ...base, surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: side };

for (const design of [symmetric, frontAlone]) {
    const resolve = designMaterialLookup(design);
    const tt = optimizer.evaluateOperands([optimizer.makeOperand({ type: 'TT', target: 0 })],
        optimizer.buildEvalContext(design, resolve))[0];
    assert.equal(tt, 2000, `${design.surfaceMode}: TT`);
    assert.equal(computeMonitor({ type: 'fact', fact: 'totalThickness' }, design, resolve), tt, `${design.surfaceMode}: status bar`);
    assert.equal(designSummary(design).totalThickness, tt, `${design.surfaceMode}: Report`);
}

// The front-only design is scored on its front alone: its stored back is not
// listed in the Report, and checks over both sides count the front.
const resolve = designMaterialLookup(frontAlone);
assert.equal(designSummary(frontAlone).backCount, 0);
const check = kind => evaluateQualifier({ id: kind, enabled: true, kind, cmp: 'le', target: 1e6, side: 'both' }, frontAlone, resolve).value;
assert.equal(check('LAYER_COUNT'), 2);
assert.equal(check('THICKNESS_BUDGET'), 2000);

// The mirror case: a back-only design scored on its back alone does not list or
// count its stored front.
const backAlone = { ...base, surfaceMode: 'back_only', mfEvalMode: 'side', backLayers: side };
const backResolve = designMaterialLookup(backAlone);
const backTT = optimizer.evaluateOperands([optimizer.makeOperand({ type: 'TT', target: 0 })],
    optimizer.buildEvalContext(backAlone, backResolve))[0];
assert.equal(backTT, 2000, 'back_only: TT');
const backSummary = designSummary(backAlone);
assert.equal(backSummary.frontCount, 0);
assert.equal(backSummary.totalThickness, backTT, 'back_only: Report');
const backCheck = kind => evaluateQualifier({ id: kind, enabled: true, kind, cmp: 'le', target: 1e6, side: 'both' }, backAlone, backResolve).value;
assert.equal(backCheck('LAYER_COUNT'), 2);
assert.equal(backCheck('THICKNESS_BUDGET'), 2000);

console.log('total_thickness_coated_sides: ok');
