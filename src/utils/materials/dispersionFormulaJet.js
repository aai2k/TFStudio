/** Exact third-order Taylor evaluation of TFStudio's dispersion formulas. */

import {
    jetAdd,
    jetClampRealMinimum,
    jetConstant,
    jetDivide,
    jetMultiply,
    jetPower,
    jetScale,
    jetSqrt,
    jetSubtract,
} from '../physics/taylorJet.js';

const coefficient = (coefficients, index) => coefficients?.[index] ?? 0;
const constant = value => jetConstant(value);
const square = value => jetMultiply(value, value);
const reciprocal = value => jetDivide(constant(1), value);

function sum(...terms) {
    return terms.reduce((total, term) => jetAdd(total, term), constant(0));
}

function guardedDenominator(value, epsilon = 1e-12) {
    const base = value[0][0];
    if (Math.abs(base) >= epsilon) return value;
    return constant(base < 0 ? -epsilon : epsilon);
}

function squareRootIndex(nSquared, minimum) {
    return jetSqrt(jetClampRealMinimum(nSquared, minimum));
}

function inverseEvenPowers(lambda, maximumPower) {
    const lambdaSquared = square(lambda);
    const powers = [null, reciprocal(lambdaSquared)];
    for (let power = 2; power <= maximumPower; power++) {
        powers[power] = jetMultiply(powers[power - 1], powers[1]);
    }
    return { lambdaSquared, powers };
}

function resonanceSum(coefficients, lambdaSquared, pairs, base = 1) {
    let result = constant(base);
    for (let pair = 0; pair < pairs; pair++) {
        const index = pair * 2;
        const term = jetDivide(
            jetScale(lambdaSquared, coefficient(coefficients, index)),
            guardedDenominator(jetSubtract(lambdaSquared, constant(coefficient(coefficients, index + 1)))),
        );
        result = jetAdd(result, term);
    }
    return result;
}

