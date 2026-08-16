import assert from 'node:assert/strict';

import { evalN, evalNJet } from '../src/utils/materials/dispersionFormulas.js';
import {
    evaluateComplexDispersionModel,
    evaluateDispersionFit,
    fitTabulatedMaterial,
} from '../src/utils/materials/dispersionFits.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import {
    materialOmegaResponse,
    materialPropagationDispersion,
} from '../src/utils/materials/materialDispersion.js';
import {
    createPchipInterpolator,
    createTabulatedNKSampler,
} from '../src/utils/materials/pchip.js';
import {
    coefficientPhaseDispersion,
    evaluateDesignPhaseDispersion,
    evaluateTotalTransmissionDispersion,
    tmmCoefficientJets,
} from '../src/utils/physics/phaseDispersion.js';
import {
    jetDerivatives,
    jetFromDerivatives,
    jetScale,
    wavelengthOmegaJet,
} from '../src/tmmcore.js';
import {
    C_NM_PER_FS,
    computeGroupDelaySpectrumAtWavelengthStep,
    tmmWithAdmittances,
} from '../src/utils/physics/thinFilmMath.js';
import {
    buildEvalContext,
    buildPresampledTable,
    evalOperand,
    makeOperand,
} from '../src/utils/physics/optimizer.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { makeResolveMat } from '../src/utils/workers/resolveMat.js';
import {
    computeGdGddSpectrum,
} from '../src/components/windows/analysis/gdGddEvaluation/spectrum.js';

