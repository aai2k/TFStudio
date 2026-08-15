/** Design-level point evaluator shared by analysis windows and optimizer operands. */

import { designMaterialLookup } from '../materials/designMaterials.js';
import { materialOmegaResponse, C_NM_PER_FS } from '../materials/materialDispersion.js';
import {
    coefficientPhaseDispersion,
    coefficientPhaseThicknessDerivatives,
    tmmCoefficientJets,
    tmmCoefficientThicknessJets,
} from './phaseDispersion.js';
import {
    jetConstant,
    jetDerivatives,
    jetDivide,
    jetMultiply,
    jetScale,
    jetSqrt,
    jetSubtract,
    wavelengthOmegaJet,
} from './taylorJet.js';

function sideDefinition(design, side) {
    if (side === 'back') {
        return {
            layers: [...(design.backLayers || [])].reverse(),
            incidentId: design.exitMedium,
            substrateId: design.substrate?.material,
        };
    }
    return {
        layers: design.frontLayers || [],
        incidentId: design.incidentMedium,
        substrateId: design.substrate?.material,
    };
}

function continuityMetadata(materials) {
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

/** Incoherent front coating + substrate transit + back coating transmission. */
export function evaluateTotalTransmissionDispersion(design, options) {
    const { wavelengthNm, polarization = 's', thetaDeg = 0 } = options;
    const resolveMaterial = designMaterialLookup(design);
    const incidentMaterial = resolveMaterial(design.incidentMedium);
    const substrateMaterial = resolveMaterial(design.substrate?.material);
    const exitMaterial = resolveMaterial(design.exitMedium);
    const front = evaluateStackPhaseDispersion({
        wavelengthNm,
        target: 'T',
        polarization,
        thetaDeg,
        incidentMaterial,
        substrateMaterial,
        layers: (design.frontLayers || []).map(layer => ({
            material: resolveMaterial(layer.material), thicknessNm: layer.thickness,
        })),
    });
    const substrate = evaluateSubstratePropagation({
        wavelengthNm,
        thicknessMm: design.substrate?.thickness ?? 1,
        thetaDeg,
        incidentMaterial,
        substrateMaterial,
    });
    const back = evaluateStackPhaseDispersion({
        wavelengthNm,
        target: 'T',
        polarization,
        thetaDeg,
        incidentMaterial: substrateMaterial,
        substrateMaterial: exitMaterial,
        referenceIncidentMaterial: incidentMaterial,
        layers: (design.backLayers || []).map(layer => ({
            material: resolveMaterial(layer.material), thicknessNm: layer.thickness,
        })),
    });
    const components = { front, substrate, back };
    const invalid = Object.values(components).find(component => !component.valid);
    if (invalid) return { wavelengthNm, valid: false, reason: invalid.reason, components };
    const add = key => front[key] + substrate[key] + back[key];
    const componentList = Object.values(components);
    return {
        wavelengthNm,
        valid: true,
        phaseRad: add('phaseRad'),
        phaseDeg: add('phaseRad') * 180 / Math.PI,
        gdFs: add('gdFs'),
        gddFs2: add('gddFs2'),
        todFs3: add('todFs3'),
        magnitudeSquared: front.magnitudeSquared * back.magnitudeSquared,
        components,
        models: [...new Set([
            ...(front.models || []),
            `${substrateMaterial.name || 'Substrate'}: ${substrate.model}`,
            ...(back.models || []),
        ])],
        phaseContinuousOrder: Math.min(...componentList.map(component =>
            component.phaseContinuousOrder ?? 3)),
        knotSignature: componentList.map(component => component.knotSignature || '-').join('||'),
        discontinuityModels: [...new Set(componentList.flatMap(component =>
            component.discontinuityModels || []))],
    };
}

/**
 * Evaluate phase, GD, GDD, and TOD at one wavelength. Values at this wavelength
 * are independent of all neighbouring presentation samples.
 */
export function evaluateDesignPhaseDispersion(design, options) {
    const {
        wavelengthNm,
        side = 'front',
        target = 'R',
        polarization = 's',
        thetaDeg = 0,
    } = options;
    const resolveMaterial = designMaterialLookup(design);
    const definition = sideDefinition(design, side);
    const layers = definition.layers
        .filter(layer => layer.material && layer.thickness > 0)
        .map(layer => ({
            material: resolveMaterial(layer.material),
            thicknessNm: layer.thickness,
        }));
    return evaluateStackPhaseDispersion({
        wavelengthNm,
        thetaDeg,
        polarization,
        target,
        incidentMaterial: resolveMaterial(definition.incidentId),
        substrateMaterial: resolveMaterial(definition.substrateId),
        layers,
    });
}

/**
 * Prepare a design stack once for repeated wavelength evaluation. This keeps
 * the pointwise mathematics identical while avoiding material and layer
 * resolution work at every plotted wavelength.
 */
export function createDesignPhaseDispersionEvaluator(design, options = {}) {
    const {
        side = 'front',
        target = 'R',
        polarization = 's',
        thetaDeg = 0,
    } = options;
    const resolveMaterial = designMaterialLookup(design);
    const definition = sideDefinition(design, side);
    const incidentMaterial = resolveMaterial(definition.incidentId);
    const substrateMaterial = resolveMaterial(definition.substrateId);
    const layers = definition.layers
        .filter(layer => layer.material && layer.thickness > 0)
        .map(layer => ({
            material: resolveMaterial(layer.material),
            thicknessNm: layer.thickness,
        }));
    return wavelengthNm => evaluateStackPhaseDispersion({
        wavelengthNm,
        thetaDeg,
        polarization,
        target,
        incidentMaterial,
        substrateMaterial,
        layers,
    });
}
