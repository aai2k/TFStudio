/**
 * On a symmetric design, whose back is its front reversed, a layer sweep in the
 * Plot Engine moves the layer on both faces, for every quantity: T, R and A
 * read on the back or the whole part, and the quantities computed from a design
 * (phase, GD, Psi and Delta). The merit along the same axis already did.
 *
 * Each point of a sweep equals the same point of the design edited as the
 * design store edits it, front layer set and back rebuilt as its mirror.
 *
 * Run: node tests/plot_engine_symmetric_sweep.mjs
 */
import assert from 'node:assert/strict';
import { initWasmForTest } from './_wasmInit.mjs';
import { computeSurface } from '../src/utils/physics/plotQuantities.js';
import { mirrorLayers } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

await initWasmForTest();
const resolveMat = id => getMaterial(id);
const layer = (material, thickness) => ({ id: `${material}${thickness}`, material, thickness, locked: false });
const front = [layer('SiO2', 94), layer('TiO2', 120), layer('SiO2', 30), layer('TiO2', 15)];
const symmetric = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'symmetric', mfEvalMode: 'total', meritOperands: [],
    frontLayers: front, backLayers: mirrorLayers(front),
};
const edited = (index, thickness) => {
    const frontLayers = front.map((l, i) => (i === index ? { ...l, thickness } : l));
    return { ...symmetric, frontLayers, backLayers: mirrorLayers(frontLayers) };
};

const surface = (z, surfaceMode, design, axes) => {
    const spec = {
        z, polarization: 'avg', surfaceMode, fixedLambda_nm: 550, fixedAOI_deg: 45,
        yVar: 'aoi', yFrom: 45, yTo: 55, ySteps: 2, ...axes,
    };
    const result = computeSurface(spec, design, resolveMat);
    assert.ok(result.ok, `${z} on ${surfaceMode}: the surface computes`);
    return result;
};
// The value at 550 nm and 45 degrees of a design as it stands, no sweep.
const valueOf = (z, surfaceMode, design) =>
    surface(z, surfaceMode, design, { xVar: 'wavelength', xFrom: 550, xTo: 560, xSteps: 2 }).z[0][0];

for (const [z, mode] of [['T', 'total'], ['R', 'total'], ['T', 'back'], ['R', 'back'], ['psi', 'back'], ['gdR', 'total']]) {
    for (const index of [0, 2]) {
        const swept = surface(z, mode, symmetric, { xVar: `thk:${index}`, xFrom: 60, xTo: 180, xSteps: 3 });
        swept.x.forEach((thickness, i) => {
            const expected = valueOf(z, mode, edited(index, thickness));
            const got = swept.z[0][i];
            assert.ok(Math.abs(got - expected) <= 1e-12 * Math.max(1, Math.abs(expected)),
                `${z} read on ${mode}, layer ${index} at ${thickness} nm: ${got} against ${expected}`);
        });
    }
}

console.log('PASS plot_engine_symmetric_sweep');
