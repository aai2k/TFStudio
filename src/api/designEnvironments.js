// A design's environments as the API lists and edits them: the other
// conditions the same coating is used in, such as another substrate, the
// coating under water, or a chamber position where the films grow thinner.
// src/utils/environments/environments.js describes what each one holds.

import {
    constantsMissingIn, environmentCone, environmentDesign, environmentMedia, environmentsInAll, environmentsOf, isEnvironmentOn, BASE_ENVIRONMENT,
} from '../utils/environments/environments.js';
import * as edits from '../utils/environments/environmentEdits.js';
import { designTemperature } from '../utils/environments/environmentTemperature.js';
import { designMaterialName } from '../utils/materials/designMaterials.js';
import { requireMaterial } from './materials.js';
import { checkOptions, requireValue, isAngle, isBoolean, isPositive, refusal, shown } from './check.js';

// The options an environment takes, by setDesignSetup's names where they
// overlap. Environment 1 takes the first two; the rest of it is the design's
// own fields.
const OPTIONS = [
    'name', 'enabled', 'incidentMedium', 'exitMedium', 'substrate', 'substrateThicknessMm', 'thicknessFactors', 'materialSwaps',
    'cone', 'mfEvalMode', 'temperatureC',
];
const BASE_OPTIONS = ['name', 'enabled'];
// The options an environment takes from environment 1 while it sets none of
// its own, each with where the environment holds its own.
const FOLLOWED = {
    incidentMedium: env => env.incidentMedium,
    exitMedium: env => env.exitMedium,
    substrate: env => env.substrate?.material,
    substrateThicknessMm: env => env.substrate?.thickness,
    cone: env => env.cone,
    mfEvalMode: env => env.mfEvalMode,
    temperatureC: env => env.temperatureC,
};
const FOLLOW = 'or null to follow environment 1';

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** How a one-sided design is scored: its coated side alone, or as the whole part. */
export const EVAL_MODES = ['side', 'total'];
const EVAL_MODES_TAKE = "'side' (a one-sided design scored on its coated side alone) or 'total' (as the whole part)";

/** A temperature the API takes, °C. */
export const isTemperature = v => Number.isFinite(v) && v > -273.15;

// The parts of a cone of incidence, each with its check and what it takes.
const CONE_PARTS = {
    enabled: [isBoolean, 'true or false'],
    halfAngleDeg: [isAngle, 'a half-angle in degrees from the axis, 0 up to but not including 90'],
    distribution: [v => ['uniform', 'lambertian', 'user'].includes(v), "'uniform', 'lambertian' or 'user'"],
    gridPoints: [v => Number.isInteger(v) && v >= 2 && v <= 200, 'a whole number of angles from 2 to 200'],
    userTable: [v => Array.isArray(v) && v.length > 0 && v.every(p => Number.isFinite(p?.theta) && Number.isFinite(p?.intensity)),
        'a list of { theta, intensity }, theta in degrees from the axis'],
};

/**
 * Refuses a cone of incidence that is not an object of its parts, or a part
 * that is not what it takes. With `follows`, a part given null is taken: an
 * environment's part that follows environment 1's again.
 */
export function requireCone(call, option, cone, follows = false) {
    const parts = Object.keys(CONE_PARTS);
    requireValue(call, option, cone, v => isMap(v) && Object.keys(v).every(part => parts.includes(part)),
        `an object of any of ${parts.join(', ')}${follows ? `, ${FOLLOW}` : ', or null for none'}`);
    for (const [part, value] of Object.entries(cone)) {
        if (value === null && follows) continue;
        const [ok, takes] = CONE_PARTS[part];
        requireValue(call, option, cone, () => ok(value), `an object whose ${part} is ${takes}`);
    }
}
const isName = v => v === null || (typeof v === 'string' && v.trim() !== '');
const isMaterialId = v => typeof v === 'string' && v !== '';
const orList = items => (items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);

// Refuses a material option that is not an id or null, and an id that
// resolves to nothing.
const materialCheck = option => (call, design, value) => {
    requireValue(call, option, value, v => v === null || isMaterialId(v), `a material id, ${FOLLOW}`);
    if (value !== null) requireMaterial(design, value);
};

// Refuses a map of material id to `what` that is not one, and a material it
// names that resolves to nothing. A material given null needs no check, so a
// factor or a swap of a material that no longer resolves can still be taken out.
const mapCheck = (option, isValue, what) => (call, design, map) => {
    const takes = `a map of material id to ${what}, or to null to follow environment 1; or null for none`;
    requireValue(call, option, map, m => m === null || (isMap(m) && Object.values(m).every(v => v === null || isValue(v))), takes);
    for (const [id, value] of Object.entries(map || {})) {
        if (value === null) continue;
        requireMaterial(design, id);
        if (option === 'materialSwaps') requireMaterial(design, value);
    }
};

