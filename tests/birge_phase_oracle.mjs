/**
 * Independent analytic multilayer-dispersion oracle.
 *
 * This test implements raw complex derivatives and the binomial product
 * recurrence separately from the production Taylor-coefficient arithmetic.
 * Method: J. Birge and F. X. Kartner, Applied Optics 45, 1478-1483 (2006),
 * https://doi.org/10.1364/AO.45.001478.
 */

import assert from 'node:assert/strict';

import { evaluateStackPhaseDispersion } from '../src/utils/physics/designPhaseDispersion.js';
import { C_NM_PER_FS } from '../src/utils/materials/materialDispersion.js';

const ORDER = 3;
const BINOMIAL = [
    [1],
    [1, 1],
    [1, 2, 1],
    [1, 3, 3, 1],
];

const cadd = (left, right) => [left[0] + right[0], left[1] + right[1]];
const csub = (left, right) => [left[0] - right[0], left[1] - right[1]];
const cscale = (value, scale) => [value[0] * scale, value[1] * scale];
const cmul = (left, right) => [
    left[0] * right[0] - left[1] * right[1],
    left[0] * right[1] + left[1] * right[0],
];
const cdiv = (left, right) => {
    const denominator = right[0] ** 2 + right[1] ** 2;
    return [
        (left[0] * right[0] + left[1] * right[1]) / denominator,
        (left[1] * right[0] - left[0] * right[1]) / denominator,
    ];
};
const csqrt = (value) => {
    const magnitudeRoot = Math.sqrt(Math.hypot(value[0], value[1]));
    const halfAngle = Math.atan2(value[1], value[0]) / 2;
    return [magnitudeRoot * Math.cos(halfAngle), magnitudeRoot * Math.sin(halfAngle)];
};

const zeros = () => Array.from({ length: ORDER + 1 }, () => [0, 0]);
const derivativeConstant = (real, imaginary = 0) => {
    const result = zeros();
    result[0] = [real, imaginary];
    return result;
};
const derivativeAdd = (left, right) => left.map((value, order) => cadd(value, right[order]));
const derivativeSubtract = (left, right) => left.map((value, order) => csub(value, right[order]));
const derivativeScale = (value, scale) => value.map(item => cscale(item, scale));

function derivativeMultiply(left, right) {
    const result = zeros();
    for (let order = 0; order <= ORDER; order++) {
        for (let index = 0; index <= order; index++) {
            result[order] = cadd(result[order], cscale(
                cmul(left[index], right[order - index]),
                BINOMIAL[order][index],
            ));
        }
    }
    return result;
}

function derivativeReciprocal(value) {
    const result = zeros();
    result[0] = cdiv([1, 0], value[0]);
    for (let order = 1; order <= ORDER; order++) {
        let known = [0, 0];
        for (let index = 1; index <= order; index++) {
            known = cadd(known, cscale(
                cmul(value[index], result[order - index]),
                BINOMIAL[order][index],
            ));
        }
        result[order] = cscale(cdiv(known, value[0]), -1);
    }
    return result;
}

const derivativeDivide = (left, right) => derivativeMultiply(left, derivativeReciprocal(right));

function derivativeSqrt(value) {
    const result = zeros();
    result[0] = csqrt(value[0]);
    const twiceRoot = cscale(result[0], 2);
    for (let order = 1; order <= ORDER; order++) {
        let known = [0, 0];
        for (let index = 1; index < order; index++) {
            known = cadd(known, cscale(
                cmul(result[index], result[order - index]),
                BINOMIAL[order][index],
            ));
        }
        result[order] = cdiv(csub(value[order], known), twiceRoot);
    }
    return result;
}

function derivativeSinCos(value) {
    const sine = zeros();
    const cosine = zeros();
    const [real, imaginary] = value[0];
    sine[0] = [Math.sin(real) * Math.cosh(imaginary), Math.cos(real) * Math.sinh(imaginary)];
    cosine[0] = [Math.cos(real) * Math.cosh(imaginary), -Math.sin(real) * Math.sinh(imaginary)];
    for (let order = 1; order <= ORDER; order++) {
        for (let index = 0; index < order; index++) {
            const factor = BINOMIAL[order - 1][index];
            sine[order] = cadd(sine[order], cscale(
                cmul(cosine[index], value[order - index]), factor,
            ));
            cosine[order] = csub(cosine[order], cscale(
                cmul(sine[index], value[order - index]), factor,
            ));
        }
    }
    return { sine, cosine };
}

