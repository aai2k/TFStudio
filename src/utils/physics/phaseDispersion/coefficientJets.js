/**
 * Characteristic matrix evaluated in third-order Taylor arithmetic.
 *
 * Every quantity carried through the product is a jet in angular frequency, so
 * the reflection and transmission coefficients emerge with their first three
 * frequency derivatives already attached. This is the analytic matrix
 * differentiation of Birge and Kärtner, Applied Optics 45, 1478-1483 (2006),
 * https://doi.org/10.1364/AO.45.001478.
 *
 * Conventions: n + ik, exp(-i omega t), wavelength in nm, thickness in nm.
 */

import {
    jetAdd,
    jetClampImaginary,
    jetConstant,
    jetDivide,
    jetMultiply,
    jetScale,
    jetSinCos,
    jetSqrt,
    jetSubtract,
} from '../taylorJet.js';

const MATRIX_RESCALE_THRESHOLD = 1e100;
const MAX_IMAGINARY_PHASE = 50;

function identityMatrix() {
    return [
        [jetConstant(1), jetConstant(0)],
        [jetConstant(0), jetConstant(1)],
    ];
}

function matrixMultiply(left, right) {
    return [
        [
            jetAdd(jetMultiply(left[0][0], right[0][0]), jetMultiply(left[0][1], right[1][0])),
            jetAdd(jetMultiply(left[0][0], right[0][1]), jetMultiply(left[0][1], right[1][1])),
        ],
        [
            jetAdd(jetMultiply(left[1][0], right[0][0]), jetMultiply(left[1][1], right[1][0])),
            jetAdd(jetMultiply(left[1][0], right[0][1]), jetMultiply(left[1][1], right[1][1])),
        ],
    ];
}

function matrixMagnitude(matrix) {
    let magnitude = 0;
    for (const row of matrix) {
        for (const jet of row) {
            for (const coefficient of jet) {
                magnitude = Math.max(magnitude, Math.abs(coefficient[0]), Math.abs(coefficient[1]));
            }
        }
    }
    return magnitude;
}

function rescaleMatrix(matrix, threshold) {
    // The order-0 matrix controls overflow in the physical coefficient. Once
    // selected, one plain scalar rescales every jet order and cancels from r.
    let scale = 0;
    for (const row of matrix) {
        for (const value of row) {
            scale = Math.max(scale, Math.abs(value[0][0]), Math.abs(value[0][1]));
        }
    }
    if (scale <= threshold) return 0;
    const inverse = 1 / scale;
    for (const row of matrix) {
        for (let column = 0; column < row.length; column++) {
            row[column] = jetScale(row[column], inverse);
        }
    }
    return Math.log(scale);
}

function snellCosine(incidentIndex, incidentSine, layerIndex) {
    const layerSine = jetDivide(jetMultiply(incidentIndex, incidentSine), layerIndex);
    return jetSqrt(jetSubtract(jetConstant(1), jetMultiply(layerSine, layerSine)));
}

function admittance(index, cosine, polarization) {
    return polarization === 's'
        ? jetMultiply(index, cosine)
        : jetDivide(index, cosine);
}

function layerMatrix(index, thicknessNm, wavelength, cosine, polarization) {
    const phase = jetClampImaginary(jetScale(
        jetDivide(jetMultiply(index, cosine), wavelength),
        2 * Math.PI * thicknessNm,
    ), MAX_IMAGINARY_PHASE);
    const { sine, cosine: cosinePhase } = jetSinCos(phase);
    const eta = admittance(index, cosine, polarization);
    const minusI = jetConstant(0, -1);
    return [
        [cosinePhase, jetMultiply(minusI, jetDivide(sine, eta))],
        [jetMultiply(minusI, jetMultiply(eta, sine)), cosinePhase],
    ];
}

