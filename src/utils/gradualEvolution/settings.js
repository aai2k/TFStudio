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
import { unknownSetting, badSetting } from '../misc/settingsRefusals.js';

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

// Each setting with a check, how a refusal names what it takes, and what it
// sets, in the words of the manual's API Reference.
export const CHECKS = [
    ['maxLayers', isCount, 'a whole number of 1 or more',
        'The most layers the design may hold; at the limit the run frees a layer rather than stopping.'],
    ['maxGeCycles', isCount, 'a whole number of 1 or more',
        'How many forced steps and freed layers the run may take in all; deepSearch lifts the limit.'],
    ['refineIter', isCount, 'a whole number of 1 or more',
        'The refinement each candidate insertion gets, in two passes, the second with half the steps.'],
    ['threads', isCount, 'a whole number of 1 or more',
        'How many candidates are refined as one batch; the answer depends on it. Without it, the thread count the app recommends for this computer.'],
    ['targetMF', v => typeof v === 'number' && v >= 0, 'a merit of 0 or more, or Infinity',
        'The merit at which the run stops; Infinity stops it at its first accepted step.'],
    ['dMin', v => Number.isFinite(v) && v > 0, 'a thickness in nm above 0',
        'The thinnest a layer goes in, and the thickness below which a layer is dropped.'],
    ['consolidateTol', v => Number.isFinite(v) && v >= 0, 'a relative merit slack of 0 or more',
        'How much the merit may rise, as a share of it, when consolidate takes a layer out.'],
    ['deepSearch', isBoolean, 'true or false',
        'When no step is left, start again from the best design with its thicknesses perturbed, until the target merit or a stop.'],
    ['smartSeed', isBoolean, 'true or false',
        'Start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first.'],
    ['consolidate', isBoolean, 'true or false', 'At the end, take out each layer whose removal keeps the merit within consolidateTol.'],
    ['innerEngine', oneOf(SYNTHESIS_INNER_ENGINES), `one of ${SYNTHESIS_INNER_ENGINES.join(', ')}`,
        'The method that refines the stack between steps.'],
    ['candidateSearch', oneOf(SYNTHESIS_CAND_MODES), `one of ${SYNTHESIS_CAND_MODES.join(', ')}`,
        'How many of the improving candidates each step tries before it moves on, trading speed for quality.'],
    ['sensitivity', oneOf(NEEDLE_SENS_MODES), `one of ${NEEDLE_SENS_MODES.join(', ')}`,
        'How weak a candidate may be, beside the strongest of its scan, and still be tried; off tries every one.'],
    ['seedMode', oneOf(SYNTHESIS_SEED_MODES), `one of ${SYNTHESIS_SEED_MODES.join(', ')}`,
        "How a thick starting design is treated: `'refine'` refines it first, `'preserve-bulk'` keeps its bulk and refines gently after each insertion."],
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
    for (const key of Object.keys(settings)) if (!KNOWN.has(key)) throw unknownSetting('Gradual Evolution settings', key, KNOWN);
    if (!Array.isArray(settings.pool) || !settings.pool.every(p => p && p.id != null && p.mat)) {
        refuse('pool is the list of candidate materials, each { id, name, mat } with its material');
    }
    const s = { ...GE_DEFAULTS, threads: defaultThreadCount(), ...stripUnset(settings) };
    for (const [key, ok, takes] of CHECKS) if (!ok(s[key])) throw badSetting('Gradual Evolution settings', key, takes, s[key]);
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
