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
 *     materialSwaps: { [material]: other },   each layer of that material made of the other
 *     cone: { enabled, halfAngleDeg, ... },   the cone of incidence, each field over environment 1's
 *     mfEvalMode,                             'side' or 'total', as the design's own
 *     temperatureC }                          °C (environmentTemperature.js)
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
import { coneIsActive, makeConeSpec } from '../physics/optimizer/coneAngle/spec.js';
import { resolveEvalMode } from '../physics/optimizer/evalCore/tmmEval.js';
import {
    designMaterialOf, materialsLackingConstants, stressAtTemperature, temperatureChange, temperatureEffects,
} from './environmentTemperature.js';

/** The id of environment 1. */
export const BASE_ENVIRONMENT = 'base';

/** Every environment that is on, as a result call's `env` and a window's All name them. */
export const ALL_ENVIRONMENTS = 'all';

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

/**
 * The environments a result for every environment covers, each `{ env, number }`
 * with its number from 1: every environment that is on, in order, or
 * environment 1 alone when none is.
 */
export function environmentsInAll(design) {
    const numbered = environmentsOf(design).map((env, i) => ({ env, number: i + 1 }));
    const on = numbered.filter(({ env }) => isEnvironmentOn(env));
    return on.length ? on : numbered.slice(0, 1);
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

// The thickness factor of a layer of material `named` in the layer list, in
// environment entry `env`, and the material it is made of there: the factor
// and the swap keyed by that material, and at a temperature of its own
// (`effects`, temperatureEffects) the film's change of thickness and its
// material at that temperature. The factor is undefined where nothing scales
// the layer.
function depositedAs(env, named, effects) {
    const factor = valueFor(env.thicknessFactors, named);
    const material = valueFor(env.materialSwaps, named) ?? named;
    const film = effects?.film(material);
    if (!film) return { factor, material };
    return { factor: (factor ?? 1) * film.thicknessFactor, material: film.id };
}

// `layers` as the environment deposits them (depositedAs).
function layersIn(layers, env, effects) {
    if (!env.thicknessFactors && !env.materialSwaps && !effects) return layers;
    return layers.map(layer => {
        const { factor, material } = depositedAs(env, layer.material, effects);
        if (factor === undefined && material === layer.material) return layer;
        return {
            ...layer,
            ...(factor !== undefined ? { thickness: layer.thickness * factor } : {}),
            ...(material !== layer.material ? { material } : {}),
        };
    });
}

// The media and the substrate environment entry `env` computes with, as named.
function setupIn(design, env) {
    return {
        incidentMedium: env.incidentMedium ?? design.incidentMedium,
        exitMedium: env.exitMedium ?? design.exitMedium,
        substrate: env.substrate ? { ...design.substrate, ...env.substrate } : design.substrate,
    };
}

// What a temperature of environment entry `env` makes of the films and of the
// substrate `substrate` (temperatureEffects), with the change itself as
// `deltaT`, K; null when it is environment 1's.
function effectsIn(design, env, substrate, resolve) {
    const deltaT = temperatureChange(design, env);
    if (deltaT === 0) return null;
    return { deltaT, ...temperatureEffects(deltaT, substrate.material, resolve ?? designMaterialOf(design)) };
}

// `substrate` at the temperature `effects` describes.
function substrateIn(substrate, effects) {
    const { thicknessFactor, id } = effects.substrate;
    return { ...substrate, material: id, thickness: (substrate.thickness ?? 1.0) * thicknessFactor };
}

// The fields of `design` environment entry `env` changes at the temperature
// `effects` describes, besides its layers: its substrate, its temperature and,
// where the design states them, its stress run temperatures.
function heatedFields(design, env, substrate, effects) {
    return {
        substrate: substrateIn(substrate, effects),
        temperatureC: env.temperatureC,
        ...(design.stress ? { stress: stressAtTemperature(design.stress, effects.deltaT) } : {}),
    };
}

/**
 * `design` as environment `id` computes it: its media, its substrate, its
 * layers, its cone of incidence and its back side with the environment's
 * fields applied, and at the environment's temperature its layers, its
 * substrate and its stress run temperatures as environmentTemperature.js
 * makes them. `resolve(materialId)`
 * gives the material a constant of the temperature model is read from, the
 * design's own resolution when not given; a calculation passes its own, so a
 * worker reads the constants from its tables. For environment 1, and so for
 * every design without environments, the same object it was given.
 *
 * @throws an id the design has no environment for
 */
export function environmentDesign(design, id = BASE_ENVIRONMENT, resolve = null) {
    if (id === BASE_ENVIRONMENT) return design;
    const env = environmentById(design, id);
    if (!env) throw new Error(`This design has no environment ${id}.`);
    const setup = setupIn(design, env);
    const effects = effectsIn(design, env, setup.substrate, resolve);
    return {
        ...design,
        ...setup,
        frontLayers: layersIn(design.frontLayers || [], env, effects),
        backLayers: layersIn(design.backLayers || [], env, effects),
        ...(effects ? heatedFields(design, env, setup.substrate, effects) : {}),
        ...(env.cone ? { cone: { ...design.cone, ...env.cone } } : {}),
        ...(env.mfEvalMode ? { mfEvalMode: env.mfEvalMode } : {}),
    };
}

/**
 * How environment `id` deposits a layer the layer list makes of a material, as
 * environmentDesign applies it: `deposit(named)` gives `{ factor, material }`,
 * the factor a layer of material `named` is thickened by there (the thickness
 * factor of its material times the change its temperature makes, 1 where
 * nothing scales it) and the id of the material it is made of there (its swap,
 * at the environment's temperature; `named` itself where neither changes it).
 * `resolve` as environmentDesign's.
 */
export function environmentDeposit(design, id, resolve = null) {
    const env = environmentById(design, id);
    const effects = id === BASE_ENVIRONMENT ? null : effectsIn(design, env, setupIn(design, env).substrate, resolve);
    return (named) => {
        const { factor, material } = depositedAs(env, named, effects);
        return { factor: factor ?? 1, material };
    };
}

/**
 * The factor each of `layers`, as the layer list holds them, is thickened by
 * in environment `id` (environmentDeposit).
 */
export function environmentLayerFactors(design, id, layers, resolve = null) {
    const deposit = environmentDeposit(design, id, resolve);
    return layers.map(layer => deposit(layer.material).factor);
}

/** The cone of incidence environment `id` computes with, or undefined for none. */
export function environmentCone(design, id = BASE_ENVIRONMENT) {
    const own = id === BASE_ENVIRONMENT ? null : environmentById(design, id)?.cone;
    return own ? { ...design.cone, ...own } : design.cone;
}

// The layers of the coatings environment `id` evaluates, by its evaluation
// mode (tmmEval.js resolveEvalMode): the front, the back, or both.
function evaluatedLayers(design, id) {
    const mode = resolveEvalMode(environmentMedia(design, id));
    return [...(mode === 'back' ? [] : design.frontLayers || []), ...(mode === 'front' ? [] : design.backLayers || [])];
}

// `(id) => id` that gives every id of one material the first of its spellings
// it was given (canonicalMaterialId).
function firstSpelling() {
    const seen = new Map();
    return id => {
        const key = canonicalMaterialId(id);
        if (!seen.has(key)) seen.set(key, id);
        return seen.get(key);
    };
}

/**
 * The materials environment `id` computes with at its temperature that lack a
 * constant of the temperature model, each `{ id, missing }`
 * (environmentTemperature.js materialsLackingConstants): the films of the
 * coatings it evaluates, as they are made there, and its substrate. A
 * material named by two spellings of its id is one entry, under the spelling
 * the films use first. Empty for environment 1, and for an environment at
 * environment 1's temperature, where the model changes nothing.
 */
export function constantsMissingIn(design, id) {
    const env = environmentById(design, id);
    if (id === BASE_ENVIRONMENT || temperatureChange(design, env) === 0) return [];
    const spelled = firstSpelling();
    const films = evaluatedLayers(design, id).map(layer => spelled(valueFor(env.materialSwaps, layer.material) ?? layer.material));
    return materialsLackingConstants(design, films, spelled(setupIn(design, env).substrate.material));
}

/**
 * True when the merit of `design` computes under a cone of incidence:
 * environment 1's cone, or that of another environment that is on.
 */
export function meritUnderCone(design) {
    return environmentsOf(design).some((env, i) => (i === 0 || isEnvironmentOn(env))
        && coneIsActive(makeConeSpec(environmentCone(design, env.id) || {})));
}

/**
 * `design` with the media and the substrate environment `id` computes with,
 * as named, and its back side, and its own layers: the layer list is the
 * recipe and reads the same in every environment. For environment 1 the same
 * object it was given.
 *
 * @throws an id the design has no environment for
 */
export function environmentMedia(design, id = BASE_ENVIRONMENT) {
    if (id === BASE_ENVIRONMENT) return design;
    const env = environmentById(design, id);
    if (!env) throw new Error(`This design has no environment ${id}.`);
    return { ...design, ...setupIn(design, env), ...(env.mfEvalMode ? { mfEvalMode: env.mfEvalMode } : {}) };
}

/**
 * `design` as environment `id` computes it (environmentDesign), written as a
 * design without environments: every calculation then takes it as a design
 * with one environment. A design without environments is returned as it is.
 */
export function oneEnvironmentDesign(design, id = BASE_ENVIRONMENT, resolve = null) {
    if (id === BASE_ENVIRONMENT && !hasEnvironments(design)) return design;
    // eslint-disable-next-line no-unused-vars
    const { environments, ...own } = environmentDesign(design, id, resolve);
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
