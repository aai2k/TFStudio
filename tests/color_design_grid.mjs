/**
 * Colour is integrated on the grid the spectrum is computed on.
 *
 * Macleod, Thin-Film Optical Filters 5th ed., Eqs. (12.1)-(12.3) define X, Y
 * and Z as integrals over λ. The colour module takes them by the trapezoidal
 * rule on the response's own wavelength grid, with the CIE illuminant and
 * colour-matching tables interpolated to it, so a feature narrower than the
 * 5 nm table spacing counts at the width the grid resolves.
 *
 *   - A 3 nm notch on a 0.1 nm grid gives X/100, Y/100, Z/100 within 1e-4
 *     (0.01 points, the Integral Values tolerance) of the CIE sum taken at
 *     every grid node. What is left is the half weight the trapezoidal rule
 *     gives the nodes at 380 and 780 nm, and with that weight the two agree
 *     to rounding.
 *   - A response of 1 everywhere is the reference white of the same grid.
 *   - In the Color window and the report, Δλ is the step of the spectrum the
 *     colour is computed on, and every point of it is counted.
 *   - Both start from the same Δλ, 1 nm, taken from the analysis registry.
 *
 * Run: node tests/color_design_grid.mjs
 */

import assert from 'node:assert/strict';
import { colorReport, tristimulus, whitePoint, illuminantSPD } from '../src/utils/physics/colorimetry.js';
import { cmfTable, interp } from '../src/utils/physics/colorimetry/tables.js';
import { buildLambdaGrid } from '../src/utils/physics/thinFilmMath.js';
import { buildSpectrum, computeColor } from '../src/utils/report/reportData.js';
import { withDefaults } from '../src/utils/report/blocks.js';
import { sessionDefaults } from '../src/constants/analysisDefaults.js';
import { computeColorReport } from '../src/components/windows/analysis/colorEvaluation/colorModel.js';

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log('  ok', name);
    } catch (error) {
        failures++;
        console.error('FAIL', name, '\n    ', error.message);
    }
}

// Macleod Eqs. (12.1)-(12.3) as a sum over every node of a uniform grid, with
// the same CIE tables linearly interpolated to the nodes. `endWeight` is the
// weight of the first and last node: 1 for the plain CIE sum, 1/2 for the
// trapezoidal rule.
function cieSum(lambda, values, { endWeight = 1, observer = '2', illuminant = 'D65' } = {}) {
    const cmf = cmfTable(observer);
    let x = 0, y = 0, z = 0, norm = 0;
    lambda.forEach((lam, i) => {
        const w = (i === 0 || i === lambda.length - 1) ? endWeight : 1;
        const S = w * illuminantSPD(illuminant, lam);
        norm += S * interp(cmf, lam, 2);
        x += S * values[i] * interp(cmf, lam, 1);
        y += S * values[i] * interp(cmf, lam, 2);
        z += S * values[i] * interp(cmf, lam, 3);
    });
    return { X: 100 * x / norm, Y: 100 * y / norm, Z: 100 * z / norm };
}

// `tolerance` is on X, Y, Z in percent.
function assertXYZ(got, want, tolerance, what) {
    for (const key of ['X', 'Y', 'Z']) {
        assert.ok(Math.abs(got[key] - want[key]) < tolerance,
            `${what}: ${key} ${got[key].toFixed(6)} vs ${want[key].toFixed(6)}`);
    }
}

check('a 3 nm notch on a 0.1 nm grid gives the 0.1 nm CIE sum', () => {
    const lambda = buildLambdaGrid(380, 780, 0.1);
    for (const centre of [532, 535]) {
        // Node i sits at 380 + i/10 nm; the notch holds the nodes within 1.5 nm.
        const values = lambda.map((_, i) => Math.abs(3800 + i - 10 * centre) <= 15 ? 0 : 1);
        const report = colorReport({ lambda, values }, { observer: '2', illuminant: 'D65' });
        assertXYZ(report.XYZ, cieSum(lambda, values), 100 * 1e-4, `notch at ${centre} nm, plain sum`);
        assertXYZ(report.XYZ, cieSum(lambda, values, { endWeight: 0.5 }), 1e-9, `notch at ${centre} nm, half-weight ends`);
        assertXYZ(tristimulus({ lambda, values }, '2', 'D65'), report.XYZ, 1e-12, 'tristimulus is the report XYZ');
    }
});

