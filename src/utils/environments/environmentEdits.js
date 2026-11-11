/**
 * Edits to a design's environments (environments.js describes them). Each
 * returns a new design and leaves the one it was given as it was.
 *
 * Environment 1's media, substrate and layers are the design's own fields,
 * which the Design Editor and the API already edit; here environment 1 takes
 * a name and a switch only. A design brought back to one environment is
 * written as a design without environments: no `environments` key and no
 * `env` on any row.
 */
import { removeOperandsAndDependents } from '../physics/optimizer/operandModel.js';
import { BASE_ENVIRONMENT, environmentById, hasEnvironments, sameMaterial } from './environments.js';

/** The fields an environment of its own (2 or later) can set. */
export const ENVIRONMENT_FIELDS = Object.freeze([
    'name', 'enabled', 'incidentMedium', 'exitMedium', 'substrate', 'thicknessFactors', 'materialSwaps',
]);
const BASE_FIELDS = new Set(['name', 'enabled']);
const KEYED_BY_MATERIAL = new Set(['thicknessFactors', 'materialSwaps']);

// The design's environments as a list the edits can extend: its own, or
// environment 1 alone.
const listOf = design => (Array.isArray(design.environments) && design.environments.length > 0
    ? design.environments
    : [{ id: BASE_ENVIRONMENT }]);

// An id no environment of the design has: env2, env3, and so on, one past the
// highest number in use.
function nextEnvironmentId(list) {
    const used = list.map(env => /^env(\d+)$/.exec(env.id)).filter(Boolean).map(match => Number(match[1]));
    return `env${Math.max(1, ...used) + 1}`;
}

// `map` with `changes` applied key by key, a null removing its key; null when
// nothing is left. `same` says whether two keys name one thing, so a factor
// or a swap set under one spelling of a material replaces the other spelling.
function mergedMap(map, changes, same) {
    const merged = { ...(map || {}) };
    for (const [key, value] of Object.entries(changes)) {
        for (const other of Object.keys(merged)) if (same(other, key)) delete merged[other];
        if (value !== null) merged[key] = value;
    }
    return Object.keys(merged).length > 0 ? merged : null;
}

const sameKey = (a, b) => a === b;

// A value that is not written: null, a switch that is on, an empty name.
const isDefault = (key, value) => value === null || (key === 'enabled' && value === true) || (key === 'name' && value === '');

// The value `given` for field `key` leaves on an environment whose field holds `held`.
function fieldValue(key, given, held) {
    if (given === null) return null;
    if (key === 'substrate') return mergedMap(held, given, sameKey);
    if (KEYED_BY_MATERIAL.has(key)) return mergedMap(held, given, sameMaterial);
    return given;
}

// `entry` with `fields` applied. Null gives a field back to environment 1
// (or, for name and enabled, to their default); inside substrate, the factors
// and the swaps it does so key by key. An empty object left behind goes too.
function withFields(entry, fields) {
    const next = { ...entry };
    for (const [key, given] of Object.entries(fields)) {
        const value = fieldValue(key, given, next[key]);
        if (isDefault(key, value)) delete next[key];
        else next[key] = value;
    }
    return next;
}

function checkFields(id, fields) {
    const allowed = id === BASE_ENVIRONMENT ? BASE_FIELDS : new Set(ENVIRONMENT_FIELDS);
    const refused = Object.keys(fields).filter(key => !allowed.has(key));
    if (refused.length === 0) return;
    throw new Error(id === BASE_ENVIRONMENT
        ? `Environment 1 takes a name and a switch; its ${refused.join(', ')} are the design's own fields.`
        : `An environment has no field ${refused.join(', ')}.`);
}

/**
 * `design` with one more environment at the end, holding `fields`. A design
 * without environments gains environment 1 first.
 */
export function addEnvironment(design, fields = {}) {
    const list = listOf(design);
    const id = nextEnvironmentId(list);
    checkFields(id, fields);
    return { ...design, environments: [...list, withFields({ id }, fields)] };
}

/**
 * `design` with `fields` set on environment `id`. A field given as null
 * follows environment 1 again; in `substrate`, `thicknessFactors` and
 * `materialSwaps`, one entry given as null does. A design with one
 * environment lists none, so its environment 1 has no name or switch to set.
 *
 * @throws an id the design has no environment for, a field environment `id` cannot set, or environment 1 of a design with one environment
 */
export function setEnvironment(design, id, fields) {
    if (!environmentById(design, id)) throw new Error(`This design has no environment ${id}.`);
    checkFields(id, fields);
    if (Object.keys(fields).length === 0) return design;
    if (id === BASE_ENVIRONMENT && !hasEnvironments(design)) {
        throw new Error('A design with one environment holds no name or switch for it; add another environment first.');
    }
    return { ...design, environments: listOf(design).map(env => (env.id === id ? withFields(env, fields) : env)) };
}

// `design` written as a design without environments.
function withoutEnvironments(design) {
    // eslint-disable-next-line no-unused-vars
    const { environments, ...rest } = design;
    if (!Array.isArray(rest.meritOperands)) return rest;
    return {
        ...rest,
        meritOperands: rest.meritOperands.map(op => {
            if (op.env === undefined) return op;
            // eslint-disable-next-line no-unused-vars
            const { env, ...row } = op;
            return row;
        }),
    };
}

/**
 * `design` without environment `id`, and without its rows and the rows that
 * read them. Environment 1 cannot be removed. When one environment is left,
 * the design no longer lists environments.
 *
 * @throws environment 1, or an id the design has no environment for
 */
export function removeEnvironment(design, id) {
    if (id === BASE_ENVIRONMENT) throw new Error('Environment 1 is the design itself and cannot be removed.');
    if (!environmentById(design, id)) throw new Error(`This design has no environment ${id}.`);
    const operands = design.meritOperands || [];
    const own = operands.filter(op => op.env === id).map(op => op.id);
    const next = {
        ...design,
        environments: listOf(design).filter(env => env.id !== id),
        ...(Array.isArray(design.meritOperands) ? { meritOperands: removeOperandsAndDependents(operands, own) } : {}),
    };
    return next.environments.length > 1 ? next : withoutEnvironments(next);
}
