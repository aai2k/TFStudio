/**
 * Stress in one film, and the forces a stack of them carries.
 *
 * Everything here is SI: stress in Pa, thickness in m, temperature in °C,
 * expansion per K. The material record states GPa and MPa because those are
 * the units a datasheet prints, so the readers at the top of this file are the
 * one place the two meet.
 *
 * Sign convention: tensile stress is positive throughout, as in every paper
 * cited here. A film that wants to be larger than the substrate it is stuck to
 * is in compression.
 *
 * The temperature bookkeeping follows the Essential Macleod manual, pp. 231 to
 * 234, which is the only source that states it. A film condenses strain free
 * at its own deposition temperature, then takes the substrate's temperature
 * without changing its lateral size, which is the intrinsic strain; the
 * reference stress is that stress for a film deposited at the reference
 * temperature. From there to the evaluation temperature the film follows the
 * substrate and the expansion mismatch adds to the strain:
 *
 *     σ = σ_ref + E' [ α_f (T_ref − T_dep) + (α_s − α_f) (T − T_dep) ],  E' = E/(1 − ν)
 *
 * so σ = σ_ref when the three temperatures are equal, and the last term is
 * Suhir 2000 Eq. (28) with his Δt = T_dep − T, the same quantity Klein 2001
 * writes as Eq. (2) and (3).
 *
 * Sources:
 *   E. Suhir, J. Appl. Phys. 88, 2363 (2000)
 *   C. A. Klein, Opt. Eng. 40, 1115 (2001)
 */

const GPA = 1e9;
const MPA = 1e6;

const stated = value => typeof value === 'number' && Number.isFinite(value);

/** Young's modulus in Pa, or null where the material does not state one. */
export function youngsModulusPa(mechanical) {
    return stated(mechanical?.youngsModulusGPa) ? mechanical.youngsModulusGPa * GPA : null;
}

/**
 * Biaxial modulus E/(1 − ν) in Pa, the stiffness a film stretched equally in
 * both directions in its own plane shows, or null where either constant is
 * missing.
 */
export function biaxialModulusPa(mechanical) {
    const youngs = youngsModulusPa(mechanical);
    if (youngs === null || !stated(mechanical.poissonsRatio)) return null;
    return youngs / (1 - mechanical.poissonsRatio);
}

/**
 * Biaxial stress in a film, Pa, tensile positive, or null where the material
 * states nothing to build one from.
 *
 * What each part needs:
 *   the intrinsic stress alone     intrinsicStressMPa
 *   the deposition correction      the elastic constants, α_f and referenceTemperatureC
 *   the expansion mismatch         the elastic constants, α_f, the substrate's α and T
 *
 * A material that states no reference temperature is read as one whose stress
 * was measured at the deposition temperature of this run, which is what a
 * reference stress with no temperature beside it means. A material that states
 * no intrinsic stress contributes only what the temperatures make, which is
 * the caller's cue to say so: `missingStressFields` names what is absent.
 *
 * @param {Object} mechanical  the material's `mechanical` block
 * @param {Object} run         { substrateExpansionPerK, temperatureC, depositionTemperatureC }
 * @returns {number|null} stress in Pa
 */
export function filmStressPa(mechanical, run) {
    const intrinsicPa = stated(mechanical?.intrinsicStressMPa) ? mechanical.intrinsicStressMPa * MPA : null;
    const biaxialPa = biaxialModulusPa(mechanical);
    const expansion = stated(mechanical?.linearExpansionPerK) ? mechanical.linearExpansionPerK : null;
    const deposition = stated(run?.depositionTemperatureC) ? run.depositionTemperatureC : null;
    if (biaxialPa === null || expansion === null || deposition === null) return intrinsicPa;

    const reference = stated(mechanical.referenceTemperatureC) ? mechanical.referenceTemperatureC : deposition;
    let stressPa = (intrinsicPa ?? 0) + biaxialPa * expansion * (reference - deposition);
    if (stated(run.substrateExpansionPerK) && stated(run.temperatureC)) {
        stressPa += biaxialPa * (run.substrateExpansionPerK - expansion) * (run.temperatureC - deposition);
    }
    return stressPa;
}

// Every constant the full expression above reads off the material. The
// substrate's expansion coefficient is not here: it belongs to another
// material and the caller reports it against that one.
const STRESS_FIELDS = [
    'youngsModulusGPa',
    'poissonsRatio',
    'linearExpansionPerK',
    'intrinsicStressMPa',
    'referenceTemperatureC',
];

/**
 * The constants the full stress needs that this material does not state, so a
 * caller can name them rather than substitute for them.
 */
export function missingStressFields(mechanical) {
    return STRESS_FIELDS.filter(field => !stated(mechanical?.[field]));
}

// ── Forces ────────────────────────────────────────────────────────────────────
//
// A film of stress σ and thickness d pulls on what it is stuck to with σd per
// unit width. Films are listed from the substrate outwards, entry 0 first, the
// order the rest of the app numbers layers in.

/** Film force per unit width, F = Σ σ_l d_l, N/m (Klein 2001 Eq. 14). */
export function filmForceNm(films) {
    return films.reduce((sum, film) => sum + film.stressPa * film.thicknessM, 0);
}

/**
 * The force carried across the interface below each film, the sum over the
 * films outside it (Klein 2001 Eq. 21, 22). Entry 0 is the substrate interface
 * and carries the whole film force; the outermost entry carries its own film
 * alone.
 */
export function interfaceForcesNm(films) {
    const forces = new Array(films.length).fill(0);
    let outward = 0;
    for (let i = films.length - 1; i >= 0; i--) {
        outward += films[i].stressPa * films[i].thicknessM;
        forces[i] = outward;
    }
    return forces;
}