check('a response of 1 is the reference white of its own grid', () => {
    for (const step of [0.1, 1, 3, 5]) {
        const lambda = buildLambdaGrid(380, 780, step);
        const report = colorReport({ lambda, values: lambda.map(() => 1) }, { observer: '10', illuminant: 'A' });
        assertXYZ(report.XYZ, whitePoint(lambda, '10', 'A'), 1e-12, `${step} nm grid`);
        assert.ok(Math.abs(report.Lab.L - 100) < 1e-9 && Math.abs(report.Lab.a) < 1e-9 && Math.abs(report.Lab.b) < 1e-9,
            `${step} nm grid: L*a*b* ${report.Lab.L}, ${report.Lab.a}, ${report.Lab.b}`);
    }
});

// A Fabry-Perot bandpass whose passband is 1.6 nm wide at half height: every
// colour it has comes from a feature narrower than the CIE table spacing. Read
// every 5 nm, its transmitted Y comes out 1.80 % against 2.67 % on a fine grid.
function bandpass() {
    const H = 532 / 4 / 2.52, L = 532 / 4 / 1.46;
    const order = [];
    for (let i = 0; i < 4; i++) order.push('H', 'L');
    order.push('H', 'H');
    for (let i = 0; i < 4; i++) order.push('L', 'H');
    return {
        id: 'bandpass', name: 'bandpass', incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 }, referenceWavelength: 532, surfaceMode: 'front_only',
        frontLayers: order.map((m, i) => ({ id: `l${i}`, material: m === 'H' ? 'TiO2' : 'SiO2', thickness: m === 'H' ? H : L })),
    };
}
const design = bandpass();
// The trapezoidal sum over every point of the design's spectrum on a Δλ grid.
const onGrid = (step) => {
    const spectrum = buildSpectrum(design, { lambdaStart: 380, lambdaEnd: 780, lambdaStep: step, thetas: [0] });
    return cieSum(spectrum.lambda, spectrum.series[0].T, { endWeight: 0.5 });
};
const windowColor = (options) => computeColorReport({
    design, evalMode: 'front', characteristic: 'T', pol: 'avg', theta: 0,
    observer: '2', illuminant: 'D65', setError: (error) => { if (error) throw new Error(error); },
    ...options,
});

check('the Color window integrates every point of its Δλ grid', () => {
    for (const step of [0.5, 1, 2]) {
        assertXYZ(windowColor({ step }).XYZ, onGrid(step), 1e-9, `Δλ ${step} nm`);
    }
});

check('the report colour block integrates every point of its Δλ grid', () => {
    for (const step of [0.5, 2]) {
        const block = computeColor(design, withDefaults('color', { characteristic: 'T', step }));
        assertXYZ(block.report.XYZ, onGrid(step), 1e-9, `Δλ ${step} nm`);
    }
});

check('the window and the report start at Δλ = 1 nm and agree', () => {
    const shipped = sessionDefaults('colorEvaluation');
    const block = withDefaults('color', {});
    assert.equal(shipped.step, 1, 'the window ships a 1 nm grid');
    assert.equal(block.step, shipped.step, 'a new report block starts from the window registry');
    const fromWindow = windowColor({ step: shipped.step }).XYZ;
    assertXYZ(fromWindow, onGrid(1), 1e-9, 'window at its shipped Δλ');
    assertXYZ(computeColor(design, withDefaults('color', { characteristic: 'T' })).report.XYZ,
        fromWindow, 1e-9, 'report at its shipped Δλ');
});

if (failures) {
    console.error(`\ncolor_design_grid: ${failures} check(s) failed`);
    process.exit(1);
}
console.log('\ncolor_design_grid: passed');
