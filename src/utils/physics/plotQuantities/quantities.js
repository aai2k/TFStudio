/**
 * What a Plot Engine curve can put on an axis.
 *
 * Every quantity is read along the curve's sweep, and each is computed by the
 * code of the window it belongs to, so the plot reads the numbers that window
 * shows:
 *
 *   'sweep'                  the swept value itself: λ, AOI, or a layer's d
 *   'T', 'R', 'A'            Optical Evaluation's T, R and A, fractions of 1
 *   'phaseR' ... 'todT'      the GD/GDD window's phase φ (degrees), GD (fs),
 *                            GDD (fs²) and TOD (fs³) of the reflected or
 *                            transmitted light
 *   'psi', 'delta'           the Ellipsometry window's Ψ and Δ, degrees
 *   'MF'                     the Merit Function Editor's MF
 */

export const SWEEP = 'sweep';

export const QUANTITIES = [
    'T', 'R', 'A',
    'phaseR', 'phaseT', 'gdR', 'gdT', 'gddR', 'gddT', 'todR', 'todT',
    'psi', 'delta', 'MF',
];

const PHASE = /^(phase|gd|gdd|tod)([RT])$/;

/**
 * A phase-family quantity's member ('phase', 'gd', 'gdd' or 'tod') and the
 * light it is taken of ('R' or 'T'), or null for any other quantity.
 */
export function phaseMember(quantity) {
    const match = PHASE.exec(quantity || '');
    return match ? { member: match[1], response: match[2] } : null;
}

/** The family that computes a quantity: 'sweep', 'optical', 'phase', 'ellipsometric' or 'merit'. */
export function quantityFamily(quantity) {
    if (quantity === SWEEP) return 'sweep';
    if (quantity === 'MF') return 'merit';
    if (quantity === 'psi' || quantity === 'delta') return 'ellipsometric';
    return phaseMember(quantity) ? 'phase' : 'optical';
}

/**
 * The sides a quantity is read on. Ψ and Δ belong to one surface, as an
 * ellipsometer measures them. A phase of the whole part is the light it
 * transmits, as Pulse Analysis takes it, so a reflected phase is one side's.
 * The merit function and the swept value have no side.
 */
export function quantitySides(quantity) {
    const family = quantityFamily(quantity);
    if (family === 'optical') return ['front', 'back', 'total'];
    if (family === 'ellipsometric') return ['front', 'back'];
    if (family === 'phase') {
        return phaseMember(quantity).response === 'T' ? ['front', 'back', 'total'] : ['front', 'back'];
    }
    return [];
}

/** Whether a quantity is read in one polarization: s, p or their average. */
export function takesPolarization(quantity) {
    const family = quantityFamily(quantity);
    return family === 'optical' || family === 'phase';
}

/** Whether a quantity is a fraction of the incident light, drawn in percent. */
export function isFraction(quantity) {
    return quantityFamily(quantity) === 'optical';
}
