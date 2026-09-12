/**
 * Design-level entry points shared by the analysis windows and the optimizer.
 *
 * These resolve a design's materials and layer order, then hand the prepared
 * stack to the point evaluators. Front evaluates the front layers from the
 * incident medium; back evaluates the reversed back layers from the substrate.
 */

import { designMaterialLookup } from '../../materials/designMaterials.js';
import { materialKnotWavelengths } from '../../materials/materialDispersion.js';
import {
    evaluateStackPhaseDispersion,
    evaluateSubstratePropagation,
} from './stackEvaluator.js';

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
        onKnot: componentList.some(component => component.onKnot),
    };
}

/**
 * Evaluate phase, GD, GDD, and TOD at one wavelength. Values at this wavelength
 * are independent of all neighbouring presentation samples. `knotSide` picks a
 * one-sided value where the wavelength falls on a table knot; without it the
 * two sides are averaged there.
 */
export function evaluateDesignPhaseDispersion(design, options) {
    const {
        wavelengthNm,
        side = 'front',
        target = 'R',
        polarization = 's',
        thetaDeg = 0,
        knotSide,
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
        knotSide,
    });
}

/**
 * Prepare a design stack once for repeated wavelength evaluation. This keeps
 * the pointwise mathematics identical while avoiding material and layer
 * resolution work at every plotted wavelength.
 *
 * The returned evaluator takes a wavelength and, optionally, which side of a
 * table knot to read there; reading `knotWavelengths` on it lists every interior
 * knot the stack's materials contribute, which is where that choice matters.
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
    const evaluate = (wavelengthNm, knotSide) => evaluateStackPhaseDispersion({
        wavelengthNm,
        thetaDeg,
        polarization,
        target,
        incidentMaterial,
        substrateMaterial,
        layers,
        knotSide,
    });
    // Gathering the knots walks every table the stack uses, which is wasted on
    // the callers that never ask for them: the live optimizer preview and the
    // report both evaluate wavelength by wavelength. Built on first read and
    // kept after that.
    const stack = [incidentMaterial, substrateMaterial, ...layers.map(layer => layer.material)];
    let knotWavelengths = null;
    Object.defineProperty(evaluate, 'knotWavelengths', {
        get() {
            if (!knotWavelengths) {
                knotWavelengths = [...new Set(stack.flatMap(
                    material => materialKnotWavelengths(material)))]
                    .sort((left, right) => left - right);
            }
            return knotWavelengths;
        },
    });
    return evaluate;
}