function layerMatrixWithThicknessDerivative(index, thicknessNm, wavelength, cosine, polarization) {
    const phasePerNm = jetScale(
        jetDivide(jetMultiply(index, cosine), wavelength),
        2 * Math.PI,
    );
    const rawPhase = jetScale(phasePerNm, thicknessNm);
    const phase = jetClampImaginary(rawPhase, MAX_IMAGINARY_PHASE);
    const phaseDerivative = rawPhase[0][1] === phase[0][1]
        ? phasePerNm
        : phasePerNm.map(coefficient => [coefficient[0], 0]);
    const { sine, cosine: cosinePhase } = jetSinCos(phase);
    const sineDerivative = jetMultiply(cosinePhase, phaseDerivative);
    const cosineDerivative = jetScale(jetMultiply(sine, phaseDerivative), -1);
    const eta = admittance(index, cosine, polarization);
    const minusI = jetConstant(0, -1);
    return {
        matrix: [
            [cosinePhase, jetMultiply(minusI, jetDivide(sine, eta))],
            [jetMultiply(minusI, jetMultiply(eta, sine)), cosinePhase],
        ],
        thicknessDerivative: [
            [cosineDerivative, jetMultiply(minusI, jetDivide(sineDerivative, eta))],
            [jetMultiply(minusI, jetMultiply(eta, sineDerivative)), cosineDerivative],
        ],
    };
}

function coefficientJetsFromMatrix(matrix, incidentEta, substrateEta, logScale = 0) {
    const boundaryB = jetAdd(matrix[0][0], jetMultiply(matrix[0][1], substrateEta));
    const boundaryC = jetAdd(matrix[1][0], jetMultiply(matrix[1][1], substrateEta));
    const incidentB = jetMultiply(incidentEta, boundaryB);
    const denominator = jetAdd(incidentB, boundaryC);
    const reflectionNumerator = jetSubtract(incidentB, boundaryC);
    const reflection = jetDivide(reflectionNumerator, denominator);
    let transmission = jetDivide(jetScale(incidentEta, 2), denominator);
    if (logScale !== 0) transmission = jetScale(transmission, Math.exp(-logScale));
    return {
        reflection,
        transmission,
        denominator,
        reflectionNumerator,
    };
}

function coefficientThicknessJets(matrixDerivative, coefficientData, incidentEta, substrateEta) {
    const boundaryBDerivative = jetAdd(
        matrixDerivative[0][0],
        jetMultiply(matrixDerivative[0][1], substrateEta),
    );
    const boundaryCDerivative = jetAdd(
        matrixDerivative[1][0],
        jetMultiply(matrixDerivative[1][1], substrateEta),
    );
    const incidentBDerivative = jetMultiply(incidentEta, boundaryBDerivative);
    const denominatorDerivative = jetAdd(incidentBDerivative, boundaryCDerivative);
    const numeratorDerivative = jetSubtract(incidentBDerivative, boundaryCDerivative);
    return {
        reflection: jetDivide(
            jetSubtract(
                numeratorDerivative,
                jetMultiply(coefficientData.reflection, denominatorDerivative),
            ),
            coefficientData.denominator,
        ),
        transmission: jetScale(
            jetDivide(
                jetMultiply(coefficientData.transmission, denominatorDerivative),
                coefficientData.denominator,
            ),
            -1,
        ),
    };
}

