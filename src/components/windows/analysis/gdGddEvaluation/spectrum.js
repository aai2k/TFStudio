import {
    computeGroupDelaySpectrumAtWavelengthStep,
    tmmWithAdmittances,
} from '../../../../utils/physics/thinFilmMath.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';

export const DEFAULT_GD_GDD_WAVELENGTH_STEP_NM = 0.2;

function nkAt(material, lambdaNm) {
    const [n, k] = material.getNK(lambdaNm);
    return [n, k];
}

function sideLayersAt(resolveMaterial, design, side, lambdaNm) {
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
    const resolveMaterial = designMaterialLookup(design);
    const incident = resolveMaterial(n0Id);
    const substrate = resolveMaterial(nsId);
    // The wavelength must be passed through unmodified. GD, GDD and TOD are the
    // first three derivatives of phase, so their finite-difference weights scale
    // with inverse powers of the local spacing. Quantizing the sample positions
    // puts fixed wavelength jitter into the phase and prevents convergence.
    const coefficientAt = (lambdaNm) => {
        const layers = sideLayersAt(resolveMaterial, design, side, lambdaNm);
        const result = tmmWithAdmittances(
            lambdaNm, thetaDeg, polarization,
            nkAt(incident, lambdaNm), nkAt(substrate, lambdaNm), layers,
        );
        return target === 'T' ? result.t : result.r;
    };
    return computeGroupDelaySpectrumAtWavelengthStep(
        coefficientAt, lambdaStart, lambdaEnd, lambdaStep,
    );
}
