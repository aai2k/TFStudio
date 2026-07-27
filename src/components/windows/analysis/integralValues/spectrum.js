import {
    evaluateSpectrum,
    evaluateSpectrumBack,
    evaluateSpectrumTotal,
} from '../../../../utils/physics/thinFilmMath.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { makeConeSpec, coneAverageResult } from '../../../../utils/physics/optimizer.js';

function resolvedLayers(resolveMaterial, layers) {
    return (layers || [])
        .filter(layer => layer.thickness > 0)
        .map(layer => ({
            material: resolveMaterial(layer.material),
            thickness: layer.thickness,
        }));
}

export function computeSpectrumForMode(design, params, evalMode) {
    const resolveMaterial = designMaterialLookup(design);
    const incident = resolveMaterial(design.incidentMedium);
    const substrate = resolveMaterial(design.substrate.material);
    const exit = resolveMaterial(design.exitMedium);
    const substrateThickness = design.substrate.thickness ?? 1.0;
    const frontLayers = resolvedLayers(resolveMaterial, design.frontLayers);
    const backLayers = resolvedLayers(resolveMaterial, design.backLayers);

    const computeAt = (theta) => {
        const sampleParams = { ...params, theta };
        if (evalMode === 'front') return evaluateSpectrum(sampleParams, incident, substrate, frontLayers);
        if (evalMode === 'back') return evaluateSpectrumBack(sampleParams, exit, substrate, backLayers);
        return evaluateSpectrumTotal(
            sampleParams, incident, substrate, exit,
            frontLayers, backLayers, substrateThickness,
        );
    };

    return coneAverageResult(
        makeConeSpec(design.cone || {}), params.theta ?? 0, computeAt,
        ['T', 'R', 'A', 'Ts', 'Rs', 'Tp', 'Rp', 'As', 'Ap'],
    );
}
