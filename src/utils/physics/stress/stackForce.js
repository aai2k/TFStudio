/**
 * The bending force a coated substrate carries, read off an evaluation
 * context, and how that force moves with each optimization variable.
 *
 * F = Σ σ_l d_l (Klein 2001 Eq. 14) is the quantity Stoney's equation turns
 * into a curvature, so nulling it is the zero-deflection condition of Klein
 * 2001 Eq. (34). Both the STR merit operand and the stress analysis window read
 * it here, which is what makes the force the operand minimizes the same force
 * the window bends the substrate with.
 *
 * Units: stress in Pa and thickness in m inside, so the force comes out in N/m.
 * A layer's thickness arrives in nm, as everywhere else in the design.
 *
 * Sign: the front coating pulls on the front face and the back coating on the
 * back, so their bending moments oppose and the net force is F_front − F_back.
 * A coating mirrored onto the back therefore nulls it exactly.
 */

import { filmStressPa } from './filmStress.js';

const NM = 1e-9;

/** Both temperatures of a run default to this when the design states neither. */
export const DEFAULT_STRESS_TEMPERATURE_C = 20;

const stated = value => typeof value === 'number' && Number.isFinite(value);

/**
 * The temperatures a stress evaluation runs at, or null when the design states
 * none. Without them a film carries its intrinsic stress and nothing else.
 */
export function stressRun(ctx) {
    const stress = ctx?.stress;
    if (!stress) return null;
    return {
        temperatureC: stated(stress.temperatureC) ? stress.temperatureC : DEFAULT_STRESS_TEMPERATURE_C,
        depositionTemperatureC: stated(stress.depositionTemperatureC)
            ? stress.depositionTemperatureC
            : DEFAULT_STRESS_TEMPERATURE_C,
        substrateExpansionPerK: ctx?.nsmat?.mechanical?.linearExpansionPerK,
    };
}

/**
 * Stress in one layer, Pa, for the force sum.
 *
 * A material that states no intrinsic stress contributes nothing: the thermal
 * terms are a correction to a measured stress, and on their own they would put
 * a force on the substrate from a film nobody measured. The caller names such a
 * material instead of substituting for it.
 */
export function layerStressPa(material, run) {
    const mechanical = material?.mechanical;
    if (!stated(mechanical?.intrinsicStressMPa)) return 0;
    const stressPa = filmStressPa(mechanical, run);
    return stated(stressPa) ? stressPa : 0;
}

/** True where the material states the intrinsic stress the force sum needs. */
export function statesStress(material) {
    return stated(material?.mechanical?.intrinsicStressMPa);
}

// Which optimization variable drives a layer, per surface mode. -1 means the
// side is held fixed and the layer contributes a constant to the force.
// Symmetric mirrors: back layer j is front layer (nFront − 1 − j), since the
// front stack is stored air→substrate and the back stack substrate→exit.
const VARIABLE_INDEX = {
    front_only:       { front: j => j,       back: () => -1 },
    back_only:        { front: () => -1,     back: j => j },
    symmetric:        { front: j => j,       back: (j, nFront) => nFront - 1 - j },
    both_independent: { front: j => j,       back: (j, nFront) => nFront + j },
};

// Which coatings count, from the evaluation mode: the active side alone when
// the other one is ignored, both otherwise. The same rule every analysis window
// follows.
function countedSides(mode, evalFullSystem) {
    if (evalFullSystem || mode === 'symmetric' || mode === 'both_independent') {
        return { front: true, back: true };
    }
    return { front: mode !== 'back_only', back: mode === 'back_only' };
}

/**
 * Every counted layer as `{ stressPa, thicknessM, variable }`: its stress with
 * the sign its side contributes, its thickness, and the optimization variable
 * that drives it, or -1 where its side is held fixed.
 */
function countedLayers(ctx) {
    const mode = ctx?.surfaceMode || 'front_only';
    const layout = VARIABLE_INDEX[mode] || VARIABLE_INDEX.front_only;
    const sides = countedSides(mode, !!ctx?.evalFullSystem);
    const run = stressRun(ctx);
    const nFront = ctx?.frontThicks?.length || 0;
    const layers = [];
    const walk = (side, sign, thicks, mats, variableIndex) => {
        if (!sides[side]) return;
        for (let j = 0; j < (thicks?.length || 0); j++) {
            layers.push({
                stressPa: sign * layerStressPa(mats?.[j], run),
                thicknessM: (thicks[j] || 0) * NM,
                variable: variableIndex(j, nFront),
            });
        }
    };
    walk('front', 1, ctx?.frontThicks, ctx?.frontMats, layout.front);
    walk('back', -1, ctx?.backThicks, ctx?.backMats, layout.back);
    return layers;
}

/** Net bending force per unit width, N/m: F_front − F_back over the counted sides. */
export function stressForceNm(ctx) {
    let force = 0;
    for (const layer of countedLayers(ctx)) force += layer.stressPa * layer.thicknessM;
    return force;
}

/**
 * ∂F/∂d, N/m per nm, one entry per optimization variable in the order the
 * thickness vector holds them. The force is linear in every thickness, so this
 * is exact and constant across a step. In symmetric mode each front layer and
 * its mirror cancel, leaving every entry zero: a mirrored coating cannot bend
 * the substrate however thick it grows.
 */
export function stressCoefficientsNm(ctx) {
    const variables = (ctx?.fullThicks || ctx?.frontThicks || []).length;
    const coefficients = new Array(variables).fill(0);
    for (const layer of countedLayers(ctx)) {
        if (layer.variable >= 0 && layer.variable < variables) {
            coefficients[layer.variable] += layer.stressPa * NM;
        }
    }
    return coefficients;
}

/**
 * Which of the two coatings the force counts, for a caller that holds a design
 * rather than an evaluation context. `evalMode` is what `resolveEvalMode`
 * returns: 'front', 'back' or 'total'.
 */
export function stressCountedSides(surfaceMode, evalMode) {
    return countedSides(surfaceMode || 'front_only', evalMode === 'total');
}
