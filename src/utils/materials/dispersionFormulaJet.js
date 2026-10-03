/** Exact third-order Taylor evaluation of TFStudio's dispersion formulas. */

import {
    jetAdd,
    jetConstant,
    jetDivide,
    jetIsFinite,
    jetMultiply,
    jetPower,
    jetScale,
    jetSqrt,
    jetSubtract,
} from '../../tmmcore.js';

const coefficient = (coefficients, index) => coefficients?.[index] ?? 0;
const constant = value => jetConstant(value);
const square = value => jetMultiply(value, value);
const reciprocal = value => jetDivide(constant(1), value);

function sum(...terms) {
    return terms.reduce((total, term) => jetAdd(total, term), constant(0));
}

// The formulas as dispersionFormulas.js evaluates them: no clamp, a term whose
// multiplier is 0 left out. Where the formula gives no real, positive n there
// is no jet, so the point has no derivatives, as it has no index.
function realIndexJet(jet) {
    const [real, imaginary] = jet[0];
    return real > 0 && imaginary === 0 && jetIsFinite(jet) ? jet : null;
}

const realIndexJetFromSquare = nSquared => realIndexJet(jetSqrt(nSquared));

// strength/denominator, nothing when the strength is 0.
function poleTermJet(strength, denominator) {
    return strength ? jetDivide(constant(strength), denominator) : constant(0);
}

// K·λ²/(λ² − L), a resonance at L µm²; nothing when K is 0.
function resonanceTermJet(strength, lambdaSquared, pole) {
    if (!strength) return constant(0);
    return jetDivide(jetScale(lambdaSquared, strength), jetSubtract(lambdaSquared, constant(pole)));
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
        result = jetAdd(result, resonanceTermJet(
            coefficient(coefficients, index), lambdaSquared, coefficient(coefficients, index + 1),
        ));
    }
    return result;
}

// Zemax formula 3, which is also the database's formula 7 (catalog 207).
function herzbergerJet(coefficients, lambda) {
    const lambdaSquared = square(lambda);
    const herzbergerTerm = reciprocal(jetSubtract(lambdaSquared, constant(0.028)));
    return realIndexJet(sum(
        constant(coefficient(coefficients, 0)),
        jetScale(herzbergerTerm, coefficient(coefficients, 1)),
        jetScale(square(herzbergerTerm), coefficient(coefficients, 2)),
        jetScale(lambdaSquared, coefficient(coefficients, 3)),
        jetScale(square(lambdaSquared), coefficient(coefficients, 4)),
        jetScale(jetMultiply(square(lambdaSquared), lambdaSquared), coefficient(coefficients, 5)),
    ));
}

// The refractiveindex.info forms read a coefficient the page does not give as 0.
function riiSeriesJet(coefficients, first, start, term) {
    let sum = start;
    for (let index = first; index < coefficients.length; index += 2) {
        if (coefficients[index]) {
            sum = jetAdd(sum, term(coefficients[index], coefficient(coefficients, index + 1)));
        }
    }
    return sum;
}

const powerTerm = lambda => (multiplier, exponent) => jetScale(jetPower(lambda, exponent), multiplier);

function riiResonanceJet(coefficients, lambda, first) {
    const lambdaSquared = square(lambda);
    const resonance = coefficient(coefficients, first + 2) ** coefficient(coefficients, first + 3);
    return jetDivide(
        jetScale(jetPower(lambda, coefficient(coefficients, first + 1)), coefficients[first]),
        jetSubtract(lambdaSquared, constant(resonance)),
    );
}

