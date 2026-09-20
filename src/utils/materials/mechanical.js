/**
 * Thermo-mechanical constants a material can carry beside its dispersion.
 *
 * They are the inputs of the film stress model: Young's modulus, Poisson's
 * ratio and the expansion coefficient turn a temperature change into a biaxial
 * stress, the intrinsic stress and its reference temperature say what the film
 * arrived with, and the surface energy is what a crack or a delamination has to
 * pay for. dn/dT is kept with them because the temperature model of the index
 * reads it beside the expansion coefficient (H. Takahashi, Appl. Opt. 34, 667,
 * 1995). Every field is optional and independent of the others: a material
 * whose stress was measured but whose modulus is unknown carries the stress
 * alone. A material with no known value has no `mechanical` block at all.
 *
 * Units are part of the field names and never change:
 *   youngsModulusGPa       E, GPa
 *   poissonsRatio          ν, dimensionless
 *   linearExpansionPerK    α, 1/K
 *   dnDtPerK               dn/dT, 1/K
 *   intrinsicStressMPa     film stress at the reference temperature, MPa,
 *                          tensile positive
 *   referenceTemperatureC  the deposition temperature that stress refers to, °C
 *   surfaceEnergyJm2       γ, J/m² (1 J/m² = 1000 erg/cm²)
 *
 * The two temperature coefficients are the one place where what is stored and
 * what is shown differ: catalogs quote them in ppm/K, so the editor does too.
 * MECHANICAL_UNITS gives the shown unit and mechanicalToDisplay converts.
 */

export const MECHANICAL_FIELDS = [
    'youngsModulusGPa',
    'poissonsRatio',
    'linearExpansionPerK',
    'dnDtPerK',
    'intrinsicStressMPa',
    'referenceTemperatureC',
    'surfaceEnergyJm2',
];

/** Unit shown beside each field. Symbols, not localized. */
export const MECHANICAL_UNITS = {
    youngsModulusGPa: 'GPa',
    poissonsRatio: '',
    linearExpansionPerK: 'ppm/K',
    dnDtPerK: 'ppm/K',
    intrinsicStressMPa: 'MPa',
    referenceTemperatureC: '°C',
    surfaceEnergyJm2: 'J/m²',
};

// Stored value times this is the number shown in MECHANICAL_UNITS. Only the
// two temperature coefficients need one: Essential Macleod's Properties tab,
// the AGF ED line and the glass catalogs all quote them in ppm/K, and a form
// that took 7.1e-6 where every datasheet prints 7.1 would be misread.
const DISPLAY_SCALE = { linearExpansionPerK: 1e6, dnDtPerK: 1e6 };

/** The stored value as the editor shows it, in MECHANICAL_UNITS[field]. */
export function mechanicalToDisplay(field, value) {
    const scale = DISPLAY_SCALE[field];
    // Twelve digits is past any measured constant and short of the last-bit
    // noise the scaling leaves, which would show 7.1 ppm/K as 7.100000000000001.
    return scale ? Number((value * scale).toPrecision(12)) : value;
}

/** A number typed in MECHANICAL_UNITS[field], as the record stores it. */
export function mechanicalFromDisplay(field, value) {
    return DISPLAY_SCALE[field] ? value / DISPLAY_SCALE[field] : value;
}

/**
 * The block reduced to its finite numbers, or undefined when it holds none, so
 * a record never carries an empty block or a NaN.
 */
export function normalizeMechanical(block) {
    if (!block || typeof block !== 'object') return undefined;
    const out = {};
    for (const field of MECHANICAL_FIELDS) {
        const value = block[field];
        if (typeof value === 'number' && Number.isFinite(value)) out[field] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

// A modulus is positive by definition. Poisson's ratio of a stable isotropic
// solid lies between -1 and 0.5, the thermodynamic bounds; auxetic materials
// sit below zero and are allowed. A surface energy is an energy per area and
// cannot be negative. Nothing else is bounded: a stress of either sign, an
// expansion coefficient of either sign and any temperature are all physical.
const BOUNDS = [
    ['youngsModulusGPa', value => value > 0, 'positive'],
    ['poissonsRatio', value => value > -1 && value < 0.5, 'poisson'],
    ['surfaceEnergyJm2', value => value >= 0, 'nonNegative'],
];

/**
 * The first physical bound a block breaks, as `{ field, reason }`, or null.
 * `reason` is one of 'positive', 'poisson', 'nonNegative'.
 */
export function mechanicalBoundViolation(block) {
    if (!block) return null;
    for (const [field, holds, reason] of BOUNDS) {
        const value = block[field];
        if (typeof value === 'number' && !holds(value)) return { field, reason };
    }
    return null;
}
