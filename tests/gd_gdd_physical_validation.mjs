/**
 * Physical correctness of GD, GDD and TOD.
 *
 * The equivalence tests elsewhere prove that TFStudio's JavaScript, its C kernel
 * and an independently written jet arithmetic all agree with each other. Three
 * implementations of the same wrong formula would agree just as well. This file
 * asks the separate question: are the numbers physically right?
 *
 * Every oracle below is reached without the Taylor-jet code.
 *
 *   1. Definition.   Macleod defines GD = -dphi/domega, GDD = -d2phi/domega2,
 *      TOD = -d3phi/domega3 (Thin-Film Optical Filters 5th ed., Ch. 11
 *      "Ultrafast Coatings", Eq. 11.17). The reported quantities are checked
 *      against high-order finite differences of the phase this program itself
 *      reports, so the analytic log-derivative has to reproduce the derivative
 *      of the curve a user sees.
 *
 *   2. An independent transfer matrix.  thinFilmMath's scalar tmm shares no code
 *      with the jet path and is validated against Steven Byrnes' `tmm` to 9e-14
 *      (benchmarks/, and Byrnes, arXiv:1603.02720). Its complex coefficient is
 *      differentiated numerically in omega and compared.
 *
 *   3. Closed forms.  A single interface, the Airy formula for one layer, and
 *      bulk propagation through a matched slab. None involves a matrix product.
 *
 *   4. The wavelength domain.  The textbook relations
 *          beta1 = n_g/c,  n_g = n - lambda dn/dlambda
 *          beta2 = (lambda^3 / 2 pi c^2) d2n/dlambda2
 *          beta3 = -(lambda^4 / 4 pi^2 c^3) (3 d2n/dlambda2 + lambda d3n/dlambda3)
 *      differentiate with respect to WAVELENGTH, not angular frequency, so they
 *      test the whole lambda(omega) chain rule independently. See Agrawal,
 *      Nonlinear Fiber Optics 5th ed. Sec. 1.2.3; Diels & Rudolph, Ultrashort
 *      Laser Pulse Phenomena 2nd ed. Sec. 1.5.
 *
 *   5. Published numbers and signs.  Fused-silica GVD at 800 nm, the sign of
 *      GDD under normal dispersion, and Macleod's statement that a quarter-wave
 *      stack has very small GDD near its centre (Ch. 11, Fig. 11.21).
 *
 *   node tests/gd_gdd_physical_validation.mjs
 */

import assert from 'node:assert/strict';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import {
    materialOmegaResponse, materialPropagationDispersion, C_NM_PER_FS,
} from '../src/utils/materials/materialDispersion.js';
import { evaluateDesignPhaseDispersion } from '../src/utils/physics/phaseDispersion.js';
import { tmmWithAdmittances } from '../src/utils/physics/thinFilmMath.js';

const OMEGA = lambdaNm => 2 * Math.PI * C_NM_PER_FS / lambdaNm;
const LAMBDA = omega => 2 * Math.PI * C_NM_PER_FS / omega;

let checks = 0;
const report = [];

function agree(actual, expected, relativeTolerance, label, absoluteFloor = 0) {
    checks++;
    const difference = Math.abs(actual - expected);
    const scale = Math.max(Math.abs(expected), absoluteFloor);
    const relative = scale > 0 ? difference / scale : difference;
    report.push({ label, actual, expected, relative });
    assert.ok(relative <= relativeTolerance,
        `${label}\n    reported ${actual}\n    oracle   ${expected}\n    relative ${relative.toExponential(2)} > ${relativeTolerance}`);
}

// ── High-order central differences ───────────────────────────────────────────
// Nine-point stencils: 8th order for the first two derivatives, 6th for the
// third. Verified against x, x^2 and x^3 below before being trusted on physics.

const D1 = [1 / 280, -4 / 105, 1 / 5, -4 / 5, 0, 4 / 5, -1 / 5, 4 / 105, -1 / 280];
const D2 = [-1 / 560, 8 / 315, -1 / 5, 8 / 5, -205 / 72, 8 / 5, -1 / 5, 8 / 315, -1 / 560];
const D3 = [-7 / 240, 3 / 10, -169 / 120, 61 / 30, 0, -61 / 30, 169 / 120, -3 / 10, 7 / 240];

