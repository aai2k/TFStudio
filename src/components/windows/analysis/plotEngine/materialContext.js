import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';

export function buildEvaluationContext(design) {
    if (!design) return null;
    const resolveMaterial = designMaterialLookup(design);
    const incMat = resolveMaterial(design.incidentMedium);
    const subMat = resolveMaterial(design.substrate?.material);
    const exitMat = resolveMaterial(design.exitMedium);
    const frontLayers = (design.frontLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
    const backLayers = (design.backLayers || [])
        .filter(l => l.thickness > 0)
        .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
    return {
        incMat, subMat, exitMat, frontLayers, backLayers,
        subThickness_mm: design.substrate?.thickness ?? 1.0,
    };
}
