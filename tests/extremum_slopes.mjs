/**
 * Band-extremum rows give the optimizer exact thickness derivatives: the
 * Jacobian row of a worst-case row and of an MXW / MNW row against central
 * differences of the row's residual in each layer thickness.
 *
 * A worst-case row is differentiated at the Newton-corrected extremum, so a
 * wavelength a hair off a narrow leak does not carry the leak's shift into the
 * row. An MXW / MNW row takes the implicit-function shift of its peak. An
 * extremum on a band end does not move, whatever the floating-point grid
 * does there, and a fine search step does not shrink the difference step below
 * what rounding allows on a broad minimum.
 *
 * Run: node tests/extremum_slopes.mjs
 */
import assert from 'node:assert/strict';
import { makeOperand, DLSOptimizer, operandSampleLambdas } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();
const resolveMat = id => getMaterial(id);
const H = ['TiO2', 57], L = ['SiO2', 94];
const rep = (n, pair) => Array.from({ length: n }, () => pair).flat();
const twice = layer => [layer[0], 2 * layer[1]];
const design = (spec, extra = {}) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: spec.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false })),
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side', ...extra,
});
const fpLayers = [...rep(5, [H, L]), H, twice(L), H, ...rep(5, [L, H])];
const fabryPerot = design(fpLayers);
const leak = design([...rep(6, [H, L]), H, twice(L), ...rep(11, [H, L]), H]);
const ar = design([['MgF2', 99.6], ['ZrO2', 127.3], ['Al2O3', 77.7]]);
const coned = design(fpLayers, { cone: { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15 } });
const row = (type, a, b, target, extra = {}) => makeOperand({ type, lambdaStart: a, lambdaEnd: b, target, weight: 1, ...extra });

const CASES = [
    ['MXWT over a resonance', fabryPerot, row('MXWT', 500, 600, 550)],
    ['MXWT at 45°, pol avg', fabryPerot, row('MXWT', 480, 560, 520, { aoi: 45 })],
    ['MNWR of an AR', ar, row('MNWR', 420, 680, 500)],
    ['TMX over a resonance', fabryPerot, row('TMX', 540, 580, 0.5)],
    ['TMX over a 0.05 nm leak', leak, row('TMX', 500, 600, 0.001)],
    ['ODMN over the same leak', leak, row('ODMN', 500, 600, 3)],
    ['RMX of an AR', ar, row('RMX', 420, 680, 0.001)],
    ['MXWT under a 7.5° cone', coned, row('MXWT', 540, 580, 560)],
    // The band's last grid sample is 782.6 exactly only if the grid puts it
    // there; computed as a + (b − a)·i/(n − 1) it lands an ulp above.
    ['MNWT on a band end', ar, row('MNWT', 431.5, 782.6, 600)],
    ['TMN on a band end', ar, row('TMN', 431.5, 782.6, 0.99)],
    ['MNWR at step 4', ar, row('MNWR', 420, 680, 500, { flag: 4 })],
];

// A band end is recognised by comparing the extremum's wavelength with it, so
// the search grid has to end on it exactly.
for (const [type, a, b] of [['MNWT', 431.5, 782.6], ['TMN', 854.5, 1582.8], ['TMX', 782.6, 431.5]]) {
    const lams = operandSampleLambdas(row(type, a, b, 0));
    assert.equal(lams[0], Math.min(a, b), `${type} ${a}-${b}: the grid starts on the band`);
    assert.equal(lams[lams.length - 1], Math.max(a, b), `${type} ${a}-${b}: the grid ends on the band`);
}

// Central differences of the residual, at a step large enough to keep the
// extremum's location noise out of them.
const STEP_NM = 0.02;
for (const [name, d, op] of CASES) {
    const engine = new DLSOptimizer([op], d, resolveMat, {});
    const thk = engine.thicknesses.slice();
    const freeIdx = thk.map((_, k) => k);
    const J = engine._analyticJacobian(thk, freeIdx);
    assert.ok(J, `${name}: the Jacobian is analytic`);
    const residual = t => engine._residuals(t)[0];
    let worst = 0, scale = 0;
    freeIdx.forEach(k => {
        const plus = thk.slice(); plus[k] += STEP_NM;
        const minus = thk.slice(); minus[k] -= STEP_NM;
        const fd = (residual(plus) - residual(minus)) / (2 * STEP_NM);
        scale = Math.max(scale, Math.abs(fd));
        worst = Math.max(worst, Math.abs(J[0][k] - fd));
    });
    if (scale === 0) {
        assert.equal(worst, 0, `${name}: a row pinned to its band end does not move, and its analytic row is zero`);
        continue;
    }
    assert.ok(worst <= 3e-4 * scale, `${name}: analytic against central differences ${(worst / scale).toExponential(2)}`);
}

console.log('PASS extremum_slopes');
