import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../../../utils/physics/thinFilmMath.js';
import { enumerateInterfaces } from '../../../../utils/physics/inhomogeneity.js';
import {
    resolveSigmas, effectiveRoughness, tisSpectrum, applyScatteringLoss, countInterfaces,
} from '../../../../utils/physics/scattering.js';

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

export function getRoughnessContext(design, evalMode) {
    const hasBack = (design?.backLayers?.length || 0) > 0;
    const activeSides = evalMode === 'back'
        ? ['back']
        : evalMode === 'total'
            ? (hasBack ? ['front', 'back'] : ['front'])
            : ['front'];
    const frontN = countInterfaces(design?.frontLayers?.length || 0);
    const backN = hasBack ? countInterfaces(design.backLayers.length) : 0;
    const nIfaces = activeSides.reduce((sum, side) => sum + (side === 'back' ? backN : frontN), 0);
    return { hasBack, activeSides, frontN, backN, nIfaces };
}

export function buildInterfaceLabels(design) {
    const front = design?.frontLayers
        ? enumerateInterfaces(
            design.frontLayers.map(layer => ({
                material: resolveMaterial(layer.material), thickness: layer.thickness,
            })),
            design.incidentMedium || 'Inc',
            design.substrate?.material || 'Sub'
        )
        : [];
    const back = design?.backLayers?.length
        ? enumerateInterfaces(
            design.backLayers.map(layer => ({
                material: resolveMaterial(layer.material), thickness: layer.thickness,
            })),
            design.substrate?.material || 'Sub',
            design.exitMedium || 'Exit'
        )
        : [];
    return { front, back };
}

export function calculateRoughness({ design, params, rough, evalMode, aoi, context }) {
    if (!design?.frontLayers) return { data: null, error: null };
    try {
        const incMat = resolveMaterial(design.incidentMedium);
        const subMat = resolveMaterial(design.substrate?.material);
        const exitMat = resolveMaterial(design.exitMedium);
        const subThk = design.substrate?.thickness ?? 1.0;
        const frontRaw = (design.frontLayers || [])
            .filter(layer => layer.thickness > 0)
            .map(layer => ({ material: resolveMaterial(layer.material), thickness: layer.thickness }));
        const backRaw = (design.backLayers || [])
            .filter(layer => layer.thickness > 0)
            .map(layer => ({ material: resolveMaterial(layer.material), thickness: layer.thickness }));
        const sigForSide = (side, count) => resolveSigmas({
            mode: rough.mode,
            sigma: rough.sigma,
            sigmas: side === 'back' ? rough.backSigmas : rough.sigmas,
        }, count);

        let spec;
        let sigmaList;
        if (evalMode === 'back') {
            spec = evaluateSpectrumBack(params, exitMat, subMat, backRaw);
            sigmaList = sigForSide('back', context.backN);
        } else if (evalMode === 'total') {
            spec = evaluateSpectrumTotal(params, incMat, subMat, exitMat, frontRaw, backRaw, subThk);
            sigmaList = [
                ...sigForSide('front', context.frontN),
                ...(context.hasBack ? sigForSide('back', context.backN) : []),
            ];
        } else {
            spec = evaluateSpectrum(params, incMat, subMat, frontRaw);
            sigmaList = sigForSide('front', context.frontN);
        }

        const sigmaEff = effectiveRoughness(sigmaList);
        const TIS_per_R = tisSpectrum(spec.lambda, sigmaEff, aoi, null);
        const TIS_inc = tisSpectrum(spec.lambda, sigmaEff, aoi, spec.R);
        const { R_spec, T_spec } = applyScatteringLoss(spec.lambda, spec.R, spec.T, sigmaEff, aoi);
        return { data: {
            lambda: spec.lambda,
            R: spec.R, T: spec.T,
            R_spec, T_spec,
            TIS_per_R, TIS_inc,
            sigmaEff,
            sigmas: sigmaList,
        }, error: null };
    } catch (error) {
        return { data: null, error: error.message || String(error) };
    }
}
