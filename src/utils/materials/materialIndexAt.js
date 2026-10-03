/**
 * A material's refractive index at one wavelength, for calculations that need
 * it there and have no result without it: a quarter wave, a monitor signal, an
 * offset in optical units.
 *
 * A material can have no index at a wavelength: past a pole of its dispersion
 * formula, where the formula's n² is negative, or where a form that gives n
 * directly reaches 0. Such a calculation reports the material and the
 * wavelength rather than compute with a stand-in index, which would give a
 * plausible result for a layer that is not there.
 */

/** Raised when a calculation needs an index at a wavelength where the material has none. */
export class MaterialHasNoIndexError extends Error {
    constructor(materialId, lambdaNm) {
        super(`Material ${materialId} has no refractive index at ${lambdaNm} nm`);
        this.name = 'MaterialHasNoIndexError';
        this.code = 'MATERIAL_HAS_NO_INDEX';
        this.materialId = materialId;
        this.lambdaNm = lambdaNm;
    }
}

/** Whether `material` has a real, positive n at `lambdaNm`. */
export function hasIndexAt(material, lambdaNm) {
    const n = material.getNK(lambdaNm)[0];
    return Number.isFinite(n) && n > 0;
}

/** n of `material` at `lambdaNm`; MaterialHasNoIndexError naming `materialId` where it has none. */
export function indexAt(material, lambdaNm, materialId) {
    const n = material.getNK(lambdaNm)[0];
    if (Number.isFinite(n) && n > 0) return n;
    throw new MaterialHasNoIndexError(materialId, lambdaNm);
}
