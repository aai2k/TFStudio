/**
 * The Structural Optimizer's needle proposals come from the scan Needle and
 * Gradual Evolution run: SYNTHESIS_INTRA_SAMPLES points inside each layer, cut
 * to the minima of the needle function along each layer (intraMinima).
 *
 * Four points can step over a minimum of the needle function, which repeats
 * every lambda/(2n) of depth (synthesisConfig/intraSamples.js).
 *
 *   1. The scan job returns the candidates of a 16-point scan of the design,
 *      reduced to the minima, the best first: the same list the synthesis
 *      worker's scan gives for the same design.
 *   2. Its inside-layer candidates sit on the 16-point grid, at multiples of
 *      1/17 of the layer, and some are off the 4-point grid (multiples of 1/5).
 *
 * Run: node tests/structural_needle_scan_points.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
await initWasmForTest();

const O = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { STRUCTURAL_JOBS } = await import('../src/utils/structural/workerJobs.js');
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { SYNTHESIS_INTRA_SAMPLES } = await import('../src/utils/synthesis/synthesisConfig.js');

const resolveMat = id => getMaterial(id);
const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const design = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: [layer('F1', 'TiO2', 310), layer('F2', 'SiO2', 240), layer('F3', 'TiO2', 180)],
};
const operands = [O.makeOperand({ type: 'TGT', lambdaStart: 450, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 1, targetEnd: 1, weight: 1 })];
const pool = ['TiO2', 'SiO2'].map(id => ({ id, name: id }));

const scan = STRUCTURAL_JOBS.structuralNeedleScan({
    pool, operands, design, deltaNm: 0.5, side: 'front', dMin: 1, count: 1000,
}, resolveMat);

let synthesis = null;
dispatchSynthesisJob({
    type: 'scan', operands, design, poolSlice: pool, deltaNm: 0.5, side: 'front', dMin: 1, nIntra: SYNTHESIS_INTRA_SAMPLES,
}, resolveMat, m => { if (m.type === 'result') synthesis = m; });
const expected = synthesis.candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF);

assert.equal(scan.length, expected.length, 'the same number of candidates as the synthesis scan');
scan.forEach((c, i) => {
    const e = expected[i];
    assert.deepEqual([c.pos, c.layerK, c.materialId, c.dMF], [e.pos, e.layerK, e.materialId, e.dMF], `candidate ${i} is the synthesis scan's`);
});

const inside = scan.filter(c => c.intra);
assert.ok(inside.length > 0, 'setup: the scan finds a needle inside a layer');
const grid = SYNTHESIS_INTRA_SAMPLES + 1;
for (const c of inside) {
    assert.ok(Math.abs(c.frac * grid - Math.round(c.frac * grid)) < 1e-9, `inside-layer position ${c.frac} is on the 16-point grid`);
}
assert.ok(inside.some(c => Math.abs(c.frac * 5 - Math.round(c.frac * 5)) > 1e-9), 'some inside-layer candidate is off the 4-point grid');

console.log('PASS structural_needle_scan_points');
