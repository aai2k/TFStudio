// The settings of one Structural run, checked and filled in. An unknown
// setting, or a value the run cannot take, is refused with an error rather
// than dropped or rounded.

import { MUTATION_KINDS } from '../synthesis/structuralOptimizer.js';
import {
    SYNTHESIS_INNER_ENGINES, ENGINE_DEFAULTS, SMART_SEED_DEFAULTS, defaultThreadCount,
} from '../synthesis/synthesisConfig.js';
import { normalizeSeed } from '../physics/errorAnalysis/mcConfig.js';

/**
 * The settings a Structural run starts from, and the Structural Optimizer
 * window's fields too. Thicknesses in nm; jitterPct is a fraction of a layer's
 * thickness; T0 is the starting temperature, in merit units.
 */
export const STRUCTURAL_DEFAULTS = Object.freeze({
    maxIter: 80, targetMF: 5e-4, T0: 0.3, jitterPct: 0.15, refineIter: 60,
    dMin: 1, addMaxNm: 500, maxLayers: 80,
});

/** Every setting a Structural run takes but its pool and threads, with the value a run starts from. */
export const RUN_DEFAULTS = {
    ...STRUCTURAL_DEFAULTS,
    kinds: MUTATION_KINDS, deepSearch: false, deepMaxMin: 0, seed: null,
    innerEngine: ENGINE_DEFAULTS.structural, smartSeed: SMART_SEED_DEFAULTS.structural,
};

const KNOWN = new Set([...Object.keys(RUN_DEFAULTS), 'pool', 'threads', 'history']);

const isCount = v => Number.isInteger(v) && v >= 1;
const isBoolean = v => typeof v === 'boolean';
const isAtLeast0 = v => Number.isFinite(v) && v >= 0;
const isAbove0 = v => Number.isFinite(v) && v > 0;

// Each setting with a check, how a refusal names what it takes, and what it
// sets, in the words of the manual's API Reference.
export const CHECKS = [
    ['maxIter', isCount, 'a whole number of 1 or more', 'The most generations the search runs.'],
    ['refineIter', v => Number.isInteger(v) && v >= 0, 'a whole number of 0 or more',
        'The refinement steps each proposal gets; 0 scores each proposal as it is.'],
    ['maxLayers', isCount, 'a whole number of 1 or more', 'The most layers the design may grow to.'],
    ['threads', isCount, 'a whole number of 1 or more',
        'How many proposals each generation refines; the answer depends on it. Without it, the thread count the app recommends for this computer.'],
    ['targetMF', v => typeof v === 'number' && v >= 0, 'a merit of 0 or more', 'The merit at which the search stops.'],
    ['T0', isAtLeast0, 'a temperature of 0 or more',
        'The starting temperature, in merit units; a higher one accepts more uphill moves early on.'],
    ['jitterPct', isAtLeast0, 'a fraction of 0 or more', 'How far the perturb mutation moves a thickness, as a fraction of it.'],
    ['dMin', isAbove0, 'a thickness in nm above 0', 'The thinnest a layer may be.'],
    ['addMaxNm', isAbove0, 'a thickness in nm above 0', 'The thickest a randomly added layer starts at.'],
    ['deepMaxMin', isAtLeast0, 'a time in minutes of 0 or more (0: no limit)', 'With deepSearch, the time after which the search ends.'],
    ['deepSearch', isBoolean, 'true or false',
        'When no better design has turned up for a while, restart from the best one, until the time limit or a stop.'],
    ['smartSeed', isBoolean, 'true or false',
        'Start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first.'],
    ['innerEngine', v => SYNTHESIS_INNER_ENGINES.includes(v), `one of ${SYNTHESIS_INNER_ENGINES.join(', ')}`,
        'The method that refines each proposal.'],
    ['kinds', v => Array.isArray(v) && v.length > 0 && v.every(k => MUTATION_KINDS.includes(k)),
        `a list of one or more of ${MUTATION_KINDS.join(', ')}`, 'The mutations the search may use.'],
    ['seed', v => v === null || normalizeSeed(v) === v, 'a whole number from 1 to 2^32 - 1, or null for a fresh one',
        'The number the random draws start from; the same seed, design, settings and threads repeat the run. The result reports the seed it drew from.'],
];

function refuse(message) { throw new Error(`Structural settings: ${message}`); }

const HISTORY_KEYS = new Set(['genNum', 'hasRows', 'elapsedMs', 'trendIter']);

// The history a run carries on from, for a window that keeps one across runs:
// the generation count of the run block it continues, whether there are rows
// at all, the time of the last row and the iteration of the last trend point.
// A run of its own starts from nothing.
function historyOf(history) {
    if (history == null) return { genNum: 0, hasRows: false, elapsedMs: 0, trendIter: 0 };
    if (typeof history !== 'object') refuse('history is an object');
    for (const key of Object.keys(history)) if (!HISTORY_KEYS.has(key)) refuse(`unknown history field '${key}'`);
    const { genNum = 0, hasRows = false, elapsedMs = 0, trendIter = 0 } = history;
    if (!(Number.isInteger(genNum) && genNum >= 0)) refuse('history.genNum is a whole number of 0 or more');
    if (!isBoolean(hasRows)) refuse('history.hasRows is true or false');
    if (!isAtLeast0(elapsedMs)) refuse('history.elapsedMs is a time in ms of 0 or more');
    if (!(Number.isInteger(trendIter) && trendIter >= 0)) refuse('history.trendIter is a whole number of 0 or more');
    return { genNum, hasRows, elapsedMs, trendIter };
}

// A setting given as undefined takes its default; seed keeps null, which asks
// for a fresh seed.
function stripUnset(settings) {
    const out = {};
    for (const [key, value] of Object.entries(settings)) {
        if (value === undefined || (value === null && key !== 'seed')) continue;
        out[key] = value;
    }
    return out;
}

/**
 * The run plan for `settings`: every setting filled in, the mutation kinds as
 * a set. Throws on an unknown setting or a value the run cannot take.
 */
export function planRun(settings) {
    if (!settings || typeof settings !== 'object') refuse('settings is an object');
    for (const key of Object.keys(settings)) if (!KNOWN.has(key)) refuse(`unknown setting '${key}'`);
    if (!Array.isArray(settings.pool) || !settings.pool.every(p => p && p.id != null && p.mat)) {
        refuse('pool is the list of candidate materials, each { id, name, mat } with its material');
    }
    const s = { ...RUN_DEFAULTS, threads: defaultThreadCount(), ...stripUnset(settings) };
    for (const [key, ok, takes] of CHECKS) if (!ok(s[key])) refuse(`${key} is ${takes}`);
    return {
        pool: s.pool, maxIter: s.maxIter, targetMF: s.targetMF, T0: s.T0, jitterPct: s.jitterPct,
        refineIter: s.refineIter, dMin: s.dMin, addMaxNm: s.addMaxNm, maxLayers: s.maxLayers,
        kinds: new Set(s.kinds), deepSearch: s.deepSearch, deepMaxMin: s.deepMaxMin, seed: s.seed,
        innerEngine: s.innerEngine, smartSeed: s.smartSeed, threads: s.threads,
        history: historyOf(settings.history),
    };
}