/** Return complex Taylor jets for r and t at one wavelength. */
export function tmmCoefficientJets({
    wavelengthJet,
    thetaDeg,
    polarization,
    incidentIndexJet,
    substrateIndexJet,
    incidentSineJet = null,
    rescaleThreshold = MATRIX_RESCALE_THRESHOLD,
    layers,
}) {
    const incidentSine = incidentSineJet || jetConstant(Math.sin(thetaDeg * Math.PI / 180));
    const incidentCosine = incidentSineJet
        ? jetSqrt(jetSubtract(jetConstant(1), jetMultiply(incidentSine, incidentSine)))
        : jetConstant(Math.cos(thetaDeg * Math.PI / 180));
    const incidentEta = admittance(incidentIndexJet, incidentCosine, polarization);
    const substrateCosine = snellCosine(incidentIndexJet, incidentSine, substrateIndexJet);
    const substrateEta = admittance(substrateIndexJet, substrateCosine, polarization);

    let matrix = identityMatrix();
    let logScale = 0;
    for (const layer of layers) {
        if (!(layer.thicknessNm > 0)) continue;
        const cosine = snellCosine(incidentIndexJet, incidentSine, layer.indexJet);
        matrix = matrixMultiply(matrix, layerMatrix(
            layer.indexJet,
            layer.thicknessNm,
            wavelengthJet,
            cosine,
            polarization,
        ));
        logScale += rescaleMatrix(matrix, rescaleThreshold);
    }

    const coefficients = coefficientJetsFromMatrix(matrix, incidentEta, substrateEta, logScale);
    return {
        reflection: coefficients.reflection,
        transmission: coefficients.transmission,
        incidentEta,
        substrateEta,
    };
}

/**
 * Return coefficient jets and their exact derivatives with respect to every
 * layer thickness. Frequency remains the Taylor variable, so each thickness
 * derivative is itself a third-order frequency jet.
 */
export function tmmCoefficientThicknessJets(options) {
    const {
        wavelengthJet,
        thetaDeg,
        polarization,
        incidentIndexJet,
        substrateIndexJet,
        incidentSineJet = null,
        rescaleThreshold = MATRIX_RESCALE_THRESHOLD,
        layers,
    } = options;
    const incidentSine = incidentSineJet || jetConstant(Math.sin(thetaDeg * Math.PI / 180));
    const incidentCosine = incidentSineJet
        ? jetSqrt(jetSubtract(jetConstant(1), jetMultiply(incidentSine, incidentSine)))
        : jetConstant(Math.cos(thetaDeg * Math.PI / 180));
    const incidentEta = admittance(incidentIndexJet, incidentCosine, polarization);
    const substrateCosine = snellCosine(incidentIndexJet, incidentSine, substrateIndexJet);
    const substrateEta = admittance(substrateIndexJet, substrateCosine, polarization);
    const layerData = layers.map((layer) => {
        const cosine = snellCosine(incidentIndexJet, incidentSine, layer.indexJet);
        return layerMatrixWithThicknessDerivative(
            layer.indexJet,
            layer.thicknessNm,
            wavelengthJet,
            cosine,
            polarization,
        );
    });

    const prefix = new Array(layerData.length + 1);
    prefix[0] = identityMatrix();
    for (let index = 0; index < layerData.length; index++) {
        prefix[index + 1] = matrixMultiply(prefix[index], layerData[index].matrix);
        if (matrixMagnitude(prefix[index + 1]) > rescaleThreshold) {
            const coefficients = tmmCoefficientJets(options);
            return { ...coefficients, thicknessDerivatives: null };
        }
    }
    const suffix = new Array(layerData.length + 1);
    suffix[layerData.length] = identityMatrix();
    for (let index = layerData.length - 1; index >= 0; index--) {
        suffix[index] = matrixMultiply(layerData[index].matrix, suffix[index + 1]);
    }

    const coefficientData = coefficientJetsFromMatrix(
        prefix[layerData.length],
        incidentEta,
        substrateEta,
    );
    const thicknessDerivatives = layerData.map((layer, index) => {
        const matrixDerivative = matrixMultiply(
            matrixMultiply(prefix[index], layer.thicknessDerivative),
            suffix[index + 1],
        );
        return coefficientThicknessJets(
            matrixDerivative,
            coefficientData,
            incidentEta,
            substrateEta,
        );
    });
    return {
        reflection: coefficientData.reflection,
        transmission: coefficientData.transmission,
        reflectionThickness: thicknessDerivatives.map(value => value.reflection),
        transmissionThickness: thicknessDerivatives.map(value => value.transmission),
        incidentEta,
        substrateEta,
        thicknessDerivatives,
    };
}
