import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { matFriendlyName } from '../../optimization/synthesisShared/materialNames.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../../../utils/physics/thinFilmMath.js';
import {
    enumerateInterfaces, expandLayersWithInterlayers,
} from '../../../../utils/physics/inhomogeneity.js';

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

// A medium is stored as a material id or as { material: id }.
const mediumId = medium => (typeof medium === 'string' ? medium : medium?.material);

// The interfaces of each stack, with the media named as the design shows them
// and the layers numbered as the Design Editor numbers them. Front layers are
// stored air side first and L1 is the one on the substrate; back layers are
// stored substrate first, which is already their order. `ih` is
// t.inhomogeneities, which names a medium the design leaves unset.
export function designInterfaces(design, ih) {
    const name = medium => matFriendlyName(mediumId(medium), design);
    const incident = name(design?.incidentMedium) || ih.mediumIncident;
    const substrate = name(design?.substrate?.material) || ih.mediumSubstrate;
    const exit = name(design?.exitMedium) || ih.mediumExit;
    const frontCount = design?.frontLayers?.length || 0;
    const front = design?.frontLayers
        ? enumerateInterfaces(design.frontLayers, incident, substrate, i => frontCount - i)
        : [];
    const back = design?.backLayers?.length ? enumerateInterfaces(design.backLayers, substrate, exit) : [];
    return { front, back };
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
    const specDesign = {
        ...design,
        frontLayers: frontExp.map(layer => ({ material: layer.material, thickness: layer.thickness })),
        backLayers: backExp.map(layer => ({ material: layer.material, thickness: layer.thickness })),
    };
    const resolveMaterial = designMaterialLookup(design);
    const resolve = material => (material && material.getNK) ? material : resolveMaterial(material);
    return { specDesign, resolve };
}
