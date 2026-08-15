/**
 * Third-order truncated Taylor arithmetic for complex-valued functions.
 *
 * A jet stores coefficients [f, f', f''/2!, f'''/3!]. Operations use ordinary
 * power-series algebra, so the same code differentiates material formulas and
 * the complex characteristic matrix without finite differences.
 */

export const JET_ORDER = 3;

const zero = () => [0, 0];
const addComplex = (a, b) => [a[0] + b[0], a[1] + b[1]];
const subComplex = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scaleComplex = (a, scalar) => [a[0] * scalar, a[1] * scalar];
const multiplyComplex = (a, b) => [
    a[0] * b[0] - a[1] * b[1],
    a[0] * b[1] + a[1] * b[0],
];
const divideComplex = (a, b) => {
    const denominator = b[0] * b[0] + b[1] * b[1];
    return [
        (a[0] * b[0] + a[1] * b[1]) / denominator,
        (a[1] * b[0] - a[0] * b[1]) / denominator,
    ];
};
const sqrtComplex = (value) => {
    const magnitudeRoot = Math.sqrt(Math.hypot(value[0], value[1]));
    const angle = Math.atan2(value[1], value[0]) / 2;
    return [magnitudeRoot * Math.cos(angle), magnitudeRoot * Math.sin(angle)];
};

export function jetConstant(value, imaginary = 0) {
    return [[value, imaginary], zero(), zero(), zero()];
}

export function jetFromDerivatives(value, first = 0, second = 0, third = 0) {
    const asComplex = item => Array.isArray(item) ? [...item] : [item, 0];
    return [
        asComplex(value),
        asComplex(first),
        scaleComplex(asComplex(second), 1 / 2),
        scaleComplex(asComplex(third), 1 / 6),
    ];
}

export function jetDerivatives(jet) {
    return [jet[0], jet[1], scaleComplex(jet[2], 2), scaleComplex(jet[3], 6)];
}

export function jetAdd(left, right) {
    return left.map((value, index) => addComplex(value, right[index]));
}

export function jetSubtract(left, right) {
    return left.map((value, index) => subComplex(value, right[index]));
}

export function jetScale(jet, scalar) {
    return jet.map(value => scaleComplex(value, scalar));
}

export function jetMultiply(left, right) {
    const result = Array.from({ length: JET_ORDER + 1 }, zero);
    for (let order = 0; order <= JET_ORDER; order++) {
        for (let index = 0; index <= order; index++) {
            result[order] = addComplex(
                result[order],
                multiplyComplex(left[index], right[order - index]),
            );
        }
    }
    return result;
}

export function jetReciprocal(jet) {
    const result = Array.from({ length: JET_ORDER + 1 }, zero);
    result[0] = divideComplex([1, 0], jet[0]);
    for (let order = 1; order <= JET_ORDER; order++) {
        let sum = zero();
        for (let index = 1; index <= order; index++) {
            sum = addComplex(sum, multiplyComplex(jet[index], result[order - index]));
        }
        result[order] = scaleComplex(divideComplex(sum, jet[0]), -1);
    }
    return result;
}

export function jetDivide(numerator, denominator) {
    return jetMultiply(numerator, jetReciprocal(denominator));
}

export function jetSqrt(jet) {
    const result = Array.from({ length: JET_ORDER + 1 }, zero);
    result[0] = sqrtComplex(jet[0]);
    const twiceRoot = scaleComplex(result[0], 2);
    for (let order = 1; order <= JET_ORDER; order++) {
        let known = zero();
        for (let index = 1; index < order; index++) {
            known = addComplex(known, multiplyComplex(result[index], result[order - index]));
        }
        result[order] = divideComplex(subComplex(jet[order], known), twiceRoot);
    }
    return result;
}

export function jetExp(jet) {
    const result = Array.from({ length: JET_ORDER + 1 }, zero);
    const magnitude = Math.exp(jet[0][0]);
    result[0] = [magnitude * Math.cos(jet[0][1]), magnitude * Math.sin(jet[0][1])];
    for (let order = 1; order <= JET_ORDER; order++) {
        let sum = zero();
        for (let index = 1; index <= order; index++) {
            sum = addComplex(
                sum,
                scaleComplex(multiplyComplex(jet[index], result[order - index]), index),
            );
        }
        result[order] = scaleComplex(sum, 1 / order);
    }
    return result;
}

