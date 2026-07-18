// Unit/quantity conversions for the spectrum-table parser (see spectrumTable.js).

import { X_UNITS } from './constants.js';

/** Convert one X value in the given unit to nanometers. */
export function xToNm(value, unit) {
    if (!Number.isFinite(value)) return NaN;
    switch (unit) {
        case X_UNITS.UM:  return value * 1000;
        case X_UNITS.CM1: return value > 0 ? 1e7 / value : NaN;   // λ[nm] = 1e7 / ν[cm⁻¹]
        case X_UNITS.NM:
        default:          return value;
    }
}

/** Absorbance → transmittance fraction: T = 10^(−A). */
export function absorbanceToT(a) { return Math.pow(10, -a); }