const CHECKS = {
    name: (call, design, value) => requireValue(call, 'name', value, isName, 'a name, or null for none'),
    enabled: (call, design, value) => requireValue(call, 'enabled', value, isBoolean, 'true or false'),
    incidentMedium: materialCheck('incidentMedium'),
    exitMedium: materialCheck('exitMedium'),
    substrate: materialCheck('substrate'),
    substrateThicknessMm: (call, design, value) => requireValue(call, 'substrateThicknessMm', value, v => v === null || isPositive(v), `a thickness in mm above 0, ${FOLLOW}`),
    thicknessFactors: mapCheck('thicknessFactors', isPositive, 'a factor above 0'),
    materialSwaps: mapCheck('materialSwaps', isMaterialId, 'the material id that replaces it'),
    cone: (call, design, value) => { if (value !== null) requireCone(call, 'cone', value, true); },
    mfEvalMode: (call, design, value) => requireValue(call, 'mfEvalMode', value, v => v === null || EVAL_MODES.includes(v), `${EVAL_MODES_TAKE}, ${FOLLOW}`),
    temperatureC: (call, design, value) => requireValue(call, 'temperatureC', value, v => v === null || isTemperature(v), `a temperature in °C above -273.15, ${FOLLOW}`),
};

// `options` after refusing a name no environment takes; an option given as
// undefined is no option.
const givenOptions = (call, options) => Object.fromEntries(Object.entries(checkOptions(call, options, OPTIONS)).filter(([, value]) => value !== undefined));

// `given` after refusing a value an option cannot take.
function checkedValues(call, design, given) {
    for (const [option, value] of Object.entries(given)) CHECKS[option](call, design, value);
    return given;
}

// The options as an environment stores them: substrate and
// substrateThicknessMm are the material and the thickness of its `substrate`.
function storedFields({ substrate, substrateThicknessMm, ...fields }) {
    const held = {
        ...(substrate !== undefined ? { material: substrate } : {}),
        ...(substrateThicknessMm !== undefined ? { thickness: substrateThicknessMm } : {}),
    };
    return Object.keys(held).length ? { ...fields, substrate: held } : fields;
}

/**
 * The id of the environment `environment` names, by its id or its number from
 * 1, or a refusal that lists the numbers and ids the design has. `fields` go
 * into the refusal's fields, `named` names what was given in its message, and
 * `also` is what else it takes, said before the environments.
 */
export function environmentId(call, design, environment, { fields = {}, named = `${call}: environment`, also = null } = {}) {
    const list = environmentsOf(design);
    const found = Number.isInteger(environment) ? list[environment - 1] : list.find(env => env.id === environment);
    if (found) return found.id;
    const ids = list.map(env => env.id);
    const numbers = ids.map((_, i) => i + 1);
    throw refusal('unknownEnvironment', { call, ...fields, environment, numbers, ids },
        `${named} is ${also ? `${also} or ` : ''}one of the design's environments by its number, ${numbers.length === 1 ? '1' : `1 to ${numbers.length}`}, or its id, ${orList(ids)}; not ${shown(environment)}`);
}

/**
 * What a result call gives for its `env` option, `compute(design)` being the
 * call's own result on a design: without `env`, its result on the design
 * itself, which is environment 1; with an environment's number or id, its
 * result on the design that environment computes, switched on or off; with
 * `'all'`, `{ environments }`, one entry per environment that is on
 * (environment 1 when none is), each the call's own result with the
 * environment's `number`, `id` and `name`. An environment the design does not
 * have is refused with `unknownEnvironment`.
 */
export function inEnvironments(call, design, env, compute) {
    if (env === undefined) return compute(design);
    if (env !== 'all') {
        return compute(environmentDesign(design, environmentId(call, design, env, { fields: { option: 'env' }, named: `${call}: env`, also: "'all'" })));
    }
    return {
        environments: environmentsInAll(design).map(({ env: one, number }) => ({
            number, id: one.id, name: one.name ?? null, ...compute(environmentDesign(design, one.id)),
        })),
    };
}

