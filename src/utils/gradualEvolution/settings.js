// The settings of one Gradual Evolution run, checked and filled in. An unknown
// setting, or a value the run cannot take, is refused with an error rather
// than dropped or rounded.

import {
    SYNTHESIS_INNER_ENGINES, ENGINE_DEFAULTS,
    SYNTHESIS_CAND_MODES, DEFAULT_SYNTHESIS_CAND_MODE, candModeBatches,
    NEEDLE_SENS_MODES, DEFAULT_NEEDLE_SENS_MODE, needleSensFloorFor,
    SMART_SEED_DEFAULTS, SYNTHESIS_SEED_MODES, DEFAULT_SYNTHESIS_SEED_MODE,
    DEFAULT_CONSOLIDATE, DEFAULT_CONSOLIDATE_TOL, defaultThreadCount,
} from '../synthesis/synthesisConfig.js';

/**
 * The settings a Gradual Evolution run starts from, and the Gradual Evolution
 * window's fields too. dMin is the floor every layer is held at; the window
 * moves it to the strictest MNT row of the merit function, so the floor and
 * the MNT penalty agree, and starts from 15 nm without one.
 */
export const GE_DEFAULTS = Object.freeze({
    maxLayers: 50,
    maxGeCycles: 16,
    targetMF: 5e-4,
    refineIter: 30,
    dMin: 15,
    deepSearch: false,
    innerEngine: ENGINE_DEFAULTS.ge,
    candidateSearch: DEFAULT_SYNTHESIS_CAND_MODE,
    sensitivity: DEFAULT_NEEDLE_SENS_MODE,
    smartSeed: SMART_SEED_DEFAULTS.ge,
    seedMode: DEFAULT_SYNTHESIS_SEED_MODE,
    consolidate: DEFAULT_CONSOLIDATE,
    consolidateTol: DEFAULT_CONSOLIDATE_TOL,
});

const KNOWN = new Set([...Object.keys(GE_DEFAULTS), 'pool', 'threads', 'history']);

const isCount = v => Number.isInteger(v) && v >= 1;
const isBoolean = v => typeof v === 'boolean';
const oneOf = list => v => list.includes(v);

// Each setting with a check and how a refusal names what it takes.
const CHECKS = [
    ['maxLayers', isCount, 'a whole number of 1 or more'],
    ['maxGeCycles', isCount, 'a whole number of 1 or more'],
    ['refineIter', isCount, 'a whole number of 1 or more'],
    ['threads', isCount, 'a whole number of 1 or more'],
    // Infinity stops the run at its first accepted step.
    ['targetMF', v => typeof v === 'number' && v >= 0, 'a merit of 0 or more, or Infinity'],
    ['dMin', v => Number.isFinite(v) && v > 0, 'a thickness in nm above 0'],
    ['consolidateTol', v => Number.isFinite(v) && v >= 0, 'a relative merit slack of 0 or more'],
    ['deepSearch', isBoolean, 'true or false'],
    ['smartSeed', isBoolean, 'true or false'],
    ['consolidate', isBoolean, 'true or false'],
    ['innerEngine', oneOf(SYNTHESIS_INNER_ENGINES), `one of ${SYNTHESIS_INNER_ENGINES.join(', ')}`],
    ['candidateSearch', oneOf(SYNTHESIS_CAND_MODES), `one of ${SYNTHESIS_CAND_MODES.join(', ')}`],
    ['sensitivity', oneOf(NEEDLE_SENS_MODES), `one of ${NEEDLE_SENS_MODES.join(', ')}`],
    ['seedMode', oneOf(SYNTHESIS_SEED_MODES), `one of ${SYNTHESIS_SEED_MODES.join(', ')}`],
];

function refuse(message) { throw new Error(`Gradual Evolution settings: ${message}`); }

// The history a run carries on from, for a window that keeps one across runs:
// the generation and GE-step counts so far, the best merit of its rows, the
// time of its last row, and whether it has rows at all. A run of its own starts
// from nothing.
const HISTORY_KEYS = new Set(['genNum', 'geSteps', 'bestMF', 'elapsedMs', 'hasRows']);

function historyOf(history) {
    if (history == null) return { genNum: 0, geSteps: 0, bestMF: Infinity, elapsedMs: 0, hasRows: false };
    if (typeof history !== 'object') refuse('history is an object');
    for (const key of Object.keys(history)) if (!HISTORY_KEYS.has(key)) refuse(`unknown history field '${key}'`);
    const { genNum = 0, geSteps = 0, bestMF = Infinity, elapsedMs = 0, hasRows = false } = history;
    if (!(Number.isInteger(genNum) && genNum >= 0)) refuse('history.genNum is a whole number of 0 or more');
    if (!(Number.isInteger(geSteps) && geSteps >= 0)) refuse('history.geSteps is a whole number of 0 or more');
    if (typeof bestMF !== 'number' || Number.isNaN(bestMF)) refuse('history.bestMF is a merit, or Infinity');
    if (!(Number.isFinite(elapsedMs) && elapsedMs >= 0)) refuse('history.elapsedMs is a time in ms of 0 or more');
    if (!isBoolean(hasRows)) refuse('history.hasRows is true or false');
    return { genNum, geSteps, bestMF, elapsedMs, hasRows };
}

// A setting given as undefined or null takes its default.
function stripUnset(settings) {
    const out = {};
    for (const [key, value] of Object.entries(settings)) if (value !== undefined && value !== null) out[key] = value;
    return out;
}

/**
 * The run plan for `settings`: every setting filled in, candidate search and
 * sensitivity turned into the batch cap and the cull floor the run applies.
 * Throws on an unknown setting or a value the run cannot take.
 */
export function planRun(settings) {
    if (!settings || typeof settings !== 'object') refuse('settings is an object');
    for (const key of Object.keys(settings)) if (!KNOWN.has(key)) refuse(`unknown setting '${key}'`);
    if (!Array.isArray(settings.pool) || !settings.pool.every(p => p && p.id != null && p.mat)) {
        refuse('pool is the list of candidate materials, each { id, name, mat } with its material');
    }
    const s = { ...GE_DEFAULTS, threads: defaultThreadCount(), ...stripUnset(settings) };
    for (const [key, ok, takes] of CHECKS) if (!ok(s[key])) refuse(`${key} is ${takes}`);
    return {
        pool: s.pool,
        maxLayers: s.maxLayers, maxGeCycles: s.maxGeCycles, targetMF: s.targetMF, refineIter: s.refineIter,
        dMin: s.dMin, deepSearch: s.deepSearch, innerEngine: s.innerEngine, threads: s.threads,
        smartSeed: s.smartSeed, preserveBulk: s.seedMode === 'preserve-bulk',
        consolidate: s.consolidate, consolidateTol: s.consolidateTol,
        maxBatches: candModeBatches(s.candidateSearch),
        sensFloor: needleSensFloorFor(s.sensitivity),
        history: historyOf(settings.history),
    };
}
