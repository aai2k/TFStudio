// The settings of one Needle run, checked and filled in. An unknown setting,
// or a value the run cannot take, is refused with an error rather than dropped
// or rounded.

import {
    SYNTHESIS_INNER_ENGINES, ENGINE_DEFAULTS,
    SYNTHESIS_CAND_MODES, DEFAULT_SYNTHESIS_CAND_MODE, candModeBatches,
    NEEDLE_SENS_MODES, DEFAULT_NEEDLE_SENS_MODE, needleSensFloorFor,
    SMART_SEED_DEFAULTS, defaultThreadCount,
} from '../synthesis/synthesisConfig.js';
import { unknownSetting, badSetting } from '../misc/settingsRefusals.js';

/**
 * The settings a Needle run starts from, and the Needle window's fields too.
 *
 * dMin is the synthesis floor: the lower bound of a needle's thickness search
 * and the thickness below which a refined layer is pruned. It stays at 1 nm
 * whatever the merit function's MNT row says. Needles go in thin and grow, so
 * a floor at MNT would force-feed every needle at MNT thickness and the
 * synthesis collapses. Gradual Evolution can couple its floor to MNT because
 * its forced thickness step escapes the resulting local minimum; Needle has no
 * such step, and leaves the MNT and MXT rows to a Refinement run afterwards.
 *
 * A full refine per generation and the 1 nm floor come from a comparison of
 * the window's settings, the inner refiner from the one in
 * synthesisConfig/innerEngine.js; 60 refine iterations and 60 layers balance
 * merit per layer against run time.
 */
export const NEEDLE_DEFAULTS = Object.freeze({
    maxLayers: 60,
    targetMF: 5e-4,
    deltaNm: 0.5,
    dMin: 1,
    refineIter: 60,
    innerEngine: ENGINE_DEFAULTS.needle,
    candidateSearch: DEFAULT_SYNTHESIS_CAND_MODE,
    sensitivity: DEFAULT_NEEDLE_SENS_MODE,
    smartSeed: SMART_SEED_DEFAULTS.needle,
});

const KNOWN = new Set([...Object.keys(NEEDLE_DEFAULTS), 'pool', 'threads', 'history']);

const isCount = v => Number.isInteger(v) && v >= 1;
const isPositive = v => Number.isFinite(v) && v > 0;
const oneOf = list => v => list.includes(v);

// Each setting with a check, how a refusal names what it takes, and what it
// sets, in the words of the manual's API Reference.
export const CHECKS = [
    ['maxLayers', isCount, 'a whole number of 1 or more', 'The most layers the design may grow to.'],
    ['refineIter', isCount, 'a whole number of 1 or more', 'The refinement steps after each insertion.'],
    ['threads', isCount, 'a whole number of 1 or more',
        'How many candidates are refined as one batch; the answer depends on it. Without it, the thread count the app recommends for this computer.'],
    ['targetMF', v => typeof v === 'number' && v >= 0, 'a merit of 0 or more, or Infinity',
        'The merit at which the run stops; Infinity stops it at its first accepted generation.'],
    ['deltaNm', isPositive, 'a thickness in nm above 0', 'The thickness step that probes each candidate position.'],
    ['dMin', isPositive, 'a thickness in nm above 0',
        'The thinnest a needle goes in, and the thickness below which a refined layer is dropped.'],
    ['innerEngine', oneOf(SYNTHESIS_INNER_ENGINES), `one of ${SYNTHESIS_INNER_ENGINES.join(', ')}`,
        'The method that refines the stack after each insertion.'],
    ['candidateSearch', oneOf(SYNTHESIS_CAND_MODES), `one of ${SYNTHESIS_CAND_MODES.join(', ')}`,
        'How many of the improving candidates each step tries before it moves on, trading speed for quality.'],
    ['sensitivity', oneOf(NEEDLE_SENS_MODES), `one of ${NEEDLE_SENS_MODES.join(', ')}`,
        'How weak a candidate may be, beside the strongest of its scan, and still be tried; off tries every one.'],
    ['smartSeed', v => typeof v === 'boolean', 'true or false',
        'Start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first.'],
];

function refuse(message) { throw new Error(`Needle settings: ${message}`); }

// The generations a run carries on from, for a window that keeps a history
// across runs. A run of its own starts at generation 1, measures its first
// ΔMF from nothing and its time from 0.
function historyOf(history) {
    if (history == null) return { genNum: 0, bestMF: Infinity, elapsedMs: 0, rows: [] };
    if (typeof history !== 'object') refuse('history is an object');
    const { genNum = 0, bestMF = Infinity, elapsedMs = 0, rows = [] } = history;
    if (!(Number.isInteger(genNum) && genNum >= 0)) refuse('history.genNum is a whole number of 0 or more');
    if (typeof bestMF !== 'number' || Number.isNaN(bestMF)) refuse('history.bestMF is a merit, or Infinity');
    if (!(Number.isFinite(elapsedMs) && elapsedMs >= 0)) refuse('history.elapsedMs is a time in ms of 0 or more');
    if (!Array.isArray(rows)) refuse('history.rows is a list of generation rows');
    return { genNum, bestMF, elapsedMs, rows };
}

/**
 * The run plan for `settings`: every setting filled in, candidate search and
 * sensitivity turned into the batch cap and the cull floor the run applies.
 * Throws on an unknown setting or a value the run cannot take.
 */
export function planRun(settings) {
    if (!settings || typeof settings !== 'object') refuse('settings is an object');
    for (const key of Object.keys(settings)) if (!KNOWN.has(key)) throw unknownSetting('Needle settings', key, KNOWN);
    if (!Array.isArray(settings.pool) || !settings.pool.every(p => p && p.id != null && p.mat)) {
        refuse('pool is the list of candidate materials, each { id, name, mat } with its material');
    }
    const s = { ...NEEDLE_DEFAULTS, threads: defaultThreadCount(), ...stripUnset(settings) };
    for (const [key, ok, takes] of CHECKS) if (!ok(s[key])) throw badSetting('Needle settings', key, takes, s[key]);
    return {
        pool: s.pool,
        maxLayers: s.maxLayers, targetMF: s.targetMF, deltaNm: s.deltaNm, dMin: s.dMin,
        refineIter: s.refineIter, innerEngine: s.innerEngine, smartSeed: s.smartSeed, threads: s.threads,
        maxBatches: candModeBatches(s.candidateSearch),
        sensFloor: needleSensFloorFor(s.sensitivity),
        history: historyOf(settings.history),
    };
}

// A setting given as undefined or null takes its default.
function stripUnset(settings) {
    const out = {};
    for (const [key, value] of Object.entries(settings)) if (value !== undefined && value !== null) out[key] = value;
    return out;
}