/**
 * The environments of a design, in order: environment 1, the design's own
 * media, substrate, cone of incidence, other side and temperature, then each
 * other condition the design is used in. A design without environments has
 * environment 1 alone. An environment computes with environment 1's value of
 * whatever it does not set of its own, and with environment 1's cone in each
 * part of the cone it does not set.
 *
 * @param design The design.
 * @returns One entry per environment, environment 1 first, each with these fields.
 * @property number The environment's number, from 1.
 * @property id Its id, which the other environment calls take as well as its number; environment 1's is `'base'`.
 * @property name Its name, or null.
 * @property enabled False for an environment switched off.
 * @property incidentMedium The medium the light comes from in this environment, by material id: its own, or environment 1's.
 * @property exitMedium The medium behind the substrate, by material id: its own, or environment 1's.
 * @property substrate `{ material, thickness }`, the thickness in mm: its own, or environment 1's, each apart.
 * @property thicknessFactors Its own factors, `{ [material id]: factor }`: each layer of that material is that many times as thick here. `{}` when it has none.
 * @property materialSwaps Its own swaps, `{ [material id]: other id }`: each layer of that material is made of the other here. `{}` when it has none.
 * @property cone The cone of incidence it computes with, `{ enabled, halfAngleDeg, distribution, gridPoints, userTable }` with the parts set, or null when neither it nor environment 1 has one.
 * @property mfEvalMode How it scores a one-sided design: `'side'`, the coated side alone, or `'total'`, the whole part.
 * @property temperatureC The temperature it is at, °C: environment 1's is the design's `temperatureC`, 20 when the design has none.
 * @property constantsMissing At a temperature other than environment 1's, the materials the Environments window names under the temperature: each film of the coatings it evaluates, or its substrate, that lacks a constant of the temperature model, `{ material, name, fields }`: material by id, and fields the constants it lacks by their names on the material's `mechanical` record (`'linearExpansionPerK'`, `'poissonsRatio'`, `'dnDtPerK'`), a constant being given only as a finite number. Each material is listed once, under the id the films name it by first. A film lacking its expansion or its Poisson's ratio, or on a substrate lacking its expansion, is taken as unstrained; another constant missing counts as 0. `[]` for environment 1 and at environment 1's temperature.
 * @property follows The options it takes from environment 1, by addEnvironment's names: any of `'incidentMedium'`, `'exitMedium'`, `'substrate'`, `'substrateThicknessMm'`, `'cone'`, `'mfEvalMode'` and `'temperatureC'`. `[]` for environment 1.
 * @example
 * const design = tf.addEnvironment(tf.newDesign({ name: 'Window AR' }), { name: 'Under water', incidentMedium: 'H2O' });
 * for (const env of tf.environments(design)) console.log(env.number, env.name, env.incidentMedium, env.substrate.material, env.follows.join(', '));
 */
export function environments(design) {
    return environmentsOf(design).map((env, i) => {
        const named = environmentMedia(design, env.id);
        const cone = environmentCone(design, env.id);
        return {
            number: i + 1, id: env.id, name: env.name ?? null, enabled: isEnvironmentOn(env),
            incidentMedium: named.incidentMedium, exitMedium: named.exitMedium,
            substrate: { material: named.substrate.material, thickness: named.substrate.thickness },
            thicknessFactors: { ...(env.thicknessFactors || {}) },
            materialSwaps: { ...(env.materialSwaps || {}) },
            cone: cone ? { ...cone } : null,
            mfEvalMode: named.mfEvalMode || 'side',
            temperatureC: env.temperatureC ?? designTemperature(design),
            constantsMissing: constantsMissingIn(design, env.id)
                .map(({ id, missing }) => ({ material: id, name: designMaterialName(design, id), fields: missing })),
            follows: env.id === BASE_ENVIRONMENT ? [] : Object.keys(FOLLOWED).filter(option => FOLLOWED[option](env) == null),
        };
    });
}

/**
 * A design with one more environment at the end. A medium, substrate,
 * thickness, cone, other side or temperature left out, or given as null,
 * follows environment 1. A factor or a swap is keyed by the material the
 * design's layers name, under either form of a built-in id (`'TiO2'` or
 * `'builtin:TiO2'`). At a temperature other than environment 1's, each layer
 * and the substrate change as the [Environments](/design/environments/) page
 * says.
 *
 * @param design The design.
 * @param [options]
 * @param [options.name] The environment's name.
 * @param [options.enabled=true] `false` switches the environment off.
 * @param [options.incidentMedium] The medium the light comes from, by material id.
 * @param [options.exitMedium] The medium behind the substrate, by material id.
 * @param [options.substrate] The substrate material, by id.
 * @param [options.substrateThicknessMm] The substrate thickness, mm, above 0.
 * @param [options.thicknessFactors] `{ [material id]: factor }`: each layer of that material is that many times as thick, a factor above 0.
 * @param [options.materialSwaps] `{ [material id]: other id }`: each layer of that material is made of the other.
 * @param [options.cone] The cone of incidence, any of `{ enabled, halfAngleDeg, distribution, gridPoints, userTable }` as setDesignSetup takes it, each part given over environment 1's cone; a part given null follows environment 1's.
 * @param [options.mfEvalMode] How a one-sided design is scored here: `'side'`, its coated side alone, or `'total'`, the whole part.
 * @param [options.temperatureC] The temperature, °C, above -273.15.
 * @returns The design with the environment added.
 * @throws an option it does not take, or a value the option cannot take
 * @throws a material id that resolves to nothing, naming the closest ids
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Window AR' }), { formula: '(HL)^2' });
 * const edge = tf.addEnvironment(design, { name: 'Dome edge', thicknessFactors: { TiO2: 0.95, SiO2: 0.97 } });
 * console.log(tf.environments(edge).length, 'environments; the last thins TiO2 to', tf.environments(edge)[1].thicknessFactors.TiO2);
 */
