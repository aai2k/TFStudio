import assert from 'node:assert/strict';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [
    { replaceMaterialReferences },
    { serializeStackTable },
    { expandHerpinLayer, herpinCollapsePreview, makePerturbationMap, perturbLayers, quantizeLayers },
    { resolveDesignMaterial, designMaterialLookup },
    { buildEvalContext, evaluateOperands, makeOperand },
] = await Promise.all([
    import('../src/components/dialogs/ReplaceMaterialsDialog.js'),
    import('../src/components/windows/design/designEditor/layerClipboard.js'),
    import('../src/components/windows/design/designEditor/layerTools.js'),
    import('../src/utils/materials/designMaterials.js'),
    import('../src/utils/physics/optimizer.js'),
]);

const lambda = 550;
const base = {
    id: 'tools', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', referenceWavelength: lambda,
    frontLayers: [
        { id: 'a', material: 'SiO2', thickness: 10.126, locked: false },
        { id: 'b', material: 'TiO2', thickness: 20.874, locked: true },
    ],
    backLayers: [],
};

assert.deepEqual(quantizeLayers(base.frontLayers, base, { mode: 'decimals', value: 1 }), [
    { ...base.frontLayers[0], thickness: 10.1 },
    base.frontLayers[1],
]);
assert.equal(quantizeLayers(base.frontLayers, base, { mode: 'step', value: 0.25 })[0].thickness, 10.25);

const perturb = makePerturbationMap(base.frontLayers, () => 1);
const kicked = perturbLayers(base.frontLayers, 5, perturb);
assert.ok(Math.abs(kicked[0].thickness - base.frontLayers[0].thickness * 1.05) < 1e-12);
assert.strictEqual(kicked[1], base.frontLayers[1], 'locked layers are not perturbed');

assert.equal(serializeStackTable(base.frontLayers, id => `name:${id}`, {
    material: 'Material', thickness: 'Thickness (nm)',
}),
    'Material\tThickness (nm)\nname:SiO2\t10.126\nname:TiO2\t20.874');

const replaced = replaceMaterialReferences(base, { SiO2: 'TiO2' }, {
    keepOpticalThickness: true, referenceWavelength: lambda,
});
const nOld = resolveDesignMaterial(base, 'SiO2').material.getNK(lambda)[0];
const nNew = resolveDesignMaterial(base, 'TiO2').material.getNK(lambda)[0];
assert.ok(Math.abs(replaced.frontLayers[0].thickness * nNew - base.frontLayers[0].thickness * nOld) < 1e-10,
    'replace-material preserves n·d at λ₀');

const herpinDesign = {
    ...base,
    frontLayers: [
        { id: 'h1', material: 'SiO2', thickness: 10, locked: false },
        { id: 'h2', material: 'TiO2', thickness: 18, locked: false },
        { id: 'h3', material: 'SiO2', thickness: 10, locked: false },
    ],
};
const collapsed = herpinCollapsePreview(herpinDesign, 'front', ['h1', 'h2', 'h3'], lambda);
assert.equal(collapsed.design.frontLayers.length, 1);
assert.equal(collapsed.equivalentLayer.herpin.originalLayers.length, 3);
const equivalentPhase = 2 * Math.PI
    * collapsed.equivalentLayer.herpin.equivalentIndex
    * collapsed.equivalentLayer.thickness / lambda;
const equivalentMatrix = {
    a: Math.cos(equivalentPhase),
    b: Math.sin(equivalentPhase) / collapsed.equivalentLayer.herpin.equivalentIndex,
    c: collapsed.equivalentLayer.herpin.equivalentIndex * Math.sin(equivalentPhase),
    d: Math.cos(equivalentPhase),
};
for (const key of ['a', 'b', 'c', 'd']) {
    assert.ok(Math.abs(collapsed.matrix[key] - equivalentMatrix[key]) < 1e-10,
        `Herpin ${key} matrix element matches Macleod 7.5–7.10`);
}
const op = makeOperand({ type: 'R', lambdaStart: lambda, lambdaEnd: lambda, target: 0, weight: 1 });
const evalR = design => evaluateOperands([op], buildEvalContext(design, designMaterialLookup(design)))[0];
assert.ok(Math.abs(evalR(herpinDesign) - evalR(collapsed.design)) < 1e-10,
    'Herpin single layer reproduces the selected matrix at λ₀');
const expanded = expandHerpinLayer(collapsed.design, 'front', collapsed.equivalentLayer.id);
assert.deepEqual(expanded.frontLayers, herpinDesign.frontLayers, 'Herpin expansion restores the original group exactly');
assert.equal(expanded.materials?.[collapsed.equivalentLayer.material], undefined,
    'expansion removes the unused design-scoped equivalent material');

assert.throws(
    () => herpinCollapsePreview({ ...herpinDesign, frontLayers: [
        herpinDesign.frontLayers[0], { ...herpinDesign.frontLayers[1], thickness: 19 }, herpinDesign.frontLayers[2],
    ] }, 'front', ['h1', 'h2'], lambda),
    /symmetric/i,
);

console.log('PASS: design_editor_tooling');
