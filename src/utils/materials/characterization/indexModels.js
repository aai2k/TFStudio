/**
 * The dispersion models a characterization can be asked for, and the test for
 * the ones that describe a metal.
 */

/**
 * Index models offered. The extinction model follows from the data.
 *
 * There is no separate Drude entry. Drude-Lorentz takes its oscillator count
 * from the measurement and settles on none when the film has no absorption band
 * in range, which is the same four-parameter fit Drude would have given: on
 * aluminium the two agree to the last digit. On a metal that does absorb in
 * range, Drude cannot follow it and does not say so, which made it a trap
 * rather than a choice.
 */
export const INDEX_MODELS = ['cauchy', 'sellmeier', 'drude-lorentz'];

/** Whether a model describes a metal, and so is fitted as a complex dispersion. */
export function isMetalModel(indexModel) {
    return indexModel === 'drude' || indexModel === 'drude-lorentz';
}
