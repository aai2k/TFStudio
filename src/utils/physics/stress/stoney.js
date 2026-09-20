/**
 * What the film force does to the substrate: curvature, deflection, the stress
 * left in the substrate itself, and the shear that peaks at the edge of the
 * coating.
 *
 * SI throughout: force per unit width in N/m, lengths in m, stress in Pa,
 * curvature in 1/m. A substrate here is the SI bundle
 * `{ biaxialPa, youngsPa, poissonsRatio, thicknessM }`, and a film is
 * `{ stressPa, thicknessM, youngsPa, poissonsRatio }`; `filmStress.js` reads
 * those out of a material record.
 *
 * The substrate is taken as a circular disc of uniform thickness, thick enough
 * to dominate the coating. Klein 2000 gives the price of that assumption: the
 * true stress over the Stoney stress is (1 + γδ³)/(1 + δ) with γ = E'_c/E'_s
 * and δ = t_c/t_s (Eq. 12, 14), which for a coating a tenth of the substrate
 * or thinner moves the answer by less than the constants are known to, so the
 * correction is not applied.
 *
 * Sources:
 *   E. Suhir, J. Appl. Phys. 88, 2363 (2000)
 *   C. A. Klein, J. Appl. Phys. 88, 5487 (2000)
 *   C. A. Klein, Opt. Eng. 40, 1115 (2001)
 */

/**
 * Curvature of the coated substrate, K = 6F/(E'_s t_s²), 1/m
 * (Klein 2001 Eq. 26; Klein 2000 Eq. 2, 3).
 *
 * Positive for a tensile film force, which bends the coated face concave.
 */
export function curvaturePerM(filmForceNm, substrate) {
    const { biaxialPa, thicknessM } = substrate;
    if (!(biaxialPa > 0) || !(thicknessM > 0)) return null;
    return 6 * filmForceNm / (biaxialPa * thicknessM * thicknessM);
}

/**
 * Radius of curvature as Essential Macleod prints it, R = −1/K, m: positive
 * where the coated face is convex, which is what a compressive coating makes.
 * A flat substrate has no radius.
 */
export function radiusM(curvature) {
    return curvature ? -1 / curvature : null;
}

/**
 * Deflection of the centre of the disc relative to its rim, m, positive where
 * the coated face is convex, which is the sign R carries (Klein 2001 Eq. 27,
 * 28, 33; Suhir 2000 Eq. 42-45, whose finite-size bracket is 1 once k r₀ ≫ 1,
 * so the edge does not move the bow).
 *
 *     ω₀ = −(1 − cos K r₀)/K,  which for a small curvature is −r₀² K/2
 *
 * Klein prints Eq. (27) without that minus sign and Eq. (28) with it, and the
 * two disagree; Eq. (28) states the convention in words, "the minus sign
 * pointing to a displacement in the opposite direction of the radius of
 * curvature", and Eq. (33) agrees with it, so Eq. (27) is the odd one out.
 *
 * Written through the half-angle identity, which keeps it accurate at the
 * small curvatures a real part has.
 */
export function centreDeflectionM(curvature, substrateRadiusM) {
    if (curvature == null || !(substrateRadiusM > 0)) return null;
    if (curvature === 0) return 0;
    return -2 * Math.sin(curvature * substrateRadiusM / 2) ** 2 / curvature;
}

/**
 * Stress in the substrate at height z above its uncoated face, Pa
 * (Klein 2001 Eq. 4): σ_s(z) = 6 (t_s/3 − z) F / t_s².
 */
export function substrateStressPa(filmForceNm, substrate, heightM) {
    const { thicknessM } = substrate;
    if (!(thicknessM > 0)) return null;
    return 6 * (thicknessM / 3 - heightM) * filmForceNm / (thicknessM * thicknessM);
}

/**
 * Stress in the substrate immediately under the coating, −4F/t_s, Pa
 * (Klein 2001 Eq. 5). It is the largest stress the substrate carries and it
 * opposes the film.
 */
export function interfaceSubstrateStressPa(filmForceNm, substrate) {
    return substrateStressPa(filmForceNm, substrate, substrate.thicknessM);
}

/**
 * The interfacial shear parameter k, 1/m (Klein 2001 Eq. 8; Suhir 2000 Eq. 13
 * and 56 to 59):
 *
 *     k = [ (3/2) E_s / ((1 + ν_s) t_s) / Σ_l E_l d_l/(1 − ν_l²) ]^{1/2}
 *
 * Its reciprocal is the width of the strip at the edge of the coating over
 * which the shear is carried; the sum runs over every film.
 */
export function shearParameterPerM(films, substrate) {
    const { youngsPa, poissonsRatio, thicknessM } = substrate;
    if (!(youngsPa > 0) || !(thicknessM > 0)) return null;
    const compliance = films.reduce(
        (sum, film) => sum + film.youngsPa * film.thicknessM / (1 - film.poissonsRatio ** 2), 0);
    if (!(compliance > 0)) return null;
    return Math.sqrt(1.5 * youngsPa / ((1 + poissonsRatio) * thicknessM) / compliance);
}

/**
 * Peak shear at the edge of an interface, τ_max = k |F_i|, Pa (Klein 2001
 * Eq. 25; Suhir 2000 Eq. 26, 27). Under a uniform biaxial stress the shear is
 * zero everywhere inside the coating and rises only at its edge, so this is
 * where a coating lets go.
 */
export function edgeShearPa(shearParameter, interfaceForceNm) {
    return shearParameter == null ? null : shearParameter * Math.abs(interfaceForceNm);
}
