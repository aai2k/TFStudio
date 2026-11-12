/**
 * The environments of a design: the other conditions the same coating is used
 * in, such as another substrate, a coating under water, or a chamber position
 * where the films grow thinner.
 *
 * Environment 1 is the design's own fields: its media, its substrate and its
 * layers. `design.environments` lists every environment in order. Its first
 * entry, id `base`, is environment 1 and holds only its name and its switch.
 * Each later entry holds the fields it sets and nothing else, and a field it
 * lacks reads as environment 1's:
 *
 *   { id, name, enabled,
 *     incidentMedium, exitMedium,             material ids
 *     substrate: { material, thickness },     thickness in mm
 *     thicknessFactors: { [material]: f },    each layer of that material f times as thick
 *     materialSwaps: { [material]: other } }  each layer of that material made of the other
 *
 * `enabled` is written only as false. A design with no `environments` key has
 * one environment, as has every design written before environments existed. A
 * merit row with `env` is scored in that environment alone; a row without it,
 * in every environment.
 *
 * Plain functions over the design object: the windows, the workers and the API
 * read environments through them alike.
 */
import { MATERIAL_MAP } from '../materials/materialDatabase.js';

/** The id of environment 1. */
export const BASE_ENVIRONMENT = 'base';

const ONLY_BASE = Object.freeze([Object.freeze({ id: BASE_ENVIRONMENT })]);

/** Every environment of `design` in order, environment 1 first; one for a design that lists none. */
export function environmentsOf(design) {
    const list = design?.environments;
    return Array.isArray(list) && list.length > 0 ? list : ONLY_BASE;
}

/** True when `design` has more than one environment. */
export function hasEnvironments(design) {
    return environmentsOf(design).length > 1;
}

/** The environment of `design` with id `id`, or null. */
export function environmentById(design, id) {
    return environmentsOf(design).find(env => env.id === id) ?? null;
}

/** True when the environment is switched on, which is what it is unless written otherwise. */
export function isEnvironmentOn(env) {
    return env.enabled !== false;
}

/** The merit rows of `design` scored in environment `id`: its own rows and the rows of every environment. */
export function rowsInEnvironment(design, id) {
    return (design?.meritOperands || []).filter(op => op.env == null || op.env === id);
}

/** Merit row `op` scored in environment `env` alone, or, with `env` null, in every environment. */
export function rowInEnvironment(op, env = null) {
    // eslint-disable-next-line no-unused-vars
    const { env: _env, ...row } = op;
    return env == null ? row : { ...row, env };
}

/**
 * One spelling of a material id. A layer names a built-in material either as
 * `builtin:TiO2` or, in designs saved before compound ids, as `TiO2`; both are
 * the same material, so a factor or a swap written under one applies to
 * layers written with the other.
 */
export function canonicalMaterialId(id) {
    return typeof id === 'string' && !id.includes(':') && id in MATERIAL_MAP ? `builtin:${id}` : id;
}

/** True when two ids name the same material. */
export function sameMaterial(a, b) {
    return canonicalMaterialId(a) === canonicalMaterialId(b);
}

/** The value `map`, keyed by material id, gives material `id`, whichever spelling of the id it was written under. */
export function valueFor(map, id) {
    if (!map) return undefined;
    if (map[id] !== undefined) return map[id];
    const wanted = canonicalMaterialId(id);
    const key = Object.keys(map).find(other => canonicalMaterialId(other) === wanted);
    return key === undefined ? undefined : map[key];
}

// `layers` as the environment deposits them: a factor scales each layer of its
// material and a swap replaces that material, both keyed by the material the
// layer list names.
function layersIn(layers, env) {
    const { thicknessFactors: factors, materialSwaps: swaps } = env;
    if (!factors && !swaps) return layers;
    return layers.map(layer => {
        const factor = valueFor(factors, layer.material);
        const swap = valueFor(swaps, layer.material);
        if (factor === undefined && swap === undefined) return layer;
        return {
            ...layer,
            ...(factor !== undefined ? { thickness: layer.thickness * factor } : {}),
            ...(swap !== undefined ? { material: swap } : {}),
        };
    });
}

/**
 * `design` as environment `id` computes it: its media, its substrate and its
 * layers with the environment's fields applied. For environment 1, and so for
 * every design without environments, the same object it was given.
 *
 * @throws an id the design has no environment for
 */
export function environmentDesign(design, id = BASE_ENVIRONMENT) {
    if (id === BASE_ENVIRONMENT) return design;
    const env = environmentById(design, id);
    if (!env) throw new Error(`This design has no environment ${id}.`);
    return {
        ...design,
        incidentMedium: env.incidentMedium ?? design.incidentMedium,
        exitMedium: env.exitMedium ?? design.exitMedium,
        substrate: env.substrate ? { ...design.substrate, ...env.substrate } : design.substrate,
        frontLayers: layersIn(design.frontLayers || [], env),
        backLayers: layersIn(design.backLayers || [], env),
    };
}

/**
 * `design` with the media and the substrate environment `id` computes with,
 * and its own layers: the layer list is the recipe and reads the same in every
 * environment. For environment 1 the same object it was given.
 *
 * @throws an id the design has no environment for
 */
export function environmentMedia(design, id = BASE_ENVIRONMENT) {
    if (id === BASE_ENVIRONMENT) return design;
    const seen = environmentDesign(design, id);
    return { ...design, incidentMedium: seen.incidentMedium, exitMedium: seen.exitMedium, substrate: seen.substrate };
}

/**
 * `design` as environment `id` computes it (environmentDesign), written as a
 * design without environments: every calculation then takes it as a design
 * with one environment. A design without environments is returned as it is.
 */
export function oneEnvironmentDesign(design, id = BASE_ENVIRONMENT) {
    if (id === BASE_ENVIRONMENT && !hasEnvironments(design)) return design;
    // eslint-disable-next-line no-unused-vars
    const { environments, ...own } = environmentDesign(design, id);
    return own;
}

/** The material ids environments 2 and later name: their media, substrates and swaps. */
export function environmentMaterialIds(design) {
    return environmentsOf(design).slice(1).flatMap(env => [
        env.incidentMedium,
        env.exitMedium,
        env.substrate?.material,
        ...Object.values(env.materialSwaps || {}),
    ]).filter(Boolean);
}
