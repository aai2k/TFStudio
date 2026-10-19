import { designMaterialLookup } from '../../../utils/materials/designMaterials.js';
import { deviatedDesignForSpec } from '../../../utils/physics/systematicDeviations.js';
import { buildSpecificationInputs } from './inhomogeneities/model.js';

/**
 * The design a tolerance window judges its Specification on, and the material
 * resolver to judge it with: `design` as it stands, with a systematic
 * `deviation` applied (Systematic Deviations), or with `interlayers` inserted
 * (Inhomogeneities). The window and the analysis worker both build it here
 * from the same plain recipe, so the badge reads one number on either thread.
 *
 * Returns { design, resolve }.
 */
export function toleranceSpecInputs(design, { deviation, interlayers } = {}) {
    if (deviation) return deviatedDesignForSpec(design, deviation, designMaterialLookup(design));
    if (interlayers) {
        const { specDesign, resolve } = buildSpecificationInputs(design, interlayers);
        return { design: specDesign, resolve };
    }
    return { design, resolve: designMaterialLookup(design) };
}
