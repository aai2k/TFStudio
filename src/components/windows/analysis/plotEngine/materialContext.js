import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { makeConeSpec } from '../../../../utils/physics/optimizer/coneAngle.js';
import {
    BASE_ENVIRONMENT, environmentDesign, environmentLayerFactors, hasEnvironments,
} from '../../../../utils/environments/environments.js';

/**
 * The design as environment `env` computes it (environments.js
 * environmentDesign; the design itself for environment 1, and on a design
 * without environments whatever `env` says), its material resolver, and its
 * stack resolved for the spectrum, as computeCurve takes them. `whole` is the
 * design given, which the merit function scores over its environments, and
 * `layerFactors`, outside environment 1, how many times as thick that
 * environment deposits each front layer, which a swept layer is read at.
 */
export function buildEvaluationContext(design, env = BASE_ENVIRONMENT) {
    if (!design) return null;
    const resolveMaterial = designMaterialLookup(design);
    const seen = hasEnvironments(design) ? environmentDesign(design, env) : design;
    const incMat = resolveMaterial(seen.incidentMedium);
    const subMat = resolveMaterial(seen.substrate?.material);
    const exitMat = resolveMaterial(seen.exitMedium);
    const frontLayers = (seen.frontLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
    const backLayers = (seen.backLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
    return {
        design: seen, whole: design, resolveMat: resolveMaterial,
        incMat, subMat, exitMat, frontLayers, backLayers,
        subThickness_mm: seen.substrate?.thickness ?? 1.0,
        cone: makeConeSpec(seen.cone || {}),
        ...(seen === design ? {} : { layerFactors: environmentLayerFactors(design, env, design.frontLayers || []) }),
    };
}
