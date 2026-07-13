import {
    computeGroupDelaySpectrum,
    tmmWithAdmittances,
} from '../../../../utils/physics/thinFilmMath.js';
import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function nkAt(material, lambdaNm) {
    const [n, k] = material.getNK(lambdaNm);
    return [n, k];
}

function sideLayersAt(design, side, lambdaNm) {
    const layers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const ordered = side === 'back' ? [...layers].reverse() : layers;
    return ordered
        .filter(layer => layer.material && layer.thickness > 0)
        .map(layer => ({ n: nkAt(resolveMaterial(layer.material), lambdaNm), d: layer.thickness }));
}

function sideMedia(design, side) {
    return side === 'back'
        ? { n0Id: design.exitMedium, nsId: design.substrate?.material }
        : { n0Id: design.incidentMedium, nsId: design.substrate?.material };
}

export function computeGdGddSpectrum(design, options) {
    const { side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg, polarization, target } = options;
    const { n0Id, nsId } = sideMedia(design, side);
    const incident = resolveMaterial(n0Id);
    const substrate = resolveMaterial(nsId);
    const coefficientAt = (lambdaNm) => {
        const sampledLambda = Math.round(lambdaNm * 1000) / 1000;
        const layers = sideLayersAt(design, side, sampledLambda);
        const result = tmmWithAdmittances(
            sampledLambda, thetaDeg, polarization,
            nkAt(incident, sampledLambda), nkAt(substrate, sampledLambda), layers,
        );
        return target === 'T' ? result.t : result.r;
    };
    const span = Math.abs(lambdaEnd - lambdaStart);
    const pointCount = Math.max(5, Math.round(span / Math.max(lambdaStep, 1e-6)) + 1);
    return computeGroupDelaySpectrum(coefficientAt, lambdaStart, lambdaEnd, pointCount);
}
