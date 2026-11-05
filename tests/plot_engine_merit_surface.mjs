/**
 * The Plot Engine's merit surface at the design reads what the Merit Function
 * Editor shows: at the design's own thicknesses the surface is the editor's
 * MF, band operands sampled for the design's fringes (operand-families fixture).
 *
 * Run: node tests/plot_engine_merit_surface.mjs
 */
import assert from 'node:assert/strict';
import { fixtureFile } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');
const { computeSurface } = await import('../src/utils/physics/plotQuantities.js');
const { meritTable } = await import('../src/utils/physics/meritDisplay.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');

await api.init();

// The MF at one point (x, y) of a surface over two layer variables.
function surfaceAt(design, xVar, x, yVar, y) {
    const surface = computeSurface({ z: 'MF', xVar, xFrom: x, xTo: x, xSteps: 2, yVar, yFrom: y, yTo: y, ySteps: 2 },
        design, designMaterialLookup(design));
    assert.ok(surface.ok, `surface over ${xVar} and ${yVar}`);
    return surface.z[0][0];
}

{
    const design = api.openDesign(fixtureFile('operand-families'));
    const [first, second] = design.frontLayers;
    assert.equal(surfaceAt(design, 'thk:0', first.thickness, 'thk:1', second.thickness),
        meritTable(design, design.meritOperands).mf, 'the surface at the design is the editor MF');
}

console.log('PASS: plot_engine_merit_surface');
