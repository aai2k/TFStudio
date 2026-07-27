/**
 * Regression coverage for the legacy resolver origins converted in Stage 1.
 *
 * The catalog is deliberately empty. Every calculation below must therefore
 * obtain `portable:Film` from the design's embedded materials block; a global
 * lookup would either throw or reproduce the historical Air substitution.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initCatalogs } from '../src/utils/materials/catalogManager.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { presampleMaterials } from '../src/components/windows/optimization/refinement/refinementUtils.js';
import { materialLookup } from '../src/components/windows/optimization/synthesisShared/materialNames.js';
import { buildSpectrum } from '../src/utils/report/reportData/engines.js';
import { buildDepositionModel } from '../src/components/windows/dataExchange/processSimulator/model.js';
import { collectUniqueMaterials } from '../src/components/windows/optimization/variator/model.js';
import { stackFormulaResolvers } from '../src/utils/synthesis/stackFormula.js';
import { computeSeed } from '../src/components/windows/design/stackFormula/model.js';
import { buildAllProcessFiles } from '../src/utils/io/processFileExport.js';

globalThis.React = {
    createElement: () => null,
    useRef: () => ({ current: null }),
    useEffect: () => {},
};
const { computeWizardResultSpectra } = await import(
    '../src/components/windows/simulation/wizardShared.js');

const FILM_ID = 'portable:Film';
const design = {
    id: 'embedded-origin-coverage', name: 'Embedded origin coverage',
    incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    surfaceMode: 'front_only', referenceWavelength: 550,
    frontLayers: [{ id: 'f1', material: FILM_ID, thickness: 100 }],
    backLayers: [],
    materials: {
        [FILM_ID]: {
            id: 'Film', name: 'Portable film', formulaNum: -1,
            tabData: [[400, 2.2, 0.01], [800, 2.2, 0.01]],
        },
    },
};

initCatalogs({});
const resolveMaterial = designMaterialLookup(design);
assert.deepEqual(resolveMaterial(FILM_ID).getNK(550), [2.2, 0.01]);
assert.equal(materialLookup(design)(FILM_ID).name, 'Portable film');

const operands = [{
    id: 'op-1', type: 'T', enabled: true,
    lambdaStart: 550, target: 0.5, weight: 1, aoi: 0, pol: 'avg',
}];
const sampled = presampleMaterials(design, operands);
assert.deepEqual(sampled[FILM_ID].lambdas, [550]);
assert.deepEqual(sampled[FILM_ID].n, [2.2]);
assert.deepEqual(sampled[FILM_ID].k, [0.01]);

const reportSpectrum = buildSpectrum(design, {
    lambdaStart: 500, lambdaEnd: 600, lambdaStep: 50, thetas: [0],
});
assert.equal(reportSpectrum.lambda.length, 3);
assert.ok(reportSpectrum.series[0].T.every(Number.isFinite));

const deposition = buildDepositionModel(design, 'front');
assert.equal(deposition.activeDep[0].matObj.name, 'Portable film');
assert.deepEqual(deposition.activeDep[0].matObj.getNK(550), [2.2, 0.01]);

const variatorFilm = collectUniqueMaterials(design).find(entry => entry.id === FILM_ID);
assert.equal(variatorFilm.mat.name, 'Portable film');

const formulaResolvers = stackFormulaResolvers(design);
assert.equal(formulaResolvers.getN(FILM_ID, 550), 2.2);
assert.equal(computeSeed(design, formulaResolvers).rows[0].matId, FILM_ID);

const ctx = {
    design, simDesign: design, activeSide: 'front', evalMode: 'front',
    resolveMat: resolveMaterial,
    incMat: resolveMaterial(design.incidentMedium),
    subMat: resolveMaterial(design.substrate.material),
    exitMat: resolveMaterial(design.exitMedium),
    subThk: design.substrate.thickness, otherStored: [],
};
const wizardSpectrum = computeWizardResultSpectra({
    run: { targetFront: [100], asBuiltFront: [100], matDeltas: [{}] },
    ctx, layers: design.frontLayers, quantity: 'T', aoi: 0, pol: 'avg',
    lamMin: 500, lamMax: 600,
});
assert.ok(wizardSpectrum.theory.values.every(Number.isFinite));
assert.deepEqual(wizardSpectrum.manuf.values, wizardSpectrum.theory.values);

const processFiles = buildAllProcessFiles(design, {
    activeSide: 'front', secondSurface: 'bare', quantity: 'T',
    aoi: 0, polarization: 'avg', lambdaStart: 500, lambdaEnd: 600,
    lambdaStep: 50,
});
assert.equal(processFiles.length, 1);
assert.match(processFiles[0].content, /Portable|Film/);
assert.doesNotMatch(processFiles[0].content, /NaN|undefined/);

// Hook-only origins are exercised through their UI suites. This structural
// guard prevents the duplicated global fallback chain from being reintroduced
// into any of the twelve converted origin files.
const originFiles = [
    'src/components/windows/simulation/wizardShared.js',
    'src/components/windows/optimization/synthesisShared/materialNames.js',
    'src/components/windows/optimization/refinement/refinementUtils.js',
    'src/utils/report/reportData/engines.js',
    'src/components/windows/design/stackFormula/model.js',
    'src/components/windows/optimization/variator/model.js',
    'src/components/windows/design/specification/model.js',
    'src/components/windows/dataExchange/processSimulator/model.js',
    'src/utils/synthesis/stackFormula.js',
    'src/utils/io/processFileExport.js',
    'src/components/windows/optimization/designCleaner/useDesignCleaner.js',
    'src/components/windows/optimization/meritFunctionEditor/useMeritOperands.js',
];
const unsafeFallback = /getMaterialById\([^\n]*\)\s*\|\|\s*getMaterial\(/;
for (const file of originFiles) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), unsafeFallback,
        `${file} must not restore the global Air-fallback chain`);
}

console.log('PASS: material_resolution_origins');
