/**
 * Group delay, group delay dispersion, and third-order dispersion read off a
 * coefficient jet.
 *
 * With r(omega) carried as a Taylor jet, the reported orders are the imaginary
 * parts of the logarithmic derivatives of r:
 *     phi'   = Im(r'/r)
 *     phi''  = Im(r''/r - (r'/r)^2)
 *     phi''' = Im(r'''/r - 3 r'r''/r^2 + 2 (r'/r)^3)
 * No phase unwrapping and no wavelength finite-difference stencil takes part,
 * so a value at one wavelength is independent of every neighbouring sample.
 *
 * Units: GD in fs, GDD in fs^2, TOD in fs^3.
 */

import { jetConstant, jetDerivatives, jetDivide } from '../taylorJet.js';

function phaseDerivatives(coefficientJet) {
    const [value, first, second, third] = jetDerivatives(coefficientJet);
    const magnitudeSquared = value[0] * value[0] + value[1] * value[1];
    if (magnitudeSquared === 0 || !Number.isFinite(magnitudeSquared)) return null;

    const valueJet = jetConstant(value[0], value[1]);
    const firstJet = jetConstant(first[0], first[1]);
    const secondJet = jetConstant(second[0], second[1]);
    const thirdJet = jetConstant(third[0], third[1]);
    const firstRatio = jetDivide(firstJet, valueJet)[0];
    const secondRatio = jetDivide(secondJet, valueJet)[0];
    const thirdRatio = jetDivide(thirdJet, valueJet)[0];
    const squareFirst = [
        firstRatio[0] * firstRatio[0] - firstRatio[1] * firstRatio[1],
        2 * firstRatio[0] * firstRatio[1],
    ];
    const firstTimesSecond = [
        firstRatio[0] * secondRatio[0] - firstRatio[1] * secondRatio[1],
        firstRatio[0] * secondRatio[1] + firstRatio[1] * secondRatio[0],
    ];
    const cubeFirst = [
        squareFirst[0] * firstRatio[0] - squareFirst[1] * firstRatio[1],
        squareFirst[0] * firstRatio[1] + squareFirst[1] * firstRatio[0],
    ];

    // TFStudio uses n + ik and exp(-i omega t), the conjugate of Macleod's
    // convention. Macleod defines each reported order as minus the derivative
    // of physical phase, so all three equal derivatives of this raw TMM phase.
    const phaseRad = -Math.atan2(value[1], value[0]);
    return {
        phaseRad,
        phaseDeg: phaseRad * 180 / Math.PI,
        gdFs: firstRatio[1],
        gddFs2: secondRatio[1] - squareFirst[1],
        todFs3: thirdRatio[1] - 3 * firstTimesSecond[1] + 2 * cubeFirst[1],
        magnitudeSquared,
    };
}

export function coefficientPhaseDispersion(coefficientJet) {
    return phaseDerivatives(coefficientJet);
}

/** Exact thickness derivatives of the reported phase-dispersion quantities. */
export function coefficientPhaseThicknessDerivatives(coefficientJet, thicknessJets) {
    if (!thicknessJets) return null;
    const result = {
        phaseDeg: [],
        gdFs: [],
        gddFs2: [],
        todFs3: [],
    };
    for (const thicknessJet of thicknessJets) {
        const logarithmicDerivative = jetDivide(thicknessJet, coefficientJet);
        const derivatives = jetDerivatives(logarithmicDerivative);
        result.phaseDeg.push(-derivatives[0][1] * 180 / Math.PI);
        result.gdFs.push(derivatives[1][1]);
        result.gddFs2.push(derivatives[2][1]);
        result.todFs3.push(derivatives[3][1]);
    }
    return result;
}
