import {
    evaluateSpectrum,
    evaluateSpectrumBack,
    evaluateSpectrumTotal,
} from '../../../../utils/physics/thinFilmMath.js';
import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { makeConeSpec, coneAverageResult } from '../../../../utils/physics/optimizer.js';

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function resolvedLayers(layers) {
    return (layers || [])
        .filter(layer => layer.thickness > 0)
        .map(layer => ({
            material: resolveMaterial(layer.material),
            thickness: layer.thickness,
        }));
}

export function computeSpectrumForMode(design, params, evalMode) {
    const incident = resolveMaterial(design.incidentMedium);
    const substrate = resolveMaterial(design.substrate.material);
    const exit = resolveMaterial(design.exitMedium);
    const substrateThickness = design.substrate.thickness ?? 1.0;
    const frontLayers = resolvedLayers(design.frontLayers);
    const backLayers = resolvedLayers(design.backLayers);

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
