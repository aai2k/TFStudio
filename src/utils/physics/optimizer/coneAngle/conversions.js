/**
 * f-number / NA / half-angle conversions.
 *
 * NA = n0 · sin(Θ);  f/# = 1 / (2·NA)  ⇒  Θ = asin( 1 / (2·n0·f/#) ).
 * These are the standard image-space (paraxial) conventions; n0 = incident
 * medium index (1 in air). All three are interchangeable inputs.
 */

import { DEG, RAD } from './constants.js';

export function naFromHalfAngle(halfAngleDeg, n0 = 1) {
    return n0 * Math.sin(halfAngleDeg * DEG);
}
export function halfAngleFromNA(NA, n0 = 1) {
    const s = Math.max(-1, Math.min(1, NA / n0));
    return Math.asin(s) * RAD;
}
export function naFromFNumber(fNumber) {
    return fNumber > 0 ? 1 / (2 * fNumber) : 0;
}
export function fNumberFromNA(NA) {
    return NA > 0 ? 1 / (2 * NA) : Infinity;
}
export function halfAngleFromFNumber(fNumber, n0 = 1) {
    return halfAngleFromNA(naFromFNumber(fNumber), n0);
}
export function fNumberFromHalfAngle(halfAngleDeg, n0 = 1) {
    return fNumberFromNA(naFromHalfAngle(halfAngleDeg, n0));
}