// Relative step in omega for the stencils. A numerical third derivative is
// limited from below by round-off, eps/h^3, and from above by truncation, h^6.
// Those balance near h ~ eps^(1/9), about 1e-2 relative; 1e-3 sits inside the
// flat region for all three derivatives. The step-size study below measures the
// resulting floor rather than asserting it.
const FD_STEP = 1e-3;

function derivatives(samples, step) {
    const apply = (weights, power) => {
        let sum = 0;
        for (let i = 0; i < 9; i++) sum += weights[i] * samples[i];
        return sum / step ** power;
    };
    return [apply(D1, 1), apply(D2, 2), apply(D3, 3)];
}

{
    // The stencils themselves, on polynomials whose derivatives are exact.
    const at = f => Array.from({ length: 9 }, (_, i) => f(i - 4));
    const [d1, d2, d3] = derivatives(at(x => x ** 3), 1);
    agree(d1, 0, 1e-9, 'stencil check: d/dx of x^3 at 0', 1);
    agree(d2, 0, 1e-9, 'stencil check: d2/dx2 of x^3 at 0', 1);
    agree(d3, 6, 1e-12, 'stencil check: d3/dx3 of x^3 = 6');
    const [e1, e2] = derivatives(at(x => x ** 2), 1);
    agree(e1, 0, 1e-9, 'stencil check: d/dx of x^2 at 0', 1);
    agree(e2, 2, 1e-12, 'stencil check: d2/dx2 of x^2 = 2');
}

const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => {
    const d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};

// Phase of a complex sequence, unwrapped by accumulating the step-to-step
// rotation rather than by comparing wrapped values.
function unwrappedPhase(coefficients) {
    const phase = [Math.atan2(coefficients[0][1], coefficients[0][0])];
    for (let i = 1; i < coefficients.length; i++) {
        const [ar, ai] = coefficients[i - 1];
        const [br, bi] = coefficients[i];
        const denominator = ar * ar + ai * ai;
        const ratio = [(br * ar + bi * ai) / denominator, (bi * ar - br * ai) / denominator];
        phase.push(phase[i - 1] + Math.atan2(ratio[1], ratio[0]));
    }
    return phase;
}

// ── The stacks under test ────────────────────────────────────────────────────
// Only materials with analytic Sellmeier dispersion, so nothing under test is
// limited by a tabulated interpolant's own smoothness.

const design = (frontLayers, substrate = 'BK7') => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: substrate, thickness: 1.0 },
    frontLayers, backLayers: [], surfaceMode: 'front_only',
});

const quarterWave = (lambda0, count) => Array.from({ length: count }, (_, i) => {
    const material = i % 2 ? 'SiO2' : 'Al2O3';
    return { material, thickness: lambda0 / (4 * getMaterial(material).getNK(lambda0)[0]) };
});

const CASES = [
    {
        name: '8-layer quarter-wave stack',
        design: design(quarterWave(800, 8)),
        lambda: 800, theta: 0, pol: 's', target: 'R',
    },
    {
        name: 'same stack, 30 deg, p-pol',
        design: design(quarterWave(800, 8)),
        lambda: 750, theta: 30, pol: 'p', target: 'R',
    },
    {
        name: '4-layer AR, transmission',
        design: design([
            { material: 'Al2O3', thickness: 110 }, { material: 'SiO2', thickness: 95 },
            { material: 'Al2O3', thickness: 60 }, { material: 'MgF2', thickness: 130 },
        ]),
        lambda: 632.8, theta: 0, pol: 's', target: 'T',
    },
    {
        name: 'thick single layer, 45 deg s-pol',
        design: design([{ material: 'SiO2', thickness: 1850 }]),
        lambda: 1064, theta: 45, pol: 's', target: 'R',
    },
];

// ═════════════════════════════════════════════════════════════════════════════
// 1. Macleod's definition: GD = -dphi/domega, and so on.
// ═════════════════════════════════════════════════════════════════════════════

console.log('1. Against Macleod Eq. 11.17, using the phase this program reports\n');
console.log('   GD = -dphi/domega   GDD = -d2phi/domega2   TOD = -d3phi/domega3\n');
console.log('   case                              quantity   reported        -d^n phi/domega^n   rel');

