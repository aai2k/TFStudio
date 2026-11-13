/**
 * The temperature of an environment (environments.js) and what it makes of the
 * design that environment computes (temperatureModel.js).
 *
 * Environment 1 is at the design's `temperatureC`, 20 °C when it has none: the
 * temperature its layer thicknesses and its materials' n and k hold at.
 * Another environment at a temperature of its own computes each layer as a
 * film at the change of temperature from environment 1's, on that
 * environment's substrate, and the substrate at that change; the media stay as
 * they are. The constants come from each material's `mechanical` block
 * (materials/mechanical.js), each given only as a finite number. A film whose
 * material lacks its expansion or its Poisson ratio, or whose substrate lacks
 * its expansion, is taken as unstrained (temperatureModel.js
 * filmAtTemperature); any other constant a material does not carry counts as
 * 0. Where the design states the temperatures its film stress is evaluated at
 * (`stress`, the Stress window's), the environment's stress is evaluated at
 * that temperature moved by the same change.
 */
import { resolveDesignMaterial } from '../materials/designMaterials.js';
import { DEFAULT_STRESS_TEMPERATURE_C } from '../physics/stress/stackForce.js';
import {
    constantGiven, filmAtTemperature, keepsIndex, substrateAtTemperature, thermalMaterialId,
} from './temperatureModel.js';

/** The temperature, °C, of a design that states none. */
export const REFERENCE_TEMPERATURE_C = 20;

/** The constants the model reads of a film, and of a substrate. */
export const FILM_CONSTANTS = Object.freeze(['linearExpansionPerK', 'poissonsRatio', 'dnDtPerK']);
export const SUBSTRATE_CONSTANTS = Object.freeze(['linearExpansionPerK', 'dnDtPerK']);

/** The temperature environment 1 is at, °C: the design's own, 20 °C when it has none. */
export function designTemperature(design) {
    return design.temperatureC ?? REFERENCE_TEMPERATURE_C;
}

/** The change of temperature, K, from environment 1 to environment entry `env`; 0 when it sets none. */
export function temperatureChange(design, env) {
    return env.temperatureC == null ? 0 : env.temperatureC - designTemperature(design);
}

/**
 * The design's stress run temperatures `stress` (`{ temperatureC,
 * depositionTemperatureC }`, °C) for an environment `deltaT` K from
 * environment 1: the temperature the films' stress is evaluated at moves by
 * the change, its default of 20 °C included; the deposition temperature stays.
 */
export function stressAtTemperature(stress, deltaT) {
    const at = Number.isFinite(stress.temperatureC) ? stress.temperatureC : DEFAULT_STRESS_TEMPERATURE_C;
    return { ...stress, temperatureC: at + deltaT };
}

/** `(id) => material` reading the materials of `design` as every calculation reads them. */
export const designMaterialOf = design => id => resolveDesignMaterial(design, id).material;

// The model's constants of a material, by id.
const constantsOf = (resolve, id) => resolve(id)?.mechanical || {};

// A change with its thickness factor, and the id of the material at it, or
// the id it was given when the index stays.
function changed(change, id) {
    return { thicknessFactor: change.thicknessFactor, id: keepsIndex(change) ? id : thermalMaterialId(id, change) };
}

/**
 * What a change of temperature `deltaT` (K) makes on a substrate of material
 * `substrateId`, read through `resolve`: `film(id)`, the thickness factor of
 * a layer of material `id` and the id it computes with, and `substrate`, the
 * same of the substrate.
 */
export function temperatureEffects(deltaT, substrateId, resolve) {
    const substrate = constantsOf(resolve, substrateId);
    const films = new Map();
    return {
        film(id) {
            if (!films.has(id)) {
                films.set(id, changed(filmAtTemperature(constantsOf(resolve, id), substrate.linearExpansionPerK, deltaT), id));
            }
            return films.get(id);
        },
        substrate: changed(substrateAtTemperature(substrate, deltaT), substrateId),
    };
}

/**
 * The materials that lack a constant the model reads, each `{ id, missing }`,
 * `missing` the names of the constants it lacks: those of a film for each of
 * `filmIds`, those of a substrate for `substrateId`, both for a material that
 * is both. A material whose id resolves to nothing is left to the
 * missing-material notice.
 */
export function materialsLackingConstants(design, filmIds, substrateId) {
    const wanted = new Map(filmIds.map(id => [id, FILM_CONSTANTS]));
    wanted.set(substrateId, [...new Set([...(wanted.get(substrateId) || []), ...SUBSTRATE_CONSTANTS])]);
    const out = [];
    for (const [id, names] of wanted) {
        const { material, status } = resolveDesignMaterial(design, id);
        if (status === 'missing' || status === 'unset') continue;
        const missing = names.filter(name => !constantGiven(material.mechanical?.[name]));
        if (missing.length > 0) out.push({ id, missing });
    }
    return out;
}
