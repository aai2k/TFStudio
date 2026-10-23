// The settings of one Deep Synthesis run on a design, checked and filled in.
// An unknown setting, or a value the run cannot take, is refused with an error
// rather than dropped or rounded.

import { normalizeSeed } from '../../physics/errorAnalysis/mcConfig.js';
import { defaultThreadCount } from '../synthesisConfig.js';
import { DEEP_SYNTHESIS_DEFAULTS } from './index.js';
import { unknownSetting, badSetting } from '../../misc/settingsRefusals.js';

/**
 * The settings a Deep Synthesis run starts from, and the Deep Synthesis
 * window's fields too: a 20 nm floor and a cap of 40 layers, the conditions
 * the method was measured under in the synthesis lab. The window moves its
 * floor to the strictest MNT row of the merit function when there is one.
 */
export const DEEP_RUN_DEFAULTS = Object.freeze({ dMin: 20, maxLayers: 40 });

const KNOWN = new Set(['pool', 'dMin', 'maxLayers', 'seed', 'threads', 'method']);

// Each setting with a check and how a refusal names what it takes. A floor of
// 0 is a run without one, which turns the pair moves off (capabilities.js).
const CHECKS = [
    ['dMin', v => Number.isFinite(v) && v >= 0, 'a thickness in nm of 0 or more'],
    ['maxLayers', v => Number.isInteger(v) && v >= 1, 'a whole number of 1 or more'],
    ['threads', v => Number.isInteger(v) && v >= 1, 'a whole number of 1 or more'],
    ['seed', v => v === null || normalizeSeed(v) === v, 'a whole number from 1 to 2^32 - 1, or null for a fresh one'],
];

function refuse(message) { throw new Error(`Deep Synthesis settings: ${message}`); }

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);
const SECTIONS = Object.keys(DEEP_SYNTHESIS_DEFAULTS);
const kindOf = constant => (typeof constant === 'number' ? 'a number' : 'true or false');
const sameKind = (constant, v) => (typeof constant === 'number' ? Number.isFinite(v) : typeof v === typeof constant);

// What is wrong with the replacement `value` of one section of the method's
// constants, whose defaults are `defaults`, or null.
function sectionProblem(section, defaults, value) {
    if (!isRecord(defaults)) return sameKind(defaults, value) ? null : `method.${section} is ${kindOf(defaults)}`;
    const names = Object.keys(defaults);
    if (!isRecord(value)) return `method.${section} is an object of ${names.join(', ')}`;
    for (const [key, v] of Object.entries(value)) {
        if (!names.includes(key)) return `method.${section} has no constant '${key}'; it has ${names.join(', ')}`;
        if (!sameKind(defaults[key], v)) return `method.${section}.${key} is ${kindOf(defaults[key])}`;
    }
    return null;
}

// What is wrong with `method`, the sections of the method's constants to
// replace, or null: a section or constant the method does not have, or a value
// of another kind than its default's.
function methodProblem(method) {
    if (!isRecord(method)) return `method is an object of sections among ${SECTIONS.join(', ')}`;
    for (const [section, value] of Object.entries(method)) {
        if (!SECTIONS.includes(section)) return `method has no section '${section}'; the sections are ${SECTIONS.join(', ')}`;
        const problem = sectionProblem(section, DEEP_SYNTHESIS_DEFAULTS[section], value);
        if (problem) return problem;
    }
    return null;
}

// The method's constants, with any section `overrides` gives merged over
// DEEP_SYNTHESIS_DEFAULTS.
function methodOptions(overrides) {
    const merged = { ...DEEP_SYNTHESIS_DEFAULTS };
    for (const [key, value] of Object.entries(overrides)) {
        merged[key] = value && typeof value === 'object' ? { ...merged[key], ...value } : value;
    }
    return merged;
}

/**
 * The run plan for `settings` ({ pool, dMin, maxLayers, seed, threads,
 * method }): every setting filled in and the method's constants merged.
 * Throws on an unknown setting or a value the run cannot take.
 */
export function planRun(settings) {
    if (!settings || typeof settings !== 'object') refuse('settings is an object');
    for (const key of Object.keys(settings)) if (!KNOWN.has(key)) throw unknownSetting('Deep Synthesis settings', key, KNOWN);
    if (!Array.isArray(settings.pool) || !settings.pool.every(p => p && p.id != null && p.mat)) {
        refuse('pool is the list of candidate materials, each { id, name, mat } with its material');
    }
    const given = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
    const s = { ...DEEP_RUN_DEFAULTS, seed: null, threads: defaultThreadCount(), method: {}, ...given };
    for (const [key, ok, takes] of CHECKS) if (!ok(s[key])) throw badSetting('Deep Synthesis settings', key, takes, s[key]);
    const problem = methodProblem(s.method);
    if (problem) refuse(problem);
    return {
        pool: s.pool, dMin: s.dMin, maxLayers: s.maxLayers, seed: s.seed, threads: s.threads,
        method: methodOptions(s.method),
    };
}
