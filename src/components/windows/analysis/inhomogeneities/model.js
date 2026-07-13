import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../../../utils/physics/thinFilmMath.js';
import {
    enumerateInterfaces, expandLayersWithInterlayers,
} from '../../../../utils/physics/inhomogeneity.js';

export function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function resolveLayers(layers) {
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

export function hasLayersForMode(design, evalMode) {
    const hasFront = !!design.frontLayers?.length;
    const hasBack = !!design.backLayers?.length;
    if (evalMode === 'back') return hasBack;
    if (evalMode === 'front') return hasFront;
    return hasFront || hasBack;
}

export function designInterfaces(design) {
    const front = design?.frontLayers
        ? enumerateInterfaces(
            design.frontLayers,
            design.incidentMedium || 'Inc',
            design.substrate?.material || 'Sub',
        )
        : [];
    const back = design?.backLayers?.length
        ? enumerateInterfaces(
            design.backLayers,
            design.substrate?.material || 'Sub',
            design.exitMedium || 'Exit',
        )
        : [];
    return { front, back };
}

export function buildExpandedStacks(design, inh) {
    const incMat = resolveMaterial(design.incidentMedium);
    const subMat = resolveMaterial(design.substrate?.material);
    const exitMat = resolveMaterial(design.exitMedium);
    const frontRaw = resolveLayers(design.frontLayers);
    const backRaw = resolveLayers(design.backLayers);
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
    const specDesign = {
        ...design,
        frontLayers: frontExp.map(layer => ({ material: layer.material, thickness: layer.thickness })),
        backLayers: backExp.map(layer => ({ material: layer.material, thickness: layer.thickness })),
    };
    const resolve = material => (material && material.getNK) ? material : resolveMaterial(material);
    return { specDesign, resolve };
}
