/**
 * What a curve editor column holds and in what unit, and the conversion to
 * what a design stores.
 *
 * A design stores wavelength in nm, T, R and A as a fraction of 1, and Ψ and Δ
 * in degrees. A column's unit says what its typed numbers are: choosing a unit
 * declares them, as the importers' Y scale does, and does not rescale them.
 *
 *   %         percent, 0-100
 *   fraction  0-1
 *   dB        10·log10 C, a loss reading negative (Macleod, Thin-Film Optical
 *             Filters 5th ed., §8.2.1)
 *   OD        optical density, -log10 T, for transmittance only (Ch. 5); the
 *             importers read it as absorbance
 *   deg       degrees, for Ψ and Δ
 *   rel       a relative weight, for an Integral Values source or detector
 *
 * dB and density use the merit function's own readings (logReadings.js), so a
 * value typed here means what the same number means in a dB or OD merit row.
 */
import { fractionFromLog, logValue } from '../../../../utils/physics/optimizer.js';
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';

/** The value quantities each kind of curve offers, the first being the default. */
export const KIND_QUANTITIES = {
    spectrum: ['T', 'R', 'A'],
    ellipsometry: ['PSI', 'DEL'],
    weight: ['W'],
};

/** The wavelength units, the ones the two importers read. */
export const X_UNIT_IDS = [X_UNITS.NM, X_UNITS.UM, X_UNITS.CM1, X_UNITS.EV];

const QUANTITY_UNITS = {
    T: ['%', 'fraction', 'dB', 'OD'],
    R: ['%', 'fraction', 'dB'],
    A: ['%', 'fraction', 'dB'],
    PSI: ['deg'],
    DEL: ['deg'],
    W: ['rel'],
};

/** The units a quantity can be typed in, the first being the default. */
export function unitsFor(quantity) {
    return QUANTITY_UNITS[quantity] || [];
}

/** The unit a column keeps when its quantity changes: its own if allowed. */
export function unitForQuantity(quantity, unit) {
    const units = unitsFor(quantity);
    return units.includes(unit) ? unit : units[0];
}

const identity = value => value;

const TO_STORED = {
    '%': value => value / 100,
    fraction: identity,
    dB: value => fractionFromLog('dB', value),
    OD: value => fractionFromLog('OD', value),
    deg: identity,
    rel: identity,
};

const FROM_STORED = {
    '%': value => value * 100,
    fraction: identity,
    dB: value => logValue('dB', value),
    OD: value => logValue('OD', value),
    deg: identity,
    rel: identity,
};

/** A typed value as the design stores it. */
export function toStored(value, unit) {
    return Number.isFinite(value) ? (TO_STORED[unit] || identity)(value) : NaN;
}

/** A stored value in a column's unit. */
export function fromStored(value, unit) {
    return Number.isFinite(value) ? (FROM_STORED[unit] || identity)(value) : NaN;
}

const PHOTOMETRIC = new Set(['T', 'R', 'A']);

/**
 * Why a typed value lies outside its quantity's physical range, or null.
 * T, R and A cannot leave 0-100 %, and Ψ, an arctangent of a ratio of
 * magnitudes, cannot leave 0-90°. Δ is an angle and has no range to leave.
 *   'above'  T, R or A above 100 %
 *   'below'  T, R or A below 0
 *   'psi'    Ψ outside 0-90°
 */
export function valueProblem(quantity, unit, value) {
    if (!Number.isFinite(value)) return null;
    if (PHOTOMETRIC.has(quantity)) {
        const fraction = toStored(value, unit);
        if (fraction > 1) return 'above';
        return fraction < 0 ? 'below' : null;
    }
    return quantity === 'PSI' && (value < 0 || value > 90) ? 'psi' : null;
}

/** A wavelength, wavenumber or photon energy at or below zero has no light. */
export function xProblem(value) {
    return Number.isFinite(value) && value <= 0 ? 'x' : null;
}
