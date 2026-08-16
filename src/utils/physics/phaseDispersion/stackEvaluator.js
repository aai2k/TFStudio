/**
 * Point evaluators for callers that have already resolved material objects.
 *
 * A stack is evaluated at one wavelength and returns phase, GD, GDD, and TOD
 * together with the material models that produced them. When a material cannot
 * supply third-order frequency derivatives, or the wavelength falls outside its
 * model range, the point is returned invalid with the offending material named
 * rather than silently approximated.
 *
 * Reported continuity metadata lets callers break a drawn curve where it is
 * genuinely discontinuous: PCHIP interpolation of tabulated n and k is only C1,
 * so GDD and TOD jump at table knots.
 */

import { materialOmegaResponse, C_NM_PER_FS } from '../../materials/materialDispersion.js';
import {
    jetConstant,
    jetDerivatives,
    jetDivide,
    jetMultiply,
    jetScale,
    jetSqrt,
    jetSubtract,
    wavelengthOmegaJet,
} from '../taylorJet.js';
import {
    coefficientPhaseDispersion,
    coefficientPhaseThicknessDerivatives,
} from './phaseDerivatives.js';
import { tmmCoefficientJets, tmmCoefficientThicknessJets } from './coefficientJets.js';

export function continuityMetadata(materials) {
    const tabulated = materials.filter(item => item.response.continuousOrder < 3);
    return {
        phaseContinuousOrder: materials.length
            ? Math.min(...materials.map(item => item.response.continuousOrder ?? 3))
            : 3,
        knotSignature: tabulated
            .map(item => `${item.name}:${item.response.knotSignature || '-'}`)
            .join('|'),
        discontinuityModels: [...new Set(tabulated.map(item =>
            `${item.name}: ${item.response.model}`))],
    };
}

/** Point evaluator for callers that already resolved material objects. */
export function evaluateStackPhaseDispersion(options) {
    const {
        wavelengthNm,
        target = 'R',
        polarization = 's',
        thetaDeg = 0,
        incidentMaterial,
        substrateMaterial,
        referenceIncidentMaterial = null,
        layers = [],
        withThicknessJacobian = false,
    } = options;
    const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
    const wavelengthJet = wavelengthOmegaJet(wavelengthNm, omega);
    const responseCache = new Map();
    const responseFor = (material, name) => {
        if (!responseCache.has(material)) {
            responseCache.set(material, {
                name: material?.name || material?.id || name,
                response: materialOmegaResponse(material, wavelengthNm),
            });
        }
        return responseCache.get(material);
    };
    const incident = responseFor(incidentMaterial, 'Incident medium');
    const substrate = responseFor(substrateMaterial, 'Substrate');
    const referenceIncident = referenceIncidentMaterial
        ? responseFor(referenceIncidentMaterial, 'Reference incident medium')
        : null;
    const layerResponses = layers
        .filter(layer => layer.material && layer.thicknessNm > 0)
        .map(layer => ({
            indexJet: responseFor(layer.material, 'Layer').response.jet,
            thicknessNm: layer.thicknessNm,
            material: responseFor(layer.material, 'Layer'),
        }));
    const used = [incident, substrate, ...layerResponses.map(layer => layer.material)];
    if (referenceIncident) used.push(referenceIncident);
    const continuity = continuityMetadata(used);
    const unavailable = used.find(item => item.response.maxOrder < 3 || !item.response.jet);
    const outOfRange = used.find(item => !item.response.inRange);
    if (unavailable || outOfRange) {
        const offender = unavailable || outOfRange;
        return {
            wavelengthNm,
            valid: false,
            reason: unavailable
                ? `${offender.name}: third-order material derivatives are unavailable`
                : `${offender.name}: wavelength is outside the material model range`,
            models: [...new Set(used.map(item => `${item.name}: ${item.response.model}`))],
            ...continuity,
        };
    }

    const incidentSineJet = referenceIncident
        ? jetDivide(
            jetScale(referenceIncident.response.jet, Math.sin(thetaDeg * Math.PI / 180)),
            incident.response.jet,
        )
        : null;
    const coefficientOptions = {
        wavelengthJet,
        thetaDeg,
        polarization,
        incidentIndexJet: incident.response.jet,
        substrateIndexJet: substrate.response.jet,
        incidentSineJet,
        layers: layerResponses,
    };
    const coefficients = withThicknessJacobian
        ? tmmCoefficientThicknessJets(coefficientOptions)
        : tmmCoefficientJets(coefficientOptions);
    const coefficientJet = target === 'T' ? coefficients.transmission : coefficients.reflection;
    const thicknessJets = target === 'T'
        ? coefficients.transmissionThickness
        : coefficients.reflectionThickness;
    const dispersion = coefficientPhaseDispersion(coefficientJet);
    if (!dispersion) {
        return {
            wavelengthNm,
            valid: false,
            reason: `${target === 'T' ? 'Transmission' : 'Reflection'} amplitude is exactly zero`,
            models: [...new Set(used.map(item => `${item.name}: ${item.response.model}`))],
            ...continuity,
        };
    }
    return {
        wavelengthNm,
        valid: true,
        ...dispersion,
        coefficient: coefficientJet[0],
        thicknessJacobian: withThicknessJacobian
            ? coefficientPhaseThicknessDerivatives(coefficientJet, thicknessJets)
            : undefined,
        models: [...new Set(used.map(item => `${item.name}: ${item.response.model}`))],
        ...continuity,
    };
}

/** Propagation through a substrate while the external angle is held fixed. */
export function evaluateSubstratePropagation(options) {
    const {
        wavelengthNm,
        thicknessMm,
        thetaDeg = 0,
        incidentMaterial,
        substrateMaterial,
    } = options;
    const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
    const wavelengthJet = wavelengthOmegaJet(wavelengthNm, omega);
    const incident = materialOmegaResponse(incidentMaterial, wavelengthNm);
    const substrate = materialOmegaResponse(substrateMaterial, wavelengthNm);
    const continuity = continuityMetadata([
        { name: incidentMaterial?.name || 'Incident medium', response: incident },
        { name: substrateMaterial?.name || 'Substrate', response: substrate },
    ]);
    if (!incident.jet || !substrate.jet || !incident.inRange || !substrate.inRange) {
        return {
            wavelengthNm,
            valid: false,
            reason: !incident.inRange || !substrate.inRange
                ? 'Wavelength is outside the substrate propagation model range'
                : 'Substrate propagation derivatives are unavailable',
            ...continuity,
        };
    }
    const transverseIndex = jetScale(incident.jet, Math.sin(thetaDeg * Math.PI / 180));
    const substrateSine = jetDivide(transverseIndex, substrate.jet);
    const substrateCosine = jetSqrt(jetSubtract(
        jetConstant(1),
        jetMultiply(substrateSine, substrateSine),
    ));
    const phaseJet = jetScale(
        jetDivide(jetMultiply(substrate.jet, substrateCosine), wavelengthJet),
        2 * Math.PI * thicknessMm * 1e6,
    );
    const [phase, first, second, third] = jetDerivatives(phaseJet);
    return {
        wavelengthNm,
        valid: true,
        phaseRad: -phase[0],
        gdFs: first[0],
        gddFs2: second[0],
        todFs3: third[0],
        model: substrate.model,
        ...continuity,
    };
}
