/**
 * The welcome samples are quarter waves at their reference wavelength in the
 * catalog materials they use: every layer's optical thickness, n(О»0)В·d, is
 * О»0 / 4 within the 0.1 nm the thicknesses are given to.
 *
 * A sample design is named as the welcome card names it, so a Russian, Chinese or
 * Italian user gets the design under their own language's name.
 *
 * Run: node tests/sample_designs_quarter_wave.mjs
 */
import assert from 'node:assert/strict';
import { buildSampleDesigns } from '../src/utils/samples/sampleDesigns.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

for (const sample of buildSampleDesigns()) {
    const design = sample.build();
    const lam0 = design.referenceWavelength;
    assert.ok(design.frontLayers.length > 0, `${sample.key} has layers`);
    for (const layer of design.frontLayers) {
        const qwot = 4 * getMaterial(layer.material).getNK(lam0)[0] * layer.thickness / lam0;
        assert.ok(Math.abs(qwot - 1) < 0.002, `${sample.key}: ${layer.material} is ${qwot.toFixed(4)} quarter waves at ${lam0} nm`);
    }
}
// The design is named as the welcome card names it, in the user's language.
for (const sample of buildSampleDesigns()) {
    assert.equal(sample.build('Однослойное просветление').name, 'Однослойное просветление', `${sample.key} takes the name it is given`);
    assert.ok(sample.build().name.length > 0, `${sample.key} has a name of its own without one`);
}
console.log('PASS sample_designs_quarter_wave');