const evaluators = {
    1(coefficients, lambda) {
        const { lambdaSquared, powers } = inverseEvenPowers(lambda, 4);
        return squareRootIndex(sum(
            constant(coefficient(coefficients, 0)),
            jetScale(lambdaSquared, coefficient(coefficients, 1)),
            ...[2, 3, 4, 5].map((index, offset) =>
                jetScale(powers[offset + 1], coefficient(coefficients, index))),
        ), 1);
    },
    2(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        return squareRootIndex(resonanceSum(coefficients, lambdaSquared, 3), 1);
    },
    3(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        const herzbergerTerm = reciprocal(guardedDenominator(
            jetSubtract(lambdaSquared, constant(0.028)),
        ));
        return sum(
            constant(coefficient(coefficients, 0)),
            jetScale(herzbergerTerm, coefficient(coefficients, 1)),
            jetScale(square(herzbergerTerm), coefficient(coefficients, 2)),
            jetScale(lambdaSquared, coefficient(coefficients, 3)),
            jetScale(square(lambdaSquared), coefficient(coefficients, 4)),
            jetScale(jetMultiply(square(lambdaSquared), lambdaSquared), coefficient(coefficients, 5)),
        );
    },
    4(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        const firstPole = coefficient(coefficients, 2) ** 2;
        const secondPole = coefficient(coefficients, 4) ** 2;
        return squareRootIndex(sum(
            constant(1 + coefficient(coefficients, 0)),
            jetDivide(
                jetScale(lambdaSquared, coefficient(coefficients, 1)),
                guardedDenominator(jetSubtract(lambdaSquared, constant(firstPole))),
            ),
            jetDivide(
                constant(coefficient(coefficients, 3)),
                guardedDenominator(jetSubtract(lambdaSquared, constant(secondPole))),
            ),
        ), 1);
    },
    5(coefficients, lambda) {
        return sum(
            constant(coefficient(coefficients, 0)),
            jetScale(reciprocal(lambda), coefficient(coefficients, 1)),
            jetScale(jetPower(lambda, -3.5), coefficient(coefficients, 2)),
        );
    },
    6(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        return squareRootIndex(resonanceSum(coefficients, lambdaSquared, 4), 1);
    },
    7(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        return squareRootIndex(sum(
            constant(coefficient(coefficients, 0)),
            jetDivide(
                constant(coefficient(coefficients, 1)),
                guardedDenominator(jetSubtract(lambdaSquared, constant(coefficient(coefficients, 2)))),
            ),
            jetScale(lambdaSquared, -coefficient(coefficients, 3)),
        ), 1);
    },
    8(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        return squareRootIndex(sum(
            constant(coefficient(coefficients, 0)),
            jetDivide(
                jetScale(lambdaSquared, coefficient(coefficients, 1)),
                guardedDenominator(jetSubtract(lambdaSquared, constant(coefficient(coefficients, 2)))),
            ),
            jetScale(lambdaSquared, -coefficient(coefficients, 3)),
        ), 1);
    },
    9(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        return squareRootIndex(sum(
            constant(coefficient(coefficients, 0)),
            jetDivide(
                jetScale(lambdaSquared, coefficient(coefficients, 1)),
                guardedDenominator(jetSubtract(lambdaSquared, constant(coefficient(coefficients, 2)))),
            ),
            jetDivide(
                jetScale(lambdaSquared, coefficient(coefficients, 3)),
                guardedDenominator(jetSubtract(lambdaSquared, constant(coefficient(coefficients, 4)))),
            ),
        ), 1);
    },
    10(coefficients, lambda) {
        const { lambdaSquared, powers } = inverseEvenPowers(lambda, 6);
        return squareRootIndex(sum(
            constant(coefficient(coefficients, 0)),
            jetScale(lambdaSquared, coefficient(coefficients, 1)),
            ...[2, 3, 4, 5, 6, 7].map((index, offset) =>
                jetScale(powers[offset + 1], coefficient(coefficients, index))),
        ), 1);
    },
    11(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        return squareRootIndex(resonanceSum(coefficients, lambdaSquared, 5), 1);
    },
    12(coefficients, lambda) {
        const { lambdaSquared, powers } = inverseEvenPowers(lambda, 4);
        const lambdaFourth = square(lambdaSquared);
        return squareRootIndex(sum(
            constant(coefficient(coefficients, 0)),
            jetScale(lambdaSquared, coefficient(coefficients, 1)),
            ...[2, 3, 4, 5].map((index, offset) =>
                jetScale(powers[offset + 1], coefficient(coefficients, index))),
            jetScale(lambdaFourth, coefficient(coefficients, 6)),
            jetScale(jetMultiply(lambdaFourth, lambdaSquared), coefficient(coefficients, 7)),
        ), 1);
    },
    13(coefficients, lambda) {
        const { lambdaSquared, powers } = inverseEvenPowers(lambda, 6);
        return squareRootIndex(sum(
            constant(coefficient(coefficients, 0)),
            jetScale(lambdaSquared, coefficient(coefficients, 1)),
            jetScale(square(lambdaSquared), coefficient(coefficients, 2)),
            ...[3, 4, 5, 6, 7, 8].map((index, offset) =>
                jetScale(powers[offset + 1], coefficient(coefficients, index))),
        ), 1);
    },
    101(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        let nSquared = constant(coefficient(coefficients, 0));
        for (let index = 1; index + 1 < coefficients.length; index += 2) {
            const denominator = jetSubtract(lambdaSquared, constant(coefficients[index + 1]));
            if (Math.abs(denominator[0][0]) > 1e-15) {
                nSquared = jetAdd(nSquared, jetDivide(
                    jetScale(lambdaSquared, coefficients[index]), denominator,
                ));
            }
        }
        return squareRootIndex(nSquared, 1e-6);
    },
    102(coefficients, lambda) {
        const inverseSquared = reciprocal(square(lambda));
        return sum(
            constant(coefficient(coefficients, 0)),
            jetScale(inverseSquared, coefficient(coefficients, 1)),
            jetScale(square(inverseSquared), coefficient(coefficients, 2)),
        );
    },
    103(coefficients, lambda) {
        const { lambdaSquared, powers } = inverseEvenPowers(lambda, 4);
        return squareRootIndex(sum(
            constant(coefficient(coefficients, 0)),
            jetScale(lambdaSquared, coefficient(coefficients, 1)),
            ...[2, 3, 4, 5].map((index, offset) =>
                jetScale(powers[offset + 1], coefficient(coefficients, index))),
            jetScale(square(lambdaSquared), coefficient(coefficients, 6)),
        ), 1e-6);
    },
    104(coefficients, lambda) {
        const denominator = jetSubtract(constant(coefficient(coefficients, 2)), lambda);
        const correction = Math.abs(denominator[0][0]) > 1e-15
            ? jetDivide(constant(coefficient(coefficients, 1)), denominator)
            : constant(0);
        return jetAdd(constant(coefficient(coefficients, 0)), correction);
    },
    105(coefficients, lambda) {
        const denominator = jetSubtract(constant(coefficient(coefficients, 2)), lambda);
        const correction = denominator[0][0] > 1e-15
            ? jetScale(jetPower(denominator, -1.2), coefficient(coefficients, 1))
            : constant(0);
        return jetAdd(constant(coefficient(coefficients, 0)), correction);
    },
    106(coefficients, lambda) {
        return squareRootIndex(jetSubtract(
            constant(coefficient(coefficients, 0)),
            jetScale(square(lambda), coefficient(coefficients, 1)),
        ), 1e-6);
    },
};

export function evalNJet(formulaNumber, coefficients, wavelengthMicrometersJet) {
    const evaluator = evaluators[formulaNumber];
    if (!evaluator) return null;
    return evaluator(coefficients || [], wavelengthMicrometersJet);
}
