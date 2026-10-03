/**
 * Merit rows that read transmittance or reflectance on a logarithmic scale.
 *
 * In decibels, L = 10·log₁₀C, a loss reading negative (Macleod, Thin-Film
 * Optical Filters 5th ed., §8.2.1). As optical density, D = −log₁₀T, for
 * transmittance only (Ch. 5, Neutral-Density Filters). The target of such a row
 * is in the same unit as its value.
 *
 * Each type names the channel it reads and, for a band row, which end of its
 * own scale it takes: the lowest density over a band is where T is highest, so
 * neither the first letter of the type nor the end of the T scale says what
 * ODMN looks for.
 *
 * A leaf: the operand model imports it, so it may import nothing back.
 */

const LN10 = Math.log(10);

// unit → value = sign·scale·log₁₀C, and the residual scale σ the merit function
// divides the row's miss by. σ = scale/ln 10 makes a row score sign·ln(C/C_target):
// for a small miss that is the relative miss in C, the number a T row gives near
// T = 1, and a miss by a given ratio scores the same at any level.
const LOG_UNITS = {
    dB: { scale: 10, sign: 1, sigma: 10 / LN10 },
    OD: { scale: 1, sign: -1, sigma: 1 / LN10 },
};

// TDB is T in dB at one wavelength. The others are the extremum over a band,
// held on one side of the target as TMN and TMX are: `extremum` is the end of
// the row's own scale it takes, 'min' holding the value at or above the target
// and 'max' at or below it.
const LOG_OPERANDS = {
    TDB:   { channel: 'T', unit: 'dB' },
    TDBMN: { channel: 'T', unit: 'dB', extremum: 'min' },
    TDBMX: { channel: 'T', unit: 'dB', extremum: 'max' },
    RDBMX: { channel: 'R', unit: 'dB', extremum: 'max' },
    ODMN:  { channel: 'T', unit: 'OD', extremum: 'min' },
};

export const LOG_OPERAND_TYPES = Object.keys(LOG_OPERANDS);
export const LOG_MINMAX_OPERAND_TYPES = LOG_OPERAND_TYPES.filter(type => LOG_OPERANDS[type].extremum);

/**
 * T or R below this reads as it, −150 dB or a density of 15. Below it a
 * computed T or R can be rounding error rather than light: past the critical
 * angle, where T is zero, the transfer-matrix arithmetic leaves about 1e-17
 * (Al2O3 onto MgF2 at 75°, tests/db_od_operands.mjs), and read in dB that
 * residue and its derivative would steer the optimizer. The floor also gives
 * a T or R that is exactly zero a reading, which the logarithm does not. No
 * blocking or return-loss specification comes near 150 dB, so it changes no
 * reading a specification is written against; below it the row is flat.
 */
export const LOG_READING_FLOOR = 1e-15;

/** The channel, unit and band end of a logarithmic type, or null. */
export function logOperand(type) {
    return LOG_OPERANDS[type] || null;
}

export function isLogOperand(type) { return !!LOG_OPERANDS[type]; }

/** The single-wavelength logarithmic row: TDB. */
export function isLogPoint(type) { return !!LOG_OPERANDS[type] && !LOG_OPERANDS[type].extremum; }

/** The unit a logarithmic type reads in, 'dB' or 'OD', or null. */
export function logUnit(type) { return LOG_OPERANDS[type]?.unit ?? null; }

/** A fraction C (T or R, 0-1) read in `unit`. */
export function logValue(unit, fraction) {
    const { scale, sign } = LOG_UNITS[unit];
    return sign * scale * Math.log10(Math.max(fraction, LOG_READING_FLOOR));
}

/** The fraction a reading in `unit` stands for. */
export function fractionFromLog(unit, value) {
    const { scale, sign } = LOG_UNITS[unit];
    return 10 ** (value / (sign * scale));
}

/** The residual scale σ of a row reading in `unit`. */
export function logSigma(unit) { return LOG_UNITS[unit].sigma; }

/**
 * ∂value/∂C divided by σ, at the fraction C: sign/C, so a Jacobian row is the
 * channel's own derivative times this. Zero below the floor, where the value
 * does not move.
 */
export function logSlopeOverSigma(unit, fraction) {
    return fraction > LOG_READING_FLOOR ? LOG_UNITS[unit].sign / fraction : 0;
}

/**
 * A row's value at the fraction C it reads: C itself for a linear row (σ = 1),
 * its dB or density for a logarithmic one. `slopeOverSigma` is ∂value/∂C ÷ σ.
 */
export function rowReading(type, fraction) {
    const unit = LOG_OPERANDS[type]?.unit;
    return unit ? logValue(unit, fraction) : fraction;
}
export function rowReadingSlopeOverSigma(type, fraction) {
    const unit = LOG_OPERANDS[type]?.unit;
    return unit ? logSlopeOverSigma(unit, fraction) : 1;
}
