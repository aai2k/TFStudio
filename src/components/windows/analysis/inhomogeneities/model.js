import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { runSpectrum } from '../../../../utils/physics/plotQuantities/spectrumRunner.js';
import { makeConeSpec } from '../../../../utils/physics/optimizer/coneAngle.js';
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

/**
 * The homogeneous and the graded spectrum of the design for the evaluation
 * mode, both averaged over the design's cone of incidence as Optical
 * Evaluation averages its spectrum.
 */
export function computeInhomogeneitySpectra(design, params, inh, evalMode) {
    const { incMat, subMat, exitMat, frontRaw, backRaw, frontExp, backExp } = buildExpandedStacks(design, inh);
    const media = {
        incMat, subMat, exitMat,
        subThickness_mm: design.substrate?.thickness ?? 1.0,
        cone: makeConeSpec(design.cone || {}),
    };
    return {
        baseline: runSpectrum(evalMode, params, { ...media, frontLayers: frontRaw, backLayers: backRaw }),
        perturbed: runSpectrum(evalMode, params, { ...media, frontLayers: frontExp, backLayers: backExp }),
    };
}

/**
 * The window's spectra, { baseline, perturbed, error }: `error` holds the
 * message of a computation that failed, and the spectra are null then. The
 * analysis worker runs it under a cone of incidence.
 */
export function inhomogeneitySpectraState({ design, params, inh, evalMode }) {
    if (!design?.frontLayers) return { baseline: null, perturbed: null, error: null };
    try {
        return { ...computeInhomogeneitySpectra(design, params, inh, evalMode), error: null };
    } catch (caught) {
        return { baseline: null, perturbed: null, error: caught.message || String(caught) };
    }
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