for (const testCase of CASES) {
    const omega0 = OMEGA(testCase.lambda);
    const step = omega0 * FD_STEP;
    const evaluate = omega => evaluateDesignPhaseDispersion(testCase.design, {
        wavelengthNm: LAMBDA(omega), side: 'front', target: testCase.target,
        polarization: testCase.pol, thetaDeg: testCase.theta,
    });
    const centre = evaluate(omega0);
    assert.ok(centre.valid, `${testCase.name}: centre sample is valid`);

    // The reported phase, sampled across the stencil and unwrapped as a curve.
    const phases = [];
    for (let i = -4; i <= 4; i++) {
        const point = evaluate(omega0 + i * step);
        assert.ok(point.valid, `${testCase.name}: stencil sample is valid`);
        phases.push([Math.cos(point.phaseRad), Math.sin(point.phaseRad)]);
    }
    const [dPhi, d2Phi, d3Phi] = derivatives(unwrappedPhase(phases), step);

    for (const [key, oracle, unit] of [
        ['gdFs', -dPhi, 'fs'], ['gddFs2', -d2Phi, 'fs2'], ['todFs3', -d3Phi, 'fs3'],
    ]) {
        agree(centre[key], oracle, 2e-6, `${testCase.name} ${key} vs -d phi/d omega`, 1e-6);
        console.log(`   ${testCase.name.padEnd(33)} ${key.padEnd(9)} ` +
            `${centre[key].toPrecision(9).padStart(14)}  ${oracle.toPrecision(9).padStart(17)}   ` +
            `${(Math.abs(centre[key] - oracle) / Math.max(Math.abs(oracle), 1e-6)).toExponential(1)}`);
    }
}