const close = (actual, expected, tolerance, message) => assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: got ${actual}, expected ${expected}, tolerance ${tolerance}`,
);

const relativeClose = (actual, expected, tolerance, message) => close(
    actual,
    expected,
    tolerance * Math.max(1e-12, Math.abs(expected)),
    message,
);

const formulaCases = [
    [1, [2.3, .01, .005, .0001, .00001, .000001]],
    [2, [1, .01, .2, .02, .8, 100]],
    [3, [1.5, .01, .001, .02, .001, .0001]],
    [4, [.1, 1, .1, .01, 1]],
    [5, [1.5, .01, .001]],
    [6, [1, .01, .2, .02, .8, 100, .1, 200]],
    [7, [2, .1, .01, .01]],
    [8, [2, .1, .01, .01]],
    [9, [2, .1, .01, .01, 2]],
    [10, [2, .01, .01, .001, .0001, .00001, .000001, .0000001]],
    [11, [1, .01, .2, .02, .8, 100, .1, 200, .01, 300]],
    [12, [2, .01, .01, .001, .0001, .00001, .001, .001]],
    [13, [2, .01, .001, .01, .001, .0001, .00001, .000001, .0000001]],
    [101, [1, 1, .01, .2, .02]],
    [102, [1.5, .01, .001]],
    [103, [2, .01, .01, .001, .0001, .00001, .001]],
    [104, [1.5, .01, 2]],
    [105, [1.5, .01, 2]],
    [106, [3, .1]],
];

function sevenPointDerivatives(values, step) {
    const [m3, m2, m1, center, p1, p2, p3] = values;
    return [
        center,
        (-m3 + 9 * m2 - 45 * m1 + 45 * p1 - 9 * p2 + p3) / (60 * step),
        (2 * m3 - 27 * m2 + 270 * m1 - 490 * center + 270 * p1 - 27 * p2 + 2 * p3)
            / (180 * step * step),
        (m3 - 8 * m2 + 13 * m1 - 13 * p1 + 8 * p2 - p3) / (8 * step ** 3),
    ];
}

// Every formula jet against an independent seven-point omega stencil.
{
    const wavelengthNm = 550;
    const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
    const step = omega * 2e-3;
    for (const [formulaNumber, coefficients] of formulaCases) {
        const wavelengthJetUm = jetScale(wavelengthOmegaJet(wavelengthNm, omega), 1 / 1000);
        const analytic = jetDerivatives(evalNJet(
            formulaNumber, coefficients, wavelengthJetUm,
        )).map(value => value[0]);
        const sampled = [];
        for (let offset = -3; offset <= 3; offset++) {
            const shiftedOmega = omega + offset * step;
            sampled.push(evalN(
                formulaNumber,
                coefficients,
                (2 * Math.PI * C_NM_PER_FS / shiftedOmega) / 1000,
            ));
        }
        const reference = sevenPointDerivatives(sampled, step);
        close(analytic[0], reference[0], 1e-12, `formula ${formulaNumber} value`);
        relativeClose(analytic[1], reference[1], 1e-8, `formula ${formulaNumber} first derivative`);
        relativeClose(analytic[2], reference[2], 1e-5, `formula ${formulaNumber} second derivative`);
        relativeClose(analytic[3], reference[3], 1e-4, `formula ${formulaNumber} third derivative`);
    }
}

// PCHIP derivatives reproduce the active local cubic exactly.
{
    const interpolation = createPchipInterpolator([[0, 0], [1, 1], [2, 1.5], [4, 3]]);
    const x = 1.35;
    const sample = interpolation.derivativesAt(x);
    for (const delta of [-0.1, -0.03, 0.04, 0.12]) {
        const predicted = sample.value + sample.derivatives[0] * delta
            + sample.derivatives[1] * delta ** 2 / 2
            + sample.derivatives[2] * delta ** 3 / 6;
        close(predicted, interpolation(x + delta), 1e-13, 'PCHIP local cubic derivative');
    }
    assert.equal(interpolation.derivativesAt(1).segment, 1, 'an exact knot selects its right-hand piece');
    assert.equal(interpolation.derivativesAt(-1).inRange, false, 'clamped PCHIP reports out of range');
}

// Taylor TMM agrees with the scalar kernel, and rescaling is derivative-invariant.
{
    const wavelengthNm = 550;
    const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
    const wavelengthJet = wavelengthOmegaJet(wavelengthNm, omega);
    const constantIndex = (n, k = 0) => jetFromDerivatives([n, k]);
    const options = {
        wavelengthJet,
        thetaDeg: 23,
        polarization: 'p',
        incidentIndexJet: constantIndex(1),
        substrateIndexJet: constantIndex(1.52),
        layers: [
            { indexJet: constantIndex(2.1, .8), thicknessNm: 800 },
            { indexJet: constantIndex(1.45), thicknessNm: 120 },
        ],
    };
    const analytic = tmmCoefficientJets(options);
    const scalar = tmmWithAdmittances(
        wavelengthNm, 23, 'p', [1, 0], [1.52, 0],
        [{ n: [2.1, .8], d: 800 }, { n: [1.45, 0], d: 120 }],
    );
    close(analytic.reflection[0][0], scalar.r[0], 1e-12, 'Taylor TMM reflection real');
    close(analytic.reflection[0][1], scalar.r[1], 1e-12, 'Taylor TMM reflection imaginary');
    const rescaled = tmmCoefficientJets({ ...options, rescaleThreshold: 10 });
    const unscaled = tmmCoefficientJets({ ...options, rescaleThreshold: Infinity });
    for (const target of ['reflection', 'transmission']) {
        const a = jetDerivatives(rescaled[target]);
        const b = jetDerivatives(unscaled[target]);
        for (let order = 0; order <= 3; order++) {
            close(a[order][0], b[order][0], 1e-8 * Math.max(1, Math.abs(b[order][0])), `${target} rescale real order ${order}`);
            close(a[order][1], b[order][1], 1e-8 * Math.max(1, Math.abs(b[order][1])), `${target} rescale imaginary order ${order}`);
        }
    }
    const opaque = tmmCoefficientJets({
        ...options,
        layers: [{ indexJet: constantIndex(.2, 5), thicknessNm: 1e6 }],
    });
    assert.ok(opaque.reflection.flat(2).every(Number.isFinite), 'opaque-layer clamp keeps every derivative finite');
}

// Closed-form matched dispersive slab, including a non-zero TOD oracle.
{
    const wavelengthNm = 1000;
    const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
    const thicknessNm = 2000;
    const [n, first, second, third] = [2, .05, -.02, .03];
    const indexJet = jetFromDerivatives([n, 0], [first, 0], [second, 0], [third, 0]);
    const coefficients = tmmCoefficientJets({
        wavelengthJet: wavelengthOmegaJet(wavelengthNm, omega),
        thetaDeg: 0,
        polarization: 's',
        incidentIndexJet: indexJet,
        substrateIndexJet: indexJet,
        layers: [{ indexJet, thicknessNm }],
    });
    // tmmcore's own key names: it takes the angular frequency that fixes the
    // unit, so it does not presume fs. Everything above stackEvaluator.js does.
    const result = coefficientPhaseDispersion(coefficients.transmission);
    const scale = thicknessNm / C_NM_PER_FS;
    close(result.gd, scale * (n + omega * first), 1e-11, 'matched slab GD');
    close(result.gdd, scale * (2 * first + omega * second), 1e-11, 'matched slab GDD');
    close(result.tod, scale * (3 * second + omega * third), 1e-10, 'matched slab TOD');
}

const quarterWaveDesign = (() => {
    const wavelength = 550;
    const highIndex = getMaterial('TiO2').getNK(wavelength)[0];
    const lowIndex = getMaterial('SiO2').getNK(wavelength)[0];
    const frontLayers = [];
    for (let pair = 0; pair < 8; pair++) {
        frontLayers.push(
            { material: 'TiO2', thickness: wavelength / (4 * highIndex) },
            { material: 'SiO2', thickness: wavelength / (4 * lowIndex) },
        );
    }
    return {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        frontLayers, backLayers: [], surfaceMode: 'front_only',
    };
})();

// The former five-point path agrees at its truncation accuracy on formula-only
// materials. This is a cross-check, not the independent analytic oracle in
// tests/birge_phase_oracle.mjs.
{
    const wavelength = 550;
    const high = getMaterial('Al2O3');
    const low = getMaterial('MgF2');
    const substrate = getMaterial('SiO2');
    const incident = getMaterial('Air');
    const layers = [];
    for (let pair = 0; pair < 8; pair++) {
        layers.push(
            { material: high, thicknessNm: wavelength / (4 * high.getNK(wavelength)[0]) },
            { material: low, thicknessNm: wavelength / (4 * low.getNK(wavelength)[0]) },
        );
    }
    const analytic = evaluateDesignPhaseDispersion({
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'SiO2', thickness: 1 },
        frontLayers: layers.map(layer => ({
            material: layer.material.id,
            thickness: layer.thicknessNm,
        })),
        backLayers: [],
    }, { wavelengthNm: wavelength, target: 'R', polarization: 's', thetaDeg: 0 });
    const finite = computeGroupDelaySpectrumAtWavelengthStep(lambdaNm => {
        const scalarLayers = layers.map(layer => ({
            n: layer.material.getNK(lambdaNm), d: layer.thicknessNm,
        }));
        return tmmWithAdmittances(
            lambdaNm, 0, 's', incident.getNK(lambdaNm), substrate.getNK(lambdaNm), scalarLayers,
        ).r;
    }, 500, 600, .2);
    const index = finite.lambda.indexOf(wavelength);
    relativeClose(analytic.gdFs, finite.gd[index], 1e-8, 'analytic vs five-point GD');
    relativeClose(analytic.gddFs2, finite.gdd[index], 2e-5, 'analytic vs five-point GDD');
    relativeClose(analytic.todFs3, finite.tod[index], 2e-3, 'analytic vs five-point TOD');
}

// Point values are independent of the presentation grid; knots stay finite.
{
    const point = evaluateDesignPhaseDispersion(quarterWaveDesign, { wavelengthNm: 550 });
    for (const step of [2, .2, .05]) {
        const spectrum = computeGdGddSpectrum(quarterWaveDesign, {
            side: 'front', target: 'R', polarization: 's', thetaDeg: 0,
            lambdaStart: 500, lambdaEnd: 600, lambdaStep: step,
        });
        const index = spectrum.lambda.indexOf(550);
        close(spectrum.gd[index], point.gdFs, 1e-13, `grid-independent GD at step ${step}`);
        close(spectrum.gdd[index], point.gddFs2, 1e-13, `grid-independent GDD at step ${step}`);
        close(spectrum.tod[index], point.todFs3, 1e-12, `grid-independent TOD at step ${step}`);
    }
    for (const wavelength of [548.6 - 1e-6, 548.6, 548.6 + 1e-6]) {
        const value = evaluateDesignPhaseDispersion(quarterWaveDesign, { wavelengthNm: wavelength });
        assert.ok(value.valid && Number.isFinite(value.todFs3), `finite TOD at TiO2 knot side ${wavelength}`);
    }
    const outOfRange = evaluateDesignPhaseDispersion(quarterWaveDesign, { wavelengthNm: 900 });
    assert.equal(outOfRange.valid, false);
    assert.match(outOfRange.reason, /outside the material model range/);
}

// Optimizer operands consume the same point evaluator, including worker tables.
{
    const resolve = designMaterialLookup(quarterWaveDesign);
    const context = buildEvalContext(quarterWaveDesign, resolve);
    for (const [type, target, key] of [
        ['PR', 'R', 'phaseDeg'], ['PT', 'T', 'phaseDeg'],
        ['GD', 'R', 'gdFs'], ['GDT', 'T', 'gdFs'],
        ['GDD', 'R', 'gddFs2'], ['GDDT', 'T', 'gddFs2'],
        ['TOD', 'R', 'todFs3'], ['TODT', 'T', 'todFs3'],
    ]) {
        const operand = makeOperand({ type, lambdaStart: 550, pol: 's', aoi: 0 });
        const expected = evaluateDesignPhaseDispersion(quarterWaveDesign, {
            wavelengthNm: 550, target, polarization: 's', thetaDeg: 0,
        });
        close(evalOperand(operand, context), expected[key], 1e-12, `${type} operand shares point evaluator`);
    }
    const lambdas = [550];
    const ids = ['Air', 'BK7', 'TiO2', 'SiO2'];
    const table = buildPresampledTable(lambdas, ids.map(id => ({ id, mat: resolve(id) })));
    const workerContext = buildEvalContext(quarterWaveDesign, makeResolveMat(table, 'test'));
    const gdd = makeOperand({ type: 'GDD', lambdaStart: 550, pol: 's', aoi: 0 });
    close(evalOperand(gdd, workerContext), evalOperand(gdd, context), 1e-12, 'worker operand preserves material derivatives');
}

// Material fitting is explicit, residual-bearing, non-negative in k, and persistent in wavelength.
{
    const sellmeier = [1, .7, .01];
    const rows = [];
    for (let wavelength = 400; wavelength <= 900; wavelength += 5) {
        const micrometers = wavelength / 1000;
        const squared = micrometers * micrometers;
        const n = Math.sqrt(sellmeier[0] + sellmeier[1] * squared / (squared - sellmeier[2]));
        const k = 1e-5 * Math.exp(-.05 / micrometers + .02 * micrometers);
        rows.push([wavelength, n, k]);
    }
    const fit = fitTabulatedMaterial(rows, {
        nModel: 'sellmeier', termCount: 1, rangeNm: [400, 900],
    });
    fit.n.coefficients.forEach((value, index) => close(value, sellmeier[index], 1e-9, `Sellmeier coefficient ${index}`));
    let independentSum = 0;
    let independentMaximum = 0;
    for (const row of rows) {
        const [n, k] = evaluateDispersionFit(fit, row[0]);
        const error = n - row[1];
        independentSum += error * error;
        independentMaximum = Math.max(independentMaximum, Math.abs(error));
        assert.ok(k >= 0, 'fitted extinction coefficient is non-negative');
    }
    close(fit.residuals.n.rms, Math.sqrt(independentSum / rows.length), 1e-16, 'reported RMS residual');
    close(fit.residuals.n.max, independentMaximum, 1e-16, 'reported maximum residual');

    const fitMaterial = {
        name: 'Synthetic fit',
        dispersionFit: fit,
        getNK: wavelengthNm => evaluateDispersionFit(fit, wavelengthNm),
    };
    const checkWavelength = 552.307;
    const fittedDispersion = materialPropagationDispersion(fitMaterial, checkWavelength, 1);
    const checkOmega = 2 * Math.PI * C_NM_PER_FS / checkWavelength;
    const omegaStep = checkOmega * .002;
    const distanceOverC = 1e6 / C_NM_PER_FS;
    const phaseSamples = [];
    for (let offset = -3; offset <= 3; offset++) {
        const sampleOmega = checkOmega + offset * omegaStep;
        const sampleWavelength = 2 * Math.PI * C_NM_PER_FS / sampleOmega;
        const n = evaluateDispersionFit(fit, sampleWavelength)[0];
        phaseSamples.push(distanceOverC * sampleOmega * n);
    }
    const centerPhase = phaseSamples[3];
    const sampled = sevenPointDerivatives(
        phaseSamples.map(value => value - centerPhase), omegaStep,
    );
    relativeClose(sampled[1], fittedDispersion.gdFs, 1e-9, 'synthetic-fit samples reproduce GD');
    relativeClose(sampled[2], fittedDispersion.gddFs2, 1e-7, 'synthetic-fit samples reproduce GDD');
    relativeClose(sampled[3], fittedDispersion.todFs3, 1e-5, 'synthetic-fit samples reproduce TOD');

    const limitedFit = { ...fit, rangeNm: [500, 700] };
    const tableSampler = createTabulatedNKSampler(rows);
    const fittedSampler = wavelengthNm => wavelengthNm >= 500 && wavelengthNm <= 700
        ? evaluateDispersionFit(limitedFit, wavelengthNm)
        : tableSampler(wavelengthNm);
    Object.assign(fittedSampler, tableSampler, { dispersionFit: limitedFit });
    const limitedMaterial = {
        name: 'Limited synthetic fit', dispersionFit: limitedFit, getNK: fittedSampler,
    };
    assert.match(materialOmegaResponse(limitedMaterial, 600).model, /^Fit:/);
    const tableFallback = materialOmegaResponse(limitedMaterial, 800);
    assert.equal(tableFallback.inRange, true, 'table remains valid outside the narrower fit range');
    assert.equal(tableFallback.model, 'Table (PCHIP)');
}

// Drude-Lorentz fits n and k together and supplies exact complex-index jets.
{
    const sourceModel = {
        kind: 'drude-lorentz',
        epsilonInfinity: 3,
        plasmaEnergyEv: 8.8,
        drudeDampingEv: 0.1,
        oscillators: [{ strengthEv2: 5, resonanceEv: 2.7, dampingEv: 0.6 }],
    };
    const rows = [];
    for (let wavelength = 400; wavelength <= 900; wavelength += 10) {
        rows.push([wavelength, ...evaluateComplexDispersionModel(sourceModel, wavelength)]);
    }
    const fit = fitTabulatedMaterial(rows, {
        nModel: 'drude-lorentz', termCount: 1, rangeNm: [400, 900],
    });
    assert.ok(fit.residuals.n.rms < 1e-10, 'Drude-Lorentz recovers synthetic n');
    assert.ok(fit.residuals.k.rms < 1e-10, 'Drude-Lorentz recovers synthetic k');

    const material = {
        name: 'Synthetic metal', dispersionFit: fit,
        getNK: wavelength => evaluateDispersionFit(fit, wavelength),
    };
    const wavelengthNm = 620;
    const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
    const omegaStep = omega * 2e-3;
    const response = materialOmegaResponse(material, wavelengthNm);
    for (let component = 0; component < 2; component++) {
        const sampled = [];
        for (let offset = -3; offset <= 3; offset++) {
            const shiftedOmega = omega + offset * omegaStep;
            const wavelength = 2 * Math.PI * C_NM_PER_FS / shiftedOmega;
            sampled.push(evaluateDispersionFit(fit, wavelength)[component]);
        }
        const reference = sevenPointDerivatives(sampled, omegaStep);
        close(response.nk[component], reference[0], 1e-12, 'metal fit index value');
        relativeClose(response.derivatives[0][component], reference[1], 1e-8,
            'metal fit first derivative');
        relativeClose(response.derivatives[1][component], reference[2], 1e-5,
            'metal fit second derivative');
        relativeClose(response.derivatives[2][component], reference[3], 1e-4,
            'metal fit third derivative');
    }
}

// Published fused-silica GVD values and additive total-transmission mode.
{
    const silica = getMaterial('SiO2');
    close(materialPropagationDispersion(silica, 800, 1).gddFs2, 36.162, .002, 'fused silica GVD at 800 nm');
    close(materialPropagationDispersion(silica, 550, 1).gddFs2, 62.909, .002, 'fused silica GVD at 550 nm');
    close(materialPropagationDispersion(silica, 1064, 1).gddFs2, 16.476, .002, 'fused silica GVD at 1064 nm');
    const opaqueGold = materialPropagationDispersion(getMaterial('Au'), 550, 1);
    assert.equal(opaqueGold.valid, false, 'an optically opaque bulk path is masked');
    assert.match(opaqueGold.reason, /direct pulse is extinguished/);
    assert.ok(opaqueGold.log10InternalTransmission < -1000,
        'the opacity decision follows the supplied extinction coefficient and thickness');
    close(opaqueGold.maximumThicknessMm, 0.00177, 0.00001,
        'the opacity result gives an actionable Au thickness limit');
    const goldFilm = materialPropagationDispersion(getMaterial('Au'), 550, 0.000001);
    assert.equal(goldFilm.valid, true, 'a nanometre-scale absorbing path remains evaluable');
    const bare = {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [], backLayers: [],
    };
    const total = evaluateTotalTransmissionDispersion(bare, {
        wavelengthNm: 550, polarization: 's', thetaDeg: 0,
    });
    close(total.gdFs, 5157.5585, .001, '1 mm BK7 total GD');
    close(total.gddFs2, 77.0445, .001, '1 mm BK7 total GDD');
    close(total.todFs3, 30.8419, .001, '1 mm BK7 total TOD');
}

console.log('PASS: analytic_dispersion');
