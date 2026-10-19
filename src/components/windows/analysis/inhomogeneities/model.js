import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../../../utils/physics/thinFilmMath.js';
import { expandLayersWithInterlayers } from '../../../../utils/physics/inhomogeneity.js';

function resolveLayers(resolveMaterial, layers) {
    return (layers || [])
        .filter(layer => layer.thickness > 0)
        .map(layer => ({ material: resolveMaterial(layer.material), thickness: layer.thickness }));
}

export function activeDesignSides(design, evalMode) {
    const hasBack = (design?.backLayers?.length || 0) > 0;
    if (evalMode === 'back') return ['back'];
    if (evalMode === 'total') return hasBack ? ['front', 'back'] : ['front'];
    return ['front'];
}

export function buildExpandedStacks(design, inh) {
    const resolveMaterial = designMaterialLookup(design);
    const incMat = resolveMaterial(design.incidentMedium);
    const subMat = resolveMaterial(design.substrate?.material);
    const exitMat = resolveMaterial(design.exitMedium);
    const frontRaw = resolveLayers(resolveMaterial, design.frontLayers);
    const backRaw = resolveLayers(resolveMaterial, design.backLayers);
    const frontExp = expandLayersWithInterlayers(frontRaw, incMat, subMat, inh.interlayers || []);
    const backExp = expandLayersWithInterlayers(backRaw, subMat, exitMat, inh.backInterlayers || []);
    return { incMat, subMat, exitMat, frontRaw, backRaw, frontExp, backExp };
}

export function computeInhomogeneitySpectra(design, params, inh, evalMode) {
    const stacks = buildExpandedStacks(design, inh);
    const { incMat, subMat, exitMat, frontRaw, backRaw, frontExp, backExp } = stacks;
    const subThk = design.substrate?.thickness ?? 1.0;
    if (evalMode === 'back') {
        return {
            baseline: evaluateSpectrumBack(params, exitMat, subMat, backRaw),
            perturbed: evaluateSpectrumBack(params, exitMat, subMat, backExp),
        };
    }
    if (evalMode === 'total') {
        return {
            baseline: evaluateSpectrumTotal(params, incMat, subMat, exitMat, frontRaw, backRaw, subThk),
            perturbed: evaluateSpectrumTotal(params, incMat, subMat, exitMat, frontExp, backExp, subThk),
        };
    }
    return {
        baseline: evaluateSpectrum(params, incMat, subMat, frontRaw),
        perturbed: evaluateSpectrum(params, incMat, subMat, frontExp),
    };
}

export function buildSpecificationInputs(design, inh) {
    const { frontExp, backExp } = buildExpandedStacks(design, inh);
    // Interlayers can go on one face of a symmetric design, so the check
    // scores the two faces as built, not the back as the mirror of the front.
    const specDesign = {
        ...design,
        ...(design.surfaceMode === 'symmetric' ? { surfaceMode: 'both_independent' } : {}),
        frontLayers: frontExp.map(layer => ({ material: layer.material, thickness: layer.thickness })),
        backLayers: backExp.map(layer => ({ material: layer.material, thickness: layer.thickness })),
    };
    const resolveMaterial = designMaterialLookup(design);
    const resolve = material => (material && material.getNK) ? material : resolveMaterial(material);
    return { specDesign, resolve };
}
