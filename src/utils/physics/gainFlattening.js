/**
 * The filter loss that flattens an amplifier's gain.
 *
 * A passive filter can only take light away, so the flattest output it can
 * give brings every wavelength down to the lowest gain in the band:
 *
 *   T(λ) [dB] = G_min − G(λ)
 *
 * 0 dB where the gain is lowest and negative everywhere else. It is the least
 * loss a passive filter can flatten with; a further loss the same at every
 * wavelength is insertion loss, which a gain-flattening filter states on a
 * line of its own.
 */

/** The flattening loss in dB at each point of a gain in dB. */
export function flatteningLossDb(gainDb) {
    let lowest = Infinity;
    for (const value of gainDb) if (value < lowest) lowest = value;
    return gainDb.map(value => lowest - value);
}