function matrixIdentity() {
    return [
        [derivativeConstant(1), derivativeConstant(0)],
        [derivativeConstant(0), derivativeConstant(1)],
    ];
}

function matrixMultiply(left, right) {
    return [
        [
            derivativeAdd(derivativeMultiply(left[0][0], right[0][0]), derivativeMultiply(left[0][1], right[1][0])),
            derivativeAdd(derivativeMultiply(left[0][0], right[0][1]), derivativeMultiply(left[0][1], right[1][1])),
        ],
        [
            derivativeAdd(derivativeMultiply(left[1][0], right[0][0]), derivativeMultiply(left[1][1], right[1][0])),
            derivativeAdd(derivativeMultiply(left[1][0], right[0][1]), derivativeMultiply(left[1][1], right[1][1])),
        ],
    ];
}

const snellCosine = (incidentIndex, incidentSine, layerIndex) => {
    const layerSine = derivativeDivide(
        derivativeMultiply(incidentIndex, incidentSine),
        layerIndex,
    );
    return derivativeSqrt(derivativeSubtract(
        derivativeConstant(1),
        derivativeMultiply(layerSine, layerSine),
    ));
};

const admittance = (index, cosine, polarization) => polarization === 's'
    ? derivativeMultiply(index, cosine)
    : derivativeDivide(index, cosine);

function layerMatrix(index, thicknessNm, wavelength, cosine, polarization) {
    const phase = derivativeScale(
        derivativeDivide(derivativeMultiply(index, cosine), wavelength),
        2 * Math.PI * thicknessNm,
    );
    const phaseFunctions = derivativeSinCos(phase);
    const eta = admittance(index, cosine, polarization);
    const minusI = derivativeConstant(0, -1);
    return [
        [
            phaseFunctions.cosine,
            derivativeMultiply(minusI, derivativeDivide(phaseFunctions.sine, eta)),
        ],
        [
            derivativeMultiply(minusI, derivativeMultiply(eta, phaseFunctions.sine)),
            phaseFunctions.cosine,
        ],
    ];
}

function coefficientDerivatives(options) {
    const {
        wavelength, thetaDeg, polarization, incidentIndex, substrateIndex, layers,
    } = options;
    const incidentSine = derivativeConstant(Math.sin(thetaDeg * Math.PI / 180));
    const incidentCosine = derivativeConstant(Math.cos(thetaDeg * Math.PI / 180));
    const incidentEta = admittance(incidentIndex, incidentCosine, polarization);
    const substrateCosine = snellCosine(incidentIndex, incidentSine, substrateIndex);
    const substrateEta = admittance(substrateIndex, substrateCosine, polarization);
    let matrix = matrixIdentity();
    for (const layer of layers) {
        const cosine = snellCosine(incidentIndex, incidentSine, layer.index);
        matrix = matrixMultiply(matrix, layerMatrix(
            layer.index, layer.thicknessNm, wavelength, cosine, polarization,
        ));
    }
    const boundaryB = derivativeAdd(matrix[0][0], derivativeMultiply(matrix[0][1], substrateEta));
    const boundaryC = derivativeAdd(matrix[1][0], derivativeMultiply(matrix[1][1], substrateEta));
    const incidentB = derivativeMultiply(incidentEta, boundaryB);
    const denominator = derivativeAdd(incidentB, boundaryC);
    return {
        reflection: derivativeDivide(derivativeSubtract(incidentB, boundaryC), denominator),
        transmission: derivativeDivide(derivativeScale(incidentEta, 2), denominator),
    };
}

