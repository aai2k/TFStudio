/**
 * Point evaluators for callers that have already resolved material objects.
 *
 * A stack is evaluated at one wavelength and returns phase, GD, GDD, and TOD
 * together with the material models that produced them. When a material cannot
 * supply third-order frequency derivatives the point is returned invalid with
 * the offending material named rather than silently approximated.
 *
 * A wavelength outside a material's range is not that case: a table holds its
 * end value there and a formula is extrapolated past the band it was fitted
 * over, so a value exists. The point carries it, with `outsideRange` naming the
 * first material it was taken outside of, or null. What to do with it is the
 * caller's: an analysis window draws the point and shades the band, while the
 * merit function refuses it (optimizer/evalCore.js), a target being scored
 * rather than looked at.
 *
 * Reported continuity metadata lets callers break a drawn curve where it is
 * genuinely discontinuous: PCHIP interpolation of tabulated n and k is only C1,
 * so GDD and TOD jump at table knots; a linearly interpolated table is C0, so
 * GD jumps there as well. `onKnot` says the wavelength is exactly on one, where
 * the two sides are averaged; `knotSide` asks for one of them instead, which is
 * how a caller sizes the jump before deciding whether it is worth drawing.
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
} from '../../../tmmcore.js';
import { wasmKernel } from '../kernelStack.js';

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
 * One phase evaluation of a prepared stack on the WebAssembly kernel. This is
 * the only place the kernel's phase calls are made. Returns null where the
 * coefficient is exactly zero and the phase is undefined.
 */
function phaseQuantities(options, target, withThicknessJacobian) {
    const result = kernelPhase(wasmKernel(), options, withThicknessJacobian);
    const side = target === 'T' ? result.t : result.r;
    if (!side) return null;
    const { dPhaseDeg, dGd, dGdd, dTod, ...dispersion } = side;
    return {
        dispersion: inFemtoseconds(dispersion),
        thicknessJacobian: withThicknessJacobian
            ? inFemtoseconds({ phaseDeg: dPhaseDeg, gd: dGd, gdd: dGdd, tod: dTod })
            : undefined,
    };
}

// One phase call on the loaded kernel: { r, t }, each side null where its
// coefficient is exactly zero. Polarization 'p' is p and anything else s.
// With an incident sine given as a jet (a reference incident medium other than
// the stack's own) the call takes that jet in place of the angle.
function kernelPhase(wasm, options, withThicknessJacobian) {
    const pol = options.polarization === 'p' ? 'p' : 's';
    const stack = {
        incident: { n: options.incidentIndexJet },
        substrate: { n: options.substrateIndexJet },
        layers: options.layers.map(layer => ({ n: layer.indexJet, d: layer.thicknessNm })),
    };
    const incidence = options.incidentSineJet
        ? { sine: options.incidentSineJet }
        : { angle: Number(options.thetaDeg) };
    const call = withThicknessJacobian ? wasm.phaseJacobian : wasm.phase;
    return call(stack, Number(options.wavelengthNm), { ...incidence, pol });
}

export function continuityMetadata(materials) {
    return {
        phaseContinuousOrder: materials.length
            ? Math.min(...materials.map(item => item.response.continuousOrder ?? 3))
            : 3,
        onKnot: materials.some(item => item.response.onKnot),
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
        knotSide,
    } = options;
    const responseCache = new Map();
    const responseFor = (material, name) => {
        if (!responseCache.has(material)) {
            responseCache.set(material, {
                name: material?.name || material?.id || name,
                response: materialOmegaResponse(material, wavelengthNm, knotSide),
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
    const models = [...new Set(used.map(item => `${item.name}: ${item.response.model}`))];
    const outsideRange = used.find(item => !item.response.inRange)?.name ?? null;
    const unavailable = used.find(item => item.response.maxOrder < 3 || !item.response.jet);
    if (unavailable) {
        return {
            wavelengthNm,
            valid: false,
            reason: `${unavailable.name}: third-order material derivatives are unavailable`,
            models,
            outsideRange,
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
            models,
            outsideRange,
            ...continuity,
        };
    }
    return {
        wavelengthNm,
        valid: true,
        ...quantities.dispersion,
        thicknessJacobian: quantities.thicknessJacobian,
        models,
        outsideRange,
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
    const used = [
        { name: incidentMaterial?.name || 'Incident medium', response: incident },
        { name: substrateMaterial?.name || 'Substrate', response: substrate },
    ];
    const continuity = continuityMetadata(used);
    const outsideRange = used.find(item => !item.response.inRange)?.name ?? null;
    if (!incident.jet || !substrate.jet) {
        return {
            wavelengthNm,
            valid: false,
            reason: 'Substrate propagation derivatives are unavailable',
            outsideRange,
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
        outsideRange,
        ...continuity,
    };
}
