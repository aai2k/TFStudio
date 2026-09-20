/**
 * The energy stored in a stressed film, and the thickness at which it is
 * enough to break the film.
 *
 * SI throughout: stress in Pa, thickness in m, energy per unit area in J/m².
 * One erg/cm², the unit the older literature prints surface energies in, is
 * 1e-3 J/m². A film here is the SI bundle
 * `{ stressPa, thicknessM, youngsPa, poissonsRatio, surfaceEnergyJm2 }`.
 *
 * Source: E. Klokholm, IBM J. Res. Dev. 31, 585 (1987).
 */

/**
 * Strain energy per unit area of one film, U = S² δ (1 − ν)/E, J/m²
 * (Klokholm 1987 Eq. 1), or null where the modulus is unknown.
 *
 * Energy, so the sign of the stress does not reach it: a compressive film
 * stores as much as a tensile one of the same magnitude.
 */
export function strainEnergyJm2(film) {
    const { stressPa, thicknessM, youngsPa, poissonsRatio } = film;
    if (!(youngsPa > 0) || !Number.isFinite(stressPa) || !Number.isFinite(poissonsRatio)) return null;
    return stressPa * stressPa * thicknessM * (1 - poissonsRatio) / youngsPa;
}

/** The stack's strain energy, the plain sum over the films that have one. */
export function totalStrainEnergyJm2(films) {
    return films.reduce((sum, film) => {
        const energy = strainEnergyJm2(film);
        return energy === null ? sum : sum + energy;
    }, 0);
}

/**
 * Essential Macleod's cracking parameter, Σ_l U_l / (2 γ_l), dimensionless.
 *
 * Klokholm's criterion is U ≥ 2γ for one film (Eq. 6); Macleod reports the
 * stack as the sum of each film's energy against its own crack cost, so a
 * value of 1 means the stack as a whole has the energy to crack. Which of the
 * readings of "the stack" it used is not in the manual and was settled against
 * the program on 2026-09-20; see `tests/stress_analysis.mjs`.
 */
export function crackingParameter(films) {
    if (!films.length) return null;
    let total = 0;
    for (const film of films) {
        const energy = strainEnergyJm2(film);
        if (energy === null || !(film.surfaceEnergyJm2 > 0)) return null;
        total += energy / (2 * film.surfaceEnergyJm2);
    }
    return total;
}

/**
 * Essential Macleod's delamination factor at the interface on the substrate
 * side of each film, dimensionless, one entry per film in the same order.
 *
 * The strain energy of that film and everything outside it, which is what
 * would be released if the stack let go there, against the surface energy of
 * the two materials the interface separates (Klokholm Eq. 2, γ_a = γ_s + γ_f,
 * the perfect-adhesion case). Entry 0 is the substrate interface. A value of 1
 * means there is the energy to delaminate.
 */
export function delaminationFactors(films, substrateSurfaceEnergyJm2) {
    const energies = films.map(strainEnergyJm2);
    return films.map((film, index) => {
        const inner = index === 0 ? substrateSurfaceEnergyJm2 : films[index - 1].surfaceEnergyJm2;
        // Both materials have to state one. Adding an unstated energy would
        // read it as zero and report a factor against half an interface.
        if (!(film.surfaceEnergyJm2 > 0) || !(inner > 0)) return null;
        const pair = film.surfaceEnergyJm2 + inner;
        let outward = 0;
        for (let layer = index; layer < films.length; layer++) {
            if (energies[layer] === null) return null;
            outward += energies[layer];
        }
        return outward / pair;
    });
}

/**
 * The thickness at which a film of this stress stores enough energy to pay for
 * the two faces of a crack through it, δ_c = 2 γ E / (S² (1 − ν)), m.
 *
 * Griffith with the crack length set to the film thickness: fracture once
 * U ≥ 2γ, the energy of the two new surfaces (Klokholm 1987 Eq. 5a, 6, 6a).
 * A film thinner than this does not crack however high its stress, which is
 * why thin films survive stresses that would break the bulk material.
 *
 * Klokholm drops (1 − ν) in his own worked numbers, so his Table 1 is the
 * ν = 0 case of this expression.
 */
export function crackingThicknessM(film) {
    const { stressPa, youngsPa, poissonsRatio, surfaceEnergyJm2 } = film;
    // `null >= 0` is true, so the surface energy is tested for being a number
    // before being tested for its sign: an unstated one is not a zero one.
    if (!(youngsPa > 0) || !(Number.isFinite(surfaceEnergyJm2) && surfaceEnergyJm2 >= 0)
        || !Number.isFinite(poissonsRatio)) return null;
    if (!stressPa) return null;
    return 2 * surfaceEnergyJm2 * youngsPa / (stressPa * stressPa * (1 - poissonsRatio));
}