const riiEvaluators = {
    201(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        return realIndexJetFromSquare(riiSeriesJet(coefficients, 1, constant(1 + coefficient(coefficients, 0)),
            (strength, resonance) => jetDivide(
                jetScale(lambdaSquared, strength),
                jetSubtract(lambdaSquared, constant(resonance * resonance)),
            )));
    },
    202(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        return realIndexJetFromSquare(riiSeriesJet(coefficients, 1, constant(1 + coefficient(coefficients, 0)),
            (strength, resonance) => jetDivide(
                jetScale(lambdaSquared, strength),
                jetSubtract(lambdaSquared, constant(resonance)),
            )));
    },
    203(coefficients, lambda) {
        return realIndexJetFromSquare(riiSeriesJet(
            coefficients, 1, constant(coefficient(coefficients, 0)), powerTerm(lambda),
        ));
    },
    204(coefficients, lambda) {
        let nSquared = constant(coefficient(coefficients, 0));
        for (const first of [1, 5]) {
            if (coefficients[first]) nSquared = jetAdd(nSquared, riiResonanceJet(coefficients, lambda, first));
        }
        return realIndexJetFromSquare(riiSeriesJet(coefficients, 9, nSquared, powerTerm(lambda)));
    },
    205(coefficients, lambda) {
        return realIndexJet(riiSeriesJet(
            coefficients, 1, constant(coefficient(coefficients, 0)), powerTerm(lambda),
        ));
    },
    206(coefficients, lambda) {
        const inverseSquared = reciprocal(square(lambda));
        return realIndexJet(riiSeriesJet(coefficients, 1, constant(1 + coefficient(coefficients, 0)),
            (strength, resonance) => jetDivide(
                constant(strength),
                jetSubtract(constant(resonance), inverseSquared),
            )));
    },
    207: herzbergerJet,
    208(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        const polarizability = sum(
            constant(coefficient(coefficients, 0)),
            jetDivide(
                jetScale(lambdaSquared, coefficient(coefficients, 1)),
                jetSubtract(lambdaSquared, constant(coefficient(coefficients, 2))),
            ),
            jetScale(lambdaSquared, coefficient(coefficients, 3)),
        );
        return realIndexJetFromSquare(jetDivide(
            jetAdd(constant(1), jetScale(polarizability, 2)),
            jetSubtract(constant(1), polarizability),
        ));
    },
    209(coefficients, lambda) {
        const offset = jetSubtract(lambda, constant(coefficient(coefficients, 4)));
        return realIndexJetFromSquare(sum(
            constant(coefficient(coefficients, 0)),
            jetDivide(
                constant(coefficient(coefficients, 1)),
                jetSubtract(square(lambda), constant(coefficient(coefficients, 2))),
            ),
            jetDivide(
                jetScale(offset, coefficient(coefficients, 3)),
                jetAdd(square(offset), constant(coefficient(coefficients, 5))),
            ),
        ));
    },
};