export function jetLog(jet) {
    const result = Array.from({ length: JET_ORDER + 1 }, zero);
    result[0] = [Math.log(Math.hypot(jet[0][0], jet[0][1])), Math.atan2(jet[0][1], jet[0][0])];
    const derivative = [jet[1], scaleComplex(jet[2], 2), scaleComplex(jet[3], 3), zero()];
    const quotient = jetMultiply(derivative, jetReciprocal(jet));
    for (let order = 1; order <= JET_ORDER; order++) {
        result[order] = scaleComplex(quotient[order - 1], 1 / order);
    }
    return result;
}

export function jetPower(jet, exponent) {
    return jetExp(jetScale(jetLog(jet), exponent));
}

export function jetSinCos(jet) {
    const sine = Array.from({ length: JET_ORDER + 1 }, zero);
    const cosine = Array.from({ length: JET_ORDER + 1 }, zero);
    const [real, imaginary] = jet[0];
    sine[0] = [Math.sin(real) * Math.cosh(imaginary), Math.cos(real) * Math.sinh(imaginary)];
    cosine[0] = [Math.cos(real) * Math.cosh(imaginary), -Math.sin(real) * Math.sinh(imaginary)];
    for (let order = 1; order <= JET_ORDER; order++) {
        let sineSum = zero();
        let cosineSum = zero();
        for (let index = 1; index <= order; index++) {
            sineSum = addComplex(
                sineSum,
                scaleComplex(multiplyComplex(jet[index], cosine[order - index]), index),
            );
            cosineSum = addComplex(
                cosineSum,
                scaleComplex(multiplyComplex(jet[index], sine[order - index]), index),
            );
        }
        sine[order] = scaleComplex(sineSum, 1 / order);
        cosine[order] = scaleComplex(cosineSum, -1 / order);
    }
    return { sine, cosine };
}

export const jetSin = jet => jetSinCos(jet).sine;
export const jetCos = jet => jetSinCos(jet).cosine;

/** Compose a scalar function's first three x-derivatives with an x jet. */
export function jetCompose(value, derivatives, xJet) {
    const displacement = xJet.map((coefficient, index) => index === 0 ? zero() : coefficient);
    const first = jetScale(displacement, derivatives[0] ?? 0);
    const second = jetScale(jetMultiply(displacement, displacement), (derivatives[1] ?? 0) / 2);
    const third = jetScale(
        jetMultiply(jetMultiply(displacement, displacement), displacement),
        (derivatives[2] ?? 0) / 6,
    );
    return jetAdd(jetAdd(jetConstant(value), first), jetAdd(second, third));
}

/** Return lambda(omega) in nm as a third-order Taylor jet. */
export function wavelengthOmegaJet(lambdaNm, omegaRadPerFs) {
    return [
        [lambdaNm, 0],
        [-lambdaNm / omegaRadPerFs, 0],
        [lambdaNm / (omegaRadPerFs * omegaRadPerFs), 0],
        [-lambdaNm / (omegaRadPerFs ** 3), 0],
    ];
}

export function jetWithImaginaryPart(realJet, imaginaryJet) {
    return realJet.map((coefficient, index) => [coefficient[0], imaginaryJet[index][0]]);
}

export function jetClampRealMinimum(jet, minimum) {
    return jet[0][0] >= minimum ? jet : jetConstant(minimum);
}

export function jetClampImaginary(jet, limit) {
    if (jet[0][1] > limit) {
        return jet.map((coefficient, index) => [coefficient[0], index === 0 ? limit : 0]);
    }
    if (jet[0][1] < -limit) {
        return jet.map((coefficient, index) => [coefficient[0], index === 0 ? -limit : 0]);
    }
    return jet;
}

export function jetIsFinite(jet) {
    return jet.every(coefficient => coefficient.every(Number.isFinite));
}
