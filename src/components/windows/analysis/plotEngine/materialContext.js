import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { resolveEnvironment } from '../../../../utils/physics/environment.js';

export function buildEvaluationContext(design, envIndex = -1) {
    if (!design) return null;
    const resolveMaterial = designMaterialLookup(design);
    const media = resolveEnvironment(design, envIndex);
    const incMat = resolveMaterial(media.incidentMedium);
    const subMat = resolveMaterial(media.substrate?.material);
    const exitMat = resolveMaterial(media.exitMedium);
    const frontLayers = (design.frontLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
    const backLayers = (design.backLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
    return {
        incMat, subMat, exitMat, frontLayers, backLayers,
        subThickness_mm: media.substrate?.thickness ?? 1.0,
    };
}
