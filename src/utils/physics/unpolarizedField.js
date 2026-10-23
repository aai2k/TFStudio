/**
 * The field profile every reader of the field shares: the Electric Field
 * window, the EFMX merit row and the report's electric field block sample it
 * alike and read `avg` with one meaning, the mean of the s and p fields.
 *
 * Unpolarized light carries half its irradiance in each polarization, and |E|²
 * is an energy quantity, so its |E|² is the mean of the two, as unpolarized
 * reflectance is ½(Rs + Rp): Macleod, Thin-Film Optical Filters, 5th ed.,
 * ch. 5, Beam Splitters Using Dielectric Layers. The square of the field is
 * what sets the intrinsic damage level: ch. 16.8, Laser Damage, p. 630.
 */

/** Samples per layer of a field profile. */
export const FIELD_SAMPLES_PER_LAYER = 60;

/**
 * The unpolarized profile from the s and p profiles of one stack, sampled at
 * the same depths: the mean taken sample by sample and component by component,
 * so a component read on its own is the mean of that component.
 */
export function unpolarizedProfile(s, p) {
    const mean = key => s[key].map((value, index) => (value + p[key][index]) / 2);
    return {
        ...s,
        e2: mean('e2'),
        e2Tangential: mean('e2Tangential'),
        e2Normal: mean('e2Normal'),
    };
}