export function addEnvironment(design, options) {
    const call = 'addEnvironment';
    return edits.addEnvironment(design, storedFields(checkedValues(call, design, givenOptions(call, options))));
}

/**
 * A design with options set on one of its environments. A medium, substrate,
 * thickness, cone, other side or temperature given as null follows
 * environment 1 again, and a name given as null takes the name away; inside
 * `cone`, `thicknessFactors` and `materialSwaps`, a part or a material given
 * null does, and those left out keep what they had. Environment 1 is the
 * design itself: it takes `name` and `enabled` alone, and setDesignSetup
 * changes its media, substrate, cone, other side and temperature. A design
 * with one environment lists none, so its environment 1 takes neither until
 * another is added.
 *
 * @param design The design.
 * @param environment The environment, by its number from 1 or by its id.
 * @param options Any of the options of addEnvironment.
 * @returns The design with the environment changed.
 * @throws an environment the design does not have, naming the numbers and ids it has
 * @throws an option it does not take, an option other than `name` and `enabled` for environment 1, environment 1 of a design with one environment, or a value the option cannot take
 * @throws a material id that resolves to nothing, naming the closest ids
 * @example
 * let design = tf.addEnvironment(tf.newDesign({ name: 'Window AR' }), { name: 'Under water', incidentMedium: 'H2O', substrate: 'SiO2' });
 * design = tf.setEnvironment(design, 2, { substrate: null, substrateThicknessMm: 3 });
 * const water = tf.environments(design)[1];
 * console.log(water.substrate.material, water.substrate.thickness, 'mm; follows', water.follows.join(', '));
 */
export function setEnvironment(design, environment, options) {
    const call = 'setEnvironment';
    const given = givenOptions(call, options);
    const id = environmentId(call, design, environment);
    const outside = id === BASE_ENVIRONMENT && Object.keys(given).find(option => !BASE_OPTIONS.includes(option));
    if (outside) {
        throw refusal('baseEnvironment', { call, option: outside },
            `${call}: environment 1 is the design itself and takes name and enabled alone, not ${outside}; setDesignSetup changes the design's own media, substrate, cone, other side and temperature`);
    }
    const first = Object.keys(given)[0];
    if (id === BASE_ENVIRONMENT && first && environmentsOf(design).length === 1) {
        throw refusal('oneEnvironment', { call, option: first },
            `${call}: a design with one environment holds no ${first} for it; add another environment first`);
    }
    return edits.setEnvironment(design, id, storedFields(checkedValues(call, design, given)));
}

/**
 * A design without one of its environments, and without the merit rows scored
 * in that environment alone, the rows that read them and the specification
 * checks judged in it alone. With environment 1
 * left alone, the design no longer lists environments. Environment 1, the
 * design itself, cannot be removed.
 *
 * @param design The design.
 * @param environment The environment, by its number from 1 or by its id.
 * @returns The design without the environment.
 * @throws an environment the design does not have, naming the numbers and ids it has, or environment 1
 * @example
 * let design = tf.addEnvironment(tf.newDesign({ name: 'Window AR' }), { name: 'Under water', incidentMedium: 'H2O' });
 * design = tf.addEnvironment(design, { name: 'Sapphire', substrate: 'Al2O3' });
 * design = tf.removeEnvironment(design, 2);
 * console.log(tf.environments(design).map(env => `${env.number} ${env.name ?? env.id}`).join(', '));
 */
export function removeEnvironment(design, environment) {
    const call = 'removeEnvironment';
    const id = environmentId(call, design, environment);
    if (id === BASE_ENVIRONMENT) throw refusal('baseEnvironment', { call }, `${call}: environment 1 is the design itself and cannot be removed`);
    return edits.removeEnvironment(design, id);
}
