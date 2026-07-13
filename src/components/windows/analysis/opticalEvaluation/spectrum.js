import { evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal } from '../../../../utils/physics/thinFilmMath.js';
import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { makeConeSpec, coneAverageResult } from '../../../../utils/physics/optimizer.js';

const CONE_SPEC_KEYS = ['T', 'R', 'A', 'Ts', 'Rs', 'Tp', 'Rp', 'As', 'Ap'];

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function resolveLayers(layers) {
    return (layers || [])
        .filter(layer => layer.thickness > 0)
        .map(layer => ({ material: resolveMaterial(layer.material), thickness: layer.thickness }));
}

function evaluateAtAngle(state, theta) {
    const params = { ...state.params, theta };
    if (state.evalMode === 'front') return evaluateSpectrum(params, state.incMat, state.subMat, state.frontLayers);
    if (state.evalMode === 'back') return evaluateSpectrumBack(params, state.exitMat, state.subMat, state.backLayers);
    return evaluateSpectrumTotal(
        params, state.incMat, state.subMat, state.exitMat,
        state.frontLayers, state.backLayers, state.subThick
    );
}

function spectrumState(design, params, evalMode) {
    return {
        design, params, evalMode,
        incMat: resolveMaterial(design.incidentMedium),
        subMat: resolveMaterial(design.substrate.material),
        exitMat: resolveMaterial(design.exitMedium),
        subThick: design.substrate.thickness ?? 1.0,
        frontLayers: resolveLayers(design.frontLayers),
        backLayers: resolveLayers(design.backLayers),
    };
}

export function computeOpticalSpectrum(design, params, evalMode) {
    const state = spectrumState(design, params, evalMode);
    const thetas = params.thetas?.length ? params.thetas : [0];
    const coneSpec = makeConeSpec(design.cone || {});
    const series = [];
    let lambda = null;

    for (const theta of thetas) {
        const result = coneAverageResult(coneSpec, theta, angle => evaluateAtAngle(state, angle), CONE_SPEC_KEYS);
        if (!lambda) lambda = result.lambda;
        series.push({
            theta,
            T: result.T, R: result.R, A: result.A,
            Ts: result.Ts, Rs: result.Rs,
            Tp: result.Tp, Rp: result.Rp
        });
    }
    return { lambda: lambda || [], series };
}

export function mediumName(id) {
    if (!id) return '';
    const material = getMaterialById(id);
    if (material && material.name) return material.name;
    const separator = id.indexOf(':');
    return separator >= 0 ? id.slice(separator + 1) : id;
}
