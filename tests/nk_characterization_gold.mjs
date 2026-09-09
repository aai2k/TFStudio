import assert from 'node:assert/strict';
import { initWasmForTest } from './_wasmInit.mjs';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { filmEllipsometry } from '../src/utils/materials/characterization/sampleSpectrum.js';
import { characterizeFilm } from '../src/utils/materials/characterization/nkFit.js';
import { evaluateDispersionFit } from '../src/utils/materials/dispersionFits.js';

await initWasmForTest();

// A 500 nm gold film measured by ellipsometry over 300-900 nm at 70°, in the
// Azzam delta convention. The built-in table is not itself a Drude-Lorentz
// model, so the smooth fit approximates it and the residual below belongs to
// that approximation rather than to the extraction.
//
// Two things this pins down. Gold's index is near 0.13 in the visible, so a
// solver that brackets the pointwise index away from zero cannot reach it. And
// its interband absorption needs Lorentz terms: stopping at the first one that
// overshoots the table leaves a Drude-only fit around eight degrees out.
const gold = getMaterial('Au');
const lambdas = Array.from({ length: 121 }, (_, i) => 300 + 5 * i);
const sample = {
    incident: getMaterial('Air'), substrate: getMaterial('BK7'),
    exit: getMaterial('Air'), substrateThicknessMm: 1, geometry: 'coating',
};
const conditions = { ...sample, lambdas, aoi: 70, side: 'front', deltaConvention: 'azzam' };
const spectrum = filmEllipsometry(conditions, gold, 500);
const channels = ['PSI', 'DEL'].map(quantity => ({
    quantity, lambdas, values: spectrum[quantity], aoi: 70,
    side: 'front', deltaConvention: 'azzam',
}));
const result = characterizeFilm({
    sample, channels, indexModel: 'drude-lorentz', thicknessNm: 500, fixThickness: true,
});
assert.ok(!result.error, result.error);
assert.equal(result.thicknessNm, 500);
assert.ok(result.fit.complex.oscillators.length > 0, 'gold needs interband absorption terms');
assert.ok(result.residuals.PSI.rms < 0.4, JSON.stringify(result.residuals));
assert.ok(result.residuals.DEL.rms < 0.3, JSON.stringify(result.residuals));
assert.ok(result.pointwise.resolved.every(Boolean), 'all wavelengths, including n < 0.5, resolve');
for (const [i, lambda] of lambdas.entries()) {
    const [n, k] = gold.getNK(lambda);
    assert.ok(Math.abs(result.pointwise.n[i] - n) < 1e-6, `pointwise n at ${lambda}`);
    assert.ok(Math.abs(result.pointwise.k[i] - k) < 1e-6, `pointwise k at ${lambda}`);
}
// The smooth model approximates the table; verify its sub-0.5 indices at
// visible wavelengths independently of the exact pointwise recovery above.
for (const lambda of [550, 700]) {
    const [n, k] = gold.getNK(lambda);
    const [fittedN, fittedK] = evaluateDispersionFit(result.fit, lambda);
    assert.ok(Math.abs(fittedN - n) < 0.03, `model n at ${lambda}`);
    assert.ok(Math.abs(fittedK - k) < 0.03, `model k at ${lambda}`);
}
console.log('PASS: opaque gold n/k recovery; RMS degrees', result.residuals);

for (const indexModel of ['drude', 'drude-lorentz']) {
    const solved = characterizeFilm({ sample, channels, indexModel, thicknessNm: 500, fixThickness: false });
    assert.ok(!solved.error, solved.error);
    assert.equal(solved.thicknessNm, 500, 'opaque-film Solve retains the entered thickness');
    assert.equal(solved.thicknessStatus, 'unresolved', 'retained thickness is not a measured result');
    assert.equal(solved.thicknessSpreadNm, null);
    assert.ok(solved.diagnostics.warnings.some(w => w.code === 'thicknessUnresolved'));
    assert.ok(!solved.diagnostics.warnings.some(w => w.code === 'risingExtinction'),
        "gold's k rises with wavelength as a metal's does, which is not a fault");
    if (indexModel === 'drude-lorentz') {
        assert.ok(solved.residuals.PSI.rms < 0.4 && solved.residuals.DEL.rms < 0.3);
    } else {
        assert.ok(solved.residuals.PSI.rms > 1, 'Drude alone does not describe visible gold');
    }
    console.log('PASS: gold Solve', indexModel, solved.thicknessStatus, solved.residuals);
}
