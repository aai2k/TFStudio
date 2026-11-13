import { designMaterialLookup } from '../../../utils/materials/designMaterials.js';
import { deviatedDesignForSpec } from '../../../utils/physics/systematicDeviations.js';
import { BASE_ENVIRONMENT, environmentDesign } from '../../../utils/environments/environments.js';
import { seenIn } from '../../../utils/environments/environmentSpecification.js';
import { buildSpecificationInputs } from './inhomogeneities/model.js';

/**
 * The design a tolerance window judges its Specification on in environment
 * `id` (environment 1 by default), and the material resolver to judge it
 * with: `design` as that environment sees it, with a systematic `deviation`
 * applied (Systematic Deviations), or with `interlayers` inserted
 * (Inhomogeneities). A deviation is made on the recipe and seen in the
 * environment; interlayers go between the materials that meet in the
 * environment. The window and the analysis worker both build it here from the
 * same plain recipe, so the badge reads one number on either thread.
 *
 * Returns { design, resolve }.
 */
export function toleranceSpecInputs(design, { deviation, interlayers } = {}, id = BASE_ENVIRONMENT) {
    if (deviation) return deviatedDesignForSpec(design, deviation, designMaterialLookup(design), id);
    if (!interlayers) return seenIn(design, id);
    const { specDesign, resolve } = buildSpecificationInputs(environmentDesign(design, id), interlayers);
    return { design: specDesign, resolve };
}