function phaseDispersion(coefficient) {
    const firstRatio = cdiv(coefficient[1], coefficient[0]);
    const secondRatio = cdiv(coefficient[2], coefficient[0]);
    const thirdRatio = cdiv(coefficient[3], coefficient[0]);
    const firstSquared = cmul(firstRatio, firstRatio);
    const firstCubed = cmul(firstSquared, firstRatio);
    const firstSecond = cmul(firstRatio, secondRatio);
    return {
        phaseDeg: -Math.atan2(coefficient[0][1], coefficient[0][0]) * 180 / Math.PI,
        gdFs: firstRatio[1],
        gddFs2: csub(secondRatio, firstSquared)[1],
        todFs3: cadd(csub(thirdRatio, cscale(firstSecond, 3)), cscale(firstCubed, 2))[1],
    };
}

function wavelengthDerivatives(wavelengthNm) {
    const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
    return [
        [wavelengthNm, 0],
        [-wavelengthNm / omega, 0],
        [2 * wavelengthNm / omega ** 2, 0],
        [-6 * wavelengthNm / omega ** 3, 0],
    ];
}

function polynomialMaterial(id, omegaReference, coefficients) {
    const rawAt = wavelengthNm => {
        const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
        const x = omega - omegaReference;
        const [base, first, second, third] = coefficients;
        return [
            [base + first * x + second * x ** 2 / 2 + third * x ** 3 / 6, 0],
            [first + second * x + third * x ** 2 / 2, 0],
            [second + third * x, 0],
            [third, 0],
        ];
    };
    return {
        id,
        name: id,
        rawAt,
        getNK: wavelengthNm => rawAt(wavelengthNm)[0],
        getOmegaResponse: wavelengthNm => {
            const raw = rawAt(wavelengthNm);
            return {
                nk: raw[0],
                derivatives: raw.slice(1),
                jet: [raw[0], raw[1], cscale(raw[2], 1 / 2), cscale(raw[3], 1 / 6)],
                model: 'Polynomial oracle',
                maxOrder: 3,
                inRange: true,
            };
        },
    };
}

const wavelengthNm = 610;
const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
const incident = polynomialMaterial('Incident', omega, [1.01, .002, -.001, .0003]);
const substrate = polynomialMaterial('Substrate', omega, [1.53, .006, .002, -.0005]);
const layerMaterials = [
    polynomialMaterial('High', omega, [2.13, .012, -.004, .001]),
    polynomialMaterial('Low', omega, [1.46, -.005, .003, -.0008]),
    polynomialMaterial('Middle', omega, [1.82, .008, .001, .0006]),
];
const layers = [
    { material: layerMaterials[0], thicknessNm: 87.2 },
    { material: layerMaterials[1], thicknessNm: 132.7 },
    { material: layerMaterials[2], thicknessNm: 64.1 },
    { material: layerMaterials[1], thicknessNm: 119.4 },
];
const oracleCoefficients = coefficientDerivatives({
    wavelength: wavelengthDerivatives(wavelengthNm),
    thetaDeg: 27,
    polarization: 'p',
    incidentIndex: incident.rawAt(wavelengthNm),
    substrateIndex: substrate.rawAt(wavelengthNm),
    layers: layers.map(layer => ({
        index: layer.material.rawAt(wavelengthNm),
        thicknessNm: layer.thicknessNm,
    })),
});

for (const [target, coefficientName] of [['R', 'reflection'], ['T', 'transmission']]) {
    const expected = phaseDispersion(oracleCoefficients[coefficientName]);
    const actual = evaluateStackPhaseDispersion({
        wavelengthNm,
        target,
        polarization: 'p',
        thetaDeg: 27,
        incidentMaterial: incident,
        substrateMaterial: substrate,
        layers,
    });
    assert.equal(actual.valid, true);
    for (const key of ['phaseDeg', 'gdFs', 'gddFs2', 'todFs3']) {
        const tolerance = 2e-10 * Math.max(1, Math.abs(expected[key]));
        assert.ok(
            Math.abs(actual[key] - expected[key]) <= tolerance,
            `${target} ${key}: got ${actual[key]}, expected ${expected[key]}`,
        );
    }
}

console.log('PASS: birge_phase_oracle');