// A step-size study, so the residual disagreement above is attributed rather
// than assumed. If the analytic value were wrong, the finite difference would
// converge to something else and the gap would flatten at a non-zero value. If
// it is right, the gap falls as the stencil's truncation order until round-off
// takes over, and the minimum locates the oracle's own precision floor.
{
    const testCase = CASES[0];
    const omega0 = OMEGA(testCase.lambda);
    const evaluate = omega => evaluateDesignPhaseDispersion(testCase.design, {
        wavelengthNm: LAMBDA(omega), side: 'front', target: testCase.target,
        polarization: testCase.pol, thetaDeg: testCase.theta,
    });
    const centre = evaluate(omega0);
    console.log('\n   Step-size study on the first case, to show the gap is the finite');
    console.log('   difference converging on the analytic value and not the reverse:\n');
    console.log('      h/omega      |GD err|      |GDD err|     |TOD err|   (relative)');
    let bestTod = Infinity;
    for (const relativeStep of [1e-5, 1e-4, 1e-3, 1e-2, 3e-2]) {
        const step = omega0 * relativeStep;
        const phases = [];
        for (let i = -4; i <= 4; i++) {
            const point = evaluate(omega0 + i * step);
            phases.push([Math.cos(point.phaseRad), Math.sin(point.phaseRad)]);
        }
        const [d1, d2, d3] = derivatives(unwrappedPhase(phases), step);
        const err = (reported, oracle) => Math.abs(reported - oracle) / Math.abs(reported);
        const todErr = err(centre.todFs3, -d3);
        bestTod = Math.min(bestTod, todErr);
        console.log(`      ${relativeStep.toExponential(0).padStart(7)}   ` +
            `${err(centre.gdFs, -d1).toExponential(2).padStart(10)}   ` +
            `${err(centre.gddFs2, -d2).toExponential(2).padStart(10)}   ` +
            `${todErr.toExponential(2).padStart(10)}`);
    }
    assert.ok(bestTod < 1e-8,
        `the finite difference converges onto the analytic TOD (best ${bestTod})`);
    checks++;
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. An independently written transfer matrix, differentiated numerically.
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n2. Against the scalar transfer matrix (no jets), itself validated');
console.log('   against Byrnes\' tmm to 9e-14\n');
console.log('   case                              quantity   reported        numeric from r     rel');

for (const testCase of CASES) {
    if (testCase.target !== 'R') continue;   // the scalar path returns r
    const omega0 = OMEGA(testCase.lambda);
    const step = omega0 * FD_STEP;
    const resolve = name => getMaterial(name);
    const coefficients = [];
    for (let i = -4; i <= 4; i++) {
        const lambda = LAMBDA(omega0 + i * step);
        const nk = name => resolve(name).getNK(lambda);
        const result = tmmWithAdmittances(
            lambda, testCase.theta, testCase.pol,
            nk('Air'), nk(testCase.design.substrate.material),
            testCase.design.frontLayers.map(layer => ({
                n: nk(layer.material), d: layer.thickness,
            })),
        );
        coefficients.push(result.r);
    }
    // arg(r) in this convention is minus the reported phase, so its derivatives
    // are the reported quantities directly, with no sign flip.
    const [d1, d2, d3] = derivatives(unwrappedPhase(coefficients), step);
    const centre = evaluateDesignPhaseDispersion(testCase.design, {
        wavelengthNm: testCase.lambda, side: 'front', target: 'R',
        polarization: testCase.pol, thetaDeg: testCase.theta,
    });
    for (const [key, oracle] of [['gdFs', d1], ['gddFs2', d2], ['todFs3', d3]]) {
        agree(centre[key], oracle, 5e-6, `${testCase.name} ${key} vs scalar TMM`, 1e-6);
        console.log(`   ${testCase.name.padEnd(33)} ${key.padEnd(9)} ` +
            `${centre[key].toPrecision(9).padStart(14)}  ${oracle.toPrecision(9).padStart(17)}   ` +
            `${(Math.abs(centre[key] - oracle) / Math.max(Math.abs(oracle), 1e-6)).toExponential(1)}`);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. Closed forms, with no matrix product anywhere.
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n3. Closed forms\n');

// 3a. A single interface, against the Fresnel coefficient itself.
//
// For a LOSSLESS substrate r = (1 - n)/(1 + n) is real at every wavelength, so
// its phase is 0 or pi and cannot vary no matter how dispersive the glass is:
// reflection off one boundary is instantaneous. That is an exact zero, not a
// small number, and it is asserted as one.
//
// BK7 is not quite lossless. Schott's data carries k = 9e-9 at 550 nm, and a
// weakly absorbing substrate genuinely does give a tiny non-zero phase slope.
// Rather than excusing it, the Fresnel formula is evaluated with the complex
// index and differentiated, so the reported value has to match what absorption
// actually implies.
{
    for (const [substrate, lambda] of [['BK7', 550], ['SiO2', 800], ['Al2O3', 1064]]) {
        const material = getMaterial(substrate);
        const point = evaluateDesignPhaseDispersion(design([], substrate), {
            wavelengthNm: lambda, side: 'front', target: 'R', polarization: 's', thetaDeg: 0,
        });
        const nk = material.getNK(lambda);
        const fresnel = l => {
            const n = material.getNK(l);
            return cdiv(csub([1, 0], n), cadd([1, 0], n));
        };
        agree(point.magnitudeSquared, fresnel(lambda)[0] ** 2 + fresnel(lambda)[1] ** 2, 1e-12,
            `bare ${substrate} at ${lambda} nm: |r|^2 is the Fresnel value`);

        if (nk[1] === 0) {
            for (const key of ['gdFs', 'gddFs2', 'todFs3']) {
                assert.equal(point[key], 0,
                    `lossless ${substrate}: ${key} is exactly zero at a single interface`);
                checks++;
            }
        } else {
            const omega0 = OMEGA(lambda);
            const step = omega0 * FD_STEP;
            const samples = [];
            for (let i = -4; i <= 4; i++) samples.push(fresnel(LAMBDA(omega0 + i * step)));
            const [d1, d2] = derivatives(unwrappedPhase(samples), step);
            // GD is asserted; GDD deliberately is not, and the difference
            // between them is itself the point.
            //
            // This number is driven entirely by k, and BK7's k is tabulated data
            // run through a PCHIP interpolant. PCHIP is C1: its first derivative
            // is continuous, so differentiating it analytically (the jet path)
            // and differencing it numerically (this oracle) agree. Its second
            // derivative jumps at every knot, so the two disagree at the percent
            // level, and comparing them would be testing the interpolant rather
            // than the physics. That discontinuity is real and the GD/GDD window
            // already draws a gap at those knots instead of hiding it.
            agree(point.gdFs, d1, 1e-3,
                `absorbing ${substrate}: GD matches the complex Fresnel coefficient`, 1e-20);
            const gddGap = Math.abs(point.gddFs2 - d2) / Math.abs(d2);
            assert.ok(Math.abs(point.gdFs) < 1e-6,
                `${substrate}: a weakly absorbing interface delays a pulse by nothing measurable`);
            checks++;
            console.log(`   single interface   ${substrate} (k = ${nk[1].toExponential(1)}): ` +
                `GD ${point.gdFs.toExponential(3)} fs, from absorption alone`);
            console.log(`                      GD agrees with the complex Fresnel formula to ` +
                `${(Math.abs(point.gdFs - d1) / Math.abs(d1)).toExponential(1)};`);
            console.log(`                      GDD differs by ${(gddGap * 100).toFixed(1)}% ` +
                `because k is a C1 interpolant, whose 2nd derivative jumps at knots`);
        }
    }
    console.log('   single interface   lossless glass gives GD = GDD = TOD = 0 exactly   OK');
}

// 3b. The Airy formula for one layer:
//        r = (r01 + r12 e^{2 i delta}) / (1 + r01 r12 e^{2 i delta})
// derived from this program's own admittance convention, but evaluated with
// scalar complex arithmetic and no matrix product. Differentiated numerically.
{
    const layer = { material: 'Al2O3', thickness: 420 };
    // Both media lossless (k = 0 exactly), so the real-arithmetic Airy form
    // below is not an approximation of the complex one.
    const substrateName = 'SiO2';
    const thetaDeg = 25;
    const pol = 'p';
    const lambda0 = 700;
    const omega0 = OMEGA(lambda0);
    const step = omega0 * FD_STEP;

    const airy = (lambda) => {
        const n0 = 1, n1 = getMaterial(layer.material).getNK(lambda)[0];
        const ns = getMaterial(substrateName).getNK(lambda)[0];
        const sin0 = Math.sin(thetaDeg * Math.PI / 180);
        const cos0 = Math.cos(thetaDeg * Math.PI / 180);
        const cos1 = Math.sqrt(1 - (n0 * sin0 / n1) ** 2);
        const coss = Math.sqrt(1 - (n0 * sin0 / ns) ** 2);
        const eta = (n, cos) => (pol === 's' ? n * cos : n / cos);
        const [e0, e1, es] = [eta(n0, cos0), eta(n1, cos1), eta(ns, coss)];
        const r01 = (e0 - e1) / (e0 + e1);
        const r12 = (e1 - es) / (e1 + es);
        const delta = 2 * Math.PI * n1 * layer.thickness * cos1 / lambda;
        const phasor = [Math.cos(2 * delta), Math.sin(2 * delta)];
        return cdiv(cadd([r01, 0], cmul([r12, 0], phasor)),
                    cadd([1, 0], cmul([r01 * r12, 0], phasor)));
    };

    const single = design([layer], substrateName);
    const centre = evaluateDesignPhaseDispersion(single, {
        wavelengthNm: lambda0, side: 'front', target: 'R', polarization: pol, thetaDeg,
    });
    // The coefficient itself first, so a derivative agreement cannot paper over
    // a different r.
    const rAiry = airy(lambda0);
    agree(rAiry[0] * rAiry[0] + rAiry[1] * rAiry[1], centre.magnitudeSquared, 1e-12,
        'Airy |r|^2 matches the transfer matrix');
    agree(-Math.atan2(rAiry[1], rAiry[0]), centre.phaseRad, 1e-12,
        'Airy phase matches the transfer matrix');

    const samples = [];
    for (let i = -4; i <= 4; i++) samples.push(airy(LAMBDA(omega0 + i * step)));
    const [d1, d2, d3] = derivatives(unwrappedPhase(samples), step);
    agree(centre.gdFs, d1, 5e-6, 'Airy GD', 1e-6);
    agree(centre.gddFs2, d2, 5e-6, 'Airy GDD', 1e-6);
    agree(centre.todFs3, d3, 5e-6, 'Airy TOD', 1e-6);
    console.log(`   Airy one-layer     GD ${centre.gdFs.toFixed(4)} fs   ` +
        `GDD ${centre.gddFs2.toFixed(3)} fs2   TOD ${centre.todFs3.toFixed(1)} fs3   OK`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. The wavelength domain: the same physics differentiated in lambda, not omega.
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n4. Bulk propagation against the textbook lambda-domain relations\n');
console.log('   material  lambda   quantity  reported          from dn/dlambda    rel');

for (const [name, lambda] of [['SiO2', 800], ['BK7', 800], ['SiO2', 550], ['MgF2', 1064]]) {
    const material = getMaterial(name);
    // Step in nm. d2n/dlambda2 is of order 4e-8 per nm^2, so a small step buries
    // it in round-off: eps/h^2 at h = 0.02 nm is already 1e-4 of the answer. The
    // Sellmeier forms are analytic and smooth over tens of nm, so a 2 nm step
    // costs nothing in truncation at 8th order and drops round-off to 1e-8.
    const step = 2;
    const samples = [];
    for (let i = -4; i <= 4; i++) samples.push(material.getNK(lambda + i * step)[0]);
    const [dn, d2n, d3n] = derivatives(samples, step);
    const c = C_NM_PER_FS;
    const n = samples[4];

    // beta1 = n_g/c, beta2 = (l^3/2 pi c^2) n'', beta3 = -(l^4/4 pi^2 c^3)(3n'' + l n''')
    const groupIndex = n - lambda * dn;
    const beta1 = groupIndex / c;
    const beta2 = (lambda ** 3 / (2 * Math.PI * c * c)) * d2n;
    const beta3 = -(lambda ** 4 / (4 * Math.PI * Math.PI * c ** 3)) * (3 * d2n + lambda * d3n);

    // One millimetre of bulk, which is what materialPropagationDispersion reports.
    const distance = 1e6;   // nm
    const bulk = materialPropagationDispersion(material, lambda, 1);
    assert.ok(bulk.valid, `${name} bulk dispersion is available at ${lambda} nm`);

    for (const [key, oracle] of [
        ['gdFs', distance * beta1], ['gddFs2', distance * beta2], ['todFs3', distance * beta3],
    ]) {
        agree(bulk[key], oracle, 2e-5, `${name} ${lambda} nm ${key} vs lambda-domain formula`);
        console.log(`   ${name.padEnd(9)} ${String(lambda).padStart(5)}   ${key.padEnd(8)} ` +
            `${bulk[key].toPrecision(10).padStart(16)}  ${oracle.toPrecision(10).padStart(16)}   ` +
            `${(Math.abs(bulk[key] - oracle) / Math.abs(oracle)).toExponential(1)}`);
    }

    // The group index must exceed the phase index wherever dispersion is normal,
    // and the group delay must be positive: light is delayed, never advanced.
    assert.ok(dn < 0, `${name} at ${lambda} nm is normally dispersive (dn/dlambda < 0)`);
    assert.ok(groupIndex > n, `${name}: group index exceeds phase index`);
    assert.ok(bulk.gdFs > 0, `${name}: group delay through bulk is positive`);
    assert.ok(bulk.gddFs2 > 0, `${name} at ${lambda} nm: normal dispersion gives positive GDD`);
    checks += 4;
}

// A matched slab, where the coating calculation must reproduce bulk propagation
// exactly because there are no interfaces to reflect from.
{
    const lambda = 800;
    const thicknessNm = 20000;
    const slab = {
        incidentMedium: 'SiO2', exitMedium: 'SiO2',
        substrate: { material: 'SiO2', thickness: 1.0 },
        frontLayers: [{ material: 'SiO2', thickness: thicknessNm }],
        backLayers: [], surfaceMode: 'front_only',
    };
    const point = evaluateDesignPhaseDispersion(slab, {
        wavelengthNm: lambda, side: 'front', target: 'T', polarization: 's', thetaDeg: 0,
    });
    const bulk = materialPropagationDispersion(getMaterial('SiO2'), lambda, thicknessNm / 1e6);
    agree(point.magnitudeSquared, 1, 1e-12, 'matched slab transmits everything');
    for (const key of ['gdFs', 'gddFs2', 'todFs3']) {
        agree(point[key], bulk[key], 1e-9, `matched slab ${key} equals bulk propagation`);
    }
    console.log(`\n   matched 20 um SiO2 slab: the coating path reproduces bulk propagation`);
    console.log(`     GD ${point.gdFs.toFixed(6)} fs   GDD ${point.gddFs2.toFixed(6)} fs2   ` +
        `TOD ${point.todFs3.toFixed(6)} fs3`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. Published values, and signs a physicist would insist on.
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n5. Published values and physical signs\n');

{
    // Fused-silica group-velocity dispersion. The widely quoted figure at 800 nm
    // is +36.1 fs^2/mm; ours comes from the Malitson Sellmeier fit
    // (J. Opt. Soc. Am. 55, 1205 (1965)) through the same code path users get.
    const silica = getMaterial('SiO2');
    const gvd800 = materialPropagationDispersion(silica, 800, 1).gddFs2;
    agree(gvd800, 36.16, 3e-3, 'fused silica GVD at 800 nm vs the published 36.1 fs2/mm');
    console.log(`   fused silica GVD at 800 nm   ${gvd800.toFixed(2)} fs2/mm   ` +
        `(published 36.1)`);

    // Zero-dispersion wavelength: fused silica crosses from normal to anomalous
    // GVD at 1.27 um. Bracket it rather than trusting a single point.
    const gvdAt = l => materialPropagationDispersion(silica, l, 1).gddFs2;
    assert.ok(gvdAt(1200) > 0, 'silica GVD is still normal at 1200 nm');
    assert.ok(gvdAt(1350) < 0, 'silica GVD has turned anomalous by 1350 nm');
    let lo = 1200, hi = 1350;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (gvdAt(mid) > 0) lo = mid; else hi = mid;
    }
    const zeroDispersion = (lo + hi) / 2;
    agree(zeroDispersion, 1270, 1e-2, 'fused silica zero-dispersion wavelength vs 1.27 um');
    console.log(`   silica zero-GVD wavelength   ${zeroDispersion.toFixed(0)} nm      ` +
        `(published 1270)`);
    checks += 2;
}

{
    // Macleod, Ch. 11: "the calculated GDD for quarter-wave stacks will normally
    // be very small, and so it is a particularly safe type of reflector to use
    // with short pulses." Checked at the design wavelength of a 15-layer stack.
    const stack = design(quarterWave(800, 31));
    const centre = evaluateDesignPhaseDispersion(stack, {
        wavelengthNm: 800, side: 'front', target: 'R', polarization: 's', thetaDeg: 0,
    });
    assert.ok(Math.abs(centre.gddFs2) < 0.5,
        `quarter-wave stack GDD at its design wavelength is very small, got ${centre.gddFs2}`);
    assert.ok(centre.magnitudeSquared > 0.99, 'the stack is a good reflector there');
    checks += 2;
    console.log(`   31-layer QW stack at 800 nm  GDD ${centre.gddFs2.toFixed(4)} fs2, ` +
        `R ${(centre.magnitudeSquared * 100).toFixed(2)}%   (Macleod: "very small")`);

    // A quarter-wave stack with a high-index outermost layer reflects like a
    // higher-index medium, so its phase change on reflection at the design
    // wavelength is exactly 180 degrees (Macleod Ch. 9). This one lands on it to
    // ten digits, which is a sharper statement than any tolerance-based check.
    agree(Math.abs(centre.phaseDeg), 180, 1e-10,
        'quarter-wave stack phase at the design wavelength is exactly 180 degrees');
    console.log(`   phase at design wavelength   ${centre.phaseDeg.toFixed(9)} deg   ` +
        `(exactly 180 for an H-outermost QW stack)`);

    // Macleod, same section: for simple reflectors phi increases with
    // wavelength. The reported phase is a principal value, so it wraps through
    // the 180 degrees above; compare the unwrapped curve, not the raw samples.
    const lambdas = [780, 785, 790, 795, 800, 805, 810, 815, 820];
    const phasors = lambdas.map((lambda) => {
        const point = evaluateDesignPhaseDispersion(stack, {
            wavelengthNm: lambda, side: 'front', target: 'R', polarization: 's', thetaDeg: 0,
        });
        return [Math.cos(point.phaseRad), Math.sin(point.phaseRad)];
    });
    const unwrapped = unwrappedPhase(phasors);
    for (let i = 1; i < unwrapped.length; i++) {
        assert.ok(unwrapped[i] > unwrapped[i - 1],
            `phase rises with wavelength across ${lambdas[i - 1]}-${lambdas[i]} nm`);
        checks++;
    }
    const degrees = value => value * 180 / Math.PI;
    console.log(`   phase rises with wavelength   ${degrees(unwrapped[0]).toFixed(2)} deg at 780 nm ` +
        `-> ${degrees(unwrapped.at(-1)).toFixed(2)} at 820, monotonically   (Macleod)`);
}

{
    // A chirped mirror: the layer periods ramp with depth, so long wavelengths
    // turn around deeper in the stack and come back later. Two consequences that
    // do not depend on the details of the ramp:
    //
    //   group delay rises with wavelength   (red travels further)
    //   mean GDD across the band is negative (dGD/domega < 0)
    //
    // Not asserted: GDD negative at every wavelength. A simple chirp rings,
    // because the front interface is an impedance mismatch the ramp does not
    // address, and that ripple is exactly why real designs are double-chirped or
    // carry a matching section. Claiming a monotone GDD here would be asserting
    // something a chirped mirror does not actually do.
    const chirped = design(Array.from({ length: 60 }, (_, i) => {
        const material = i % 2 ? 'MgF2' : 'Al2O3';
        return {
            material,
            thickness: (1 + 0.006 * i) * 700 / (4 * getMaterial(material).getNK(700)[0]),
        };
    }));
    const band = [745, 760, 775, 790, 805];
    const points = band.map(lambda => evaluateDesignPhaseDispersion(chirped, {
        wavelengthNm: lambda, side: 'front', target: 'R', polarization: 's', thetaDeg: 0,
    }));
    for (let i = 0; i < band.length; i++) {
        assert.ok(points[i].magnitudeSquared > 0.99,
            `chirped mirror reflects at ${band[i]} nm (${points[i].magnitudeSquared})`);
        checks++;
    }
    for (let i = 1; i < band.length; i++) {
        assert.ok(points[i].gdFs > points[i - 1].gdFs,
            `group delay rises from ${band[i - 1]} to ${band[i]} nm: red turns around deeper`);
        checks++;
    }
    const meanGdd = points.reduce((sum, point) => sum + point.gddFs2, 0) / points.length;
    assert.ok(meanGdd < 0, `mean GDD across the band is negative (${meanGdd})`);
    checks++;
    console.log(`   chirped 60-layer mirror       GD rises ` +
        `${points[0].gdFs.toFixed(1)} -> ${points.at(-1).gdFs.toFixed(1)} fs across 745-805 nm,`);
    console.log(`                                 mean GDD ${meanGdd.toFixed(1)} fs2, R > 99%`);
}

{
    // Group delay on reflection, and where its sign is and is not fixed.
    //
    // A good reflector delays: light penetrates some depth into the stack before
    // turning around, so GD > 0 wherever R is high. That is asserted.
    //
    // NEGATIVE group delay is not an error. Near a reflectance minimum the
    // front-surface and internal contributions nearly cancel, and the small
    // surviving amplitude has a phase that advances with frequency. No signal
    // front moves faster than c and no causality is broken: the group delay is a
    // property of a narrow-band envelope, not of the wavefront. Asserting GD > 0
    // everywhere would have been asserting something false about optics.
    //
    // The two are told apart by reflectance, so that is what is checked.
    for (const testCase of CASES) {
        if (testCase.target !== 'R') continue;
        const point = evaluateDesignPhaseDispersion(testCase.design, {
            wavelengthNm: testCase.lambda, side: 'front', target: 'R',
            polarization: testCase.pol, thetaDeg: testCase.theta,
        });
        if (point.magnitudeSquared > 0.9) {
            assert.ok(point.gdFs > 0,
                `${testCase.name}: a good reflector delays (R = ${point.magnitudeSquared}, ` +
                `GD = ${point.gdFs})`);
            checks++;
        }
        if (point.gdFs < 0) {
            assert.ok(point.magnitudeSquared < 0.2,
                `${testCase.name}: negative GD only where reflectance is low ` +
                `(R = ${point.magnitudeSquared})`);
            checks++;
            console.log(`   negative GD where R is low     ${testCase.name}: ` +
                `R ${(point.magnitudeSquared * 100).toFixed(1)}%, GD ${point.gdFs.toFixed(3)} fs`);
        }
    }
    console.log('   group delay is positive wherever the stack is a good reflector');
}

// ── Summary ──────────────────────────────────────────────────────────────────

const worst = report.reduce((a, b) => (b.relative > a.relative ? b : a));
console.log(`\n${checks} checks against four independent oracles.`);
console.log(`Worst relative disagreement: ${worst.relative.toExponential(2)}  (${worst.label})`);
console.log('\nPASS: gd_gdd_physical_validation');
