/**
 * A ray at a horizontal interface: below the critical angle it refracts by
 * Snell's law, above it it is totally reflected.
 *
 * A ray above the critical angle at both faces of a layer would be trapped for
 * good. After FTIR_AFTER reflections in a row it escapes by frustrated total
 * internal reflection instead, leaving at a grazing angle, since past the
 * critical angle there is no refracted angle to compute.
 */

const FTIR_AFTER = 3;
const FTIR_SIN = 0.93;

/**
 * @param {number} n1     index the ray is leaving
 * @param {number} n2     index it is entering
 * @param {number} sin1   sine of the angle to the normal, 0 is head on
 * @param {number} tirRun total internal reflections in a row so far
 * @returns {{kind: 'transmit'|'tir'|'ftir', sin2: number}}
 */
export function refractStep(n1, n2, sin1, tirRun) {
    const sin2 = (n1 / n2) * sin1;
    if (sin2 < 1) return { kind: 'transmit', sin2 };
    if (tirRun + 1 >= FTIR_AFTER) return { kind: 'ftir', sin2: FTIR_SIN };
    return { kind: 'tir', sin2: sin1 };
}