const evaluators = {
    1(coefficients, lambda) {
        const { lambdaSquared, powers } = inverseEvenPowers(lambda, 4);
        return realIndexJetFromSquare(sum(
            constant(coefficient(coefficients, 0)),
            jetScale(lambdaSquared, coefficient(coefficients, 1)),
            ...[2, 3, 4, 5].map((index, offset) =>
                jetScale(powers[offset + 1], coefficient(coefficients, index))),
        ));
    },
    2(coefficients, lambda) {
        return realIndexJetFromSquare(resonanceSum(coefficients, square(lambda), 3));
    },
    3: herzbergerJet,
    4(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        const secondPole = coefficient(coefficients, 4) ** 2;
        return realIndexJetFromSquare(sum(
            constant(1 + coefficient(coefficients, 0)),
            resonanceTermJet(coefficient(coefficients, 1), lambdaSquared, coefficient(coefficients, 2) ** 2),
            poleTermJet(coefficient(coefficients, 3), jetSubtract(lambdaSquared, constant(secondPole))),
        ));
    },
    5(coefficients, lambda) {
        return realIndexJet(sum(
            constant(coefficient(coefficients, 0)),
            jetScale(reciprocal(lambda), coefficient(coefficients, 1)),
            jetScale(jetPower(lambda, -3.5), coefficient(coefficients, 2)),
        ));
    },
    6(coefficients, lambda) {
        return realIndexJetFromSquare(resonanceSum(coefficients, square(lambda), 4));
    },
    7(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        return realIndexJetFromSquare(sum(
            constant(coefficient(coefficients, 0)),
            poleTermJet(coefficient(coefficients, 1),
                jetSubtract(lambdaSquared, constant(coefficient(coefficients, 2)))),
            jetScale(lambdaSquared, -coefficient(coefficients, 3)),
        ));
    },
    8(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        return realIndexJetFromSquare(sum(
            constant(coefficient(coefficients, 0)),
            resonanceTermJet(coefficient(coefficients, 1), lambdaSquared, coefficient(coefficients, 2)),
            jetScale(lambdaSquared, -coefficient(coefficients, 3)),
        ));
    },
    9(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        return realIndexJetFromSquare(sum(
            constant(coefficient(coefficients, 0)),
            resonanceTermJet(coefficient(coefficients, 1), lambdaSquared, coefficient(coefficients, 2)),
            resonanceTermJet(coefficient(coefficients, 3), lambdaSquared, coefficient(coefficients, 4)),
        ));
    },
    10(coefficients, lambda) {
        const { lambdaSquared, powers } = inverseEvenPowers(lambda, 6);
        return realIndexJetFromSquare(sum(
            constant(coefficient(coefficients, 0)),
            jetScale(lambdaSquared, coefficient(coefficients, 1)),
            ...[2, 3, 4, 5, 6, 7].map((index, offset) =>
                jetScale(powers[offset + 1], coefficient(coefficients, index))),
        ));
    },
    11(coefficients, lambda) {
        return realIndexJetFromSquare(resonanceSum(coefficients, square(lambda), 5));
    },
    12(coefficients, lambda) {
        const { lambdaSquared, powers } = inverseEvenPowers(lambda, 4);
        const lambdaFourth = square(lambdaSquared);
        return realIndexJetFromSquare(sum(
            constant(coefficient(coefficients, 0)),
            jetScale(lambdaSquared, coefficient(coefficients, 1)),
            ...[2, 3, 4, 5].map((index, offset) =>
                jetScale(powers[offset + 1], coefficient(coefficients, index))),
            jetScale(lambdaFourth, coefficient(coefficients, 6)),
            jetScale(jetMultiply(lambdaFourth, lambdaSquared), coefficient(coefficients, 7)),
        ));
    },
    13(coefficients, lambda) {
        const { lambdaSquared, powers } = inverseEvenPowers(lambda, 6);
        return realIndexJetFromSquare(sum(
            constant(coefficient(coefficients, 0)),
            jetScale(lambdaSquared, coefficient(coefficients, 1)),
            jetScale(square(lambdaSquared), coefficient(coefficients, 2)),
            ...[3, 4, 5, 6, 7, 8].map((index, offset) =>
                jetScale(powers[offset + 1], coefficient(coefficients, index))),
        ));
    },
    101(coefficients, lambda) {
        const lambdaSquared = square(lambda);
        let nSquared = constant(coefficient(coefficients, 0));
        for (let index = 1; index + 1 < coefficients.length; index += 2) {
            nSquared = jetAdd(nSquared,
                resonanceTermJet(coefficients[index], lambdaSquared, coefficients[index + 1]));
        }
        return realIndexJetFromSquare(nSquared);
    },
    102(coefficients, lambda) {
        // Cauchy series with one coefficient per term, as many as the material carries.
        const terms = Math.max(coefficients.length, 1);
        const { powers } = inverseEvenPowers(lambda, Math.max(1, terms - 1));
        return realIndexJet(sum(
            constant(coefficient(coefficients, 0)),
            ...Array.from({ length: terms - 1 }, (_, offset) =>
                jetScale(powers[offset + 1], coefficient(coefficients, offset + 1))),
        ));
    },
    103(coefficients, lambda) {
        const { lambdaSquared, powers } = inverseEvenPowers(lambda, 4);
        return realIndexJetFromSquare(sum(
            constant(coefficient(coefficients, 0)),
            jetScale(lambdaSquared, coefficient(coefficients, 1)),
            ...[2, 3, 4, 5].map((index, offset) =>
                jetScale(powers[offset + 1], coefficient(coefficients, index))),
            jetScale(square(lambdaSquared), coefficient(coefficients, 6)),
        ));
    },
    104(coefficients, lambda) {
        return realIndexJet(jetAdd(
            constant(coefficient(coefficients, 0)),
            poleTermJet(coefficient(coefficients, 1),
                jetSubtract(constant(coefficient(coefficients, 2)), lambda)),
        ));
    },
    105(coefficients, lambda) {
        const strength = coefficient(coefficients, 1);
        const distance = jetSubtract(constant(coefficient(coefficients, 2)), lambda);
        return realIndexJet(jetAdd(
            constant(coefficient(coefficients, 0)),
            strength ? jetScale(jetPower(distance, -1.2), strength) : constant(0),
        ));
    },
    106(coefficients, lambda) {
        return realIndexJetFromSquare(jetSubtract(
            constant(coefficient(coefficients, 0)),
            jetScale(square(lambda), coefficient(coefficients, 1)),
        ));
    },
    ...riiEvaluators,
};

export function evalNJet(formulaNumber, coefficients, wavelengthMicrometersJet) {
    const evaluator = evaluators[formulaNumber];
    if (!evaluator) return null;
    return evaluator(coefficients || [], wavelengthMicrometersJet);
}
