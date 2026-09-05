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
 * so GDD and TOD jump at table knots; a linearly interpolated table is C0, so
 * GD jumps there as well.
 */

import { materialOmegaResponse, C_NM_PER_FS } from '../../materials/materialDispersion.js';
import {
    coefficientPhaseDispersion,
    coefficientPhaseThicknessDerivatives,
    jetConstant,
    jetDerivatives,
    jetDivide,
    jetMultiply,
    jetScale,
    jetSqrt,
    jetSubtract,
    getTmmWasm,
    tmmCoefficientJets,
    tmmCoefficientThicknessJets,
    tmmWasmActive,
    wavelengthOmegaJet,
} from '../../../tmmcore.js';

// tmmcore reports each order in the reciprocal of whatever angular-frequency
// unit it was given, and names them accordingly. Every caller here works in
// rad/fs, so the names carry the unit from this point outward. Applies to the
// values and to their thickness derivatives alike, which share the key names.
function inFemtoseconds(quantities) {
    if (!quantities) return null;
    const { gd, gdd, tod, ...rest } = quantities;
    return { ...rest, gdFs: gd, gddFs2: gdd, todFs3: tod };
}

/**
 * One phase evaluation of a prepared stack, through the WebAssembly kernel when
 * one is instantiated in this thread and the JavaScript otherwise.
 *
 * This is the only place either backend is called, so the two cannot drift apart
 * in how they are used; that they agree numerically is held by tmmcore's own
 * equivalence suite. Returns null where the coefficient is exactly zero and the
 * phase is undefined.
 */
function phaseQuantities(options, target, withThicknessJacobian) {
    const wasm = tmmWasmActive() ? getTmmWasm() : null;
    if (wasm && wasm.hasPhase()) {
        const result = wasm[withThicknessJacobian ? 'tmmPhaseJacobian' : 'tmmPhaseOne'](
            options.wavelengthNm,
            options.thetaDeg,
            options.polarization === 'p' ? 1 : 0,
            options.incidentIndexJet,
            options.substrateIndexJet,
            options.layers.map(layer => ({ nJet: layer.indexJet, d: layer.thicknessNm })),
            { omega: options.omega, sinTheta0Jet: options.incidentSineJet },
        );
        const side = target === 'T' ? result.t : result.r;
        if (!side) return null;
        const { dPhaseDeg, dGd, dGdd, dTod, ...dispersion } = side;
        return {
            dispersion: inFemtoseconds(dispersion),
            thicknessJacobian: withThicknessJacobian
                ? inFemtoseconds(
                    dGd && { phaseDeg: dPhaseDeg, gd: dGd, gdd: dGdd, tod: dTod })
                : undefined,
        };
    }
    const coefficients = withThicknessJacobian
        ? tmmCoefficientThicknessJets(options)
        : tmmCoefficientJets(options);
    const coefficientJet = target === 'T' ? coefficients.transmission : coefficients.reflection;
    const dispersion = inFemtoseconds(coefficientPhaseDispersion(coefficientJet));
    if (!dispersion) return null;
    const thicknessJets = target === 'T'
        ? coefficients.transmissionThickness
        : coefficients.reflectionThickness;
    return {
        dispersion,
        thicknessJacobian: withThicknessJacobian
            ? inFemtoseconds(
                coefficientPhaseThicknessDerivatives(coefficientJet, thicknessJets))
            : undefined,
    };
}

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
    const quantities = phaseQuantities({
        wavelengthNm,
        omega,
        wavelengthJet,
        thetaDeg,
        polarization,
        incidentIndexJet: incident.response.jet,
        substrateIndexJet: substrate.response.jet,
        incidentSineJet,
        layers: layerResponses,
    }, target, withThicknessJacobian);
    if (!quantities) {
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
        ...quantities.dispersion,
        thicknessJacobian: quantities.thicknessJacobian,
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
