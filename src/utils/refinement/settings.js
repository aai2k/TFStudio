// The settings of one refinement run, checked and filled in. An unknown
// setting or method, or a value the run cannot take, is refused with an error
// rather than dropped or rounded. A known setting the chosen method has no use
// for, such as nRestarts for a single-start method, is ignored.

import { MAX_SEED } from '../physics/errorAnalysis/mcConfig.js';
import { REFINE_METHODS, ALL_ORDER, DEFAULT_SETTINGS, defaultMaxIter } from './methods.js';

const KNOWN = new Set(['method', 'maxIter', 'nRestarts', 'perturbPct', 'seed', 'threads']);

const isCount = v => Number.isInteger(v) && v >= 1;
const given = v => v !== undefined && v !== null;

function refuse(message) { throw new Error(`Refinement settings: ${message}`); }

// 'all' is every method in ALL_ORDER; one id is a list of one. A list is tried
// method by method from the same start, keeping the best.
function methodList(method) {
    if (method === 'all') return ALL_ORDER;
    if (typeof method === 'string') {
        if (!REFINE_METHODS.includes(method)) refuse(`unknown method '${method}'`);
        return [method];
    }
    if (!Array.isArray(method) || method.length === 0) refuse('method is a method id or a non-empty list of ids');
    for (const id of method) if (!ALL_ORDER.includes(id)) refuse(`unknown method '${id}' in the list`);
    if (new Set(method).size !== method.length) refuse('a method appears twice in the list');
    return method;
}

function checkNumbers(settings, single) {
    const { maxIter, nRestarts, perturbPct, threads } = settings;
    if (given(maxIter) && !single) refuse('maxIter applies to a one-method run; a list runs each method to its own budget');
    if (given(maxIter) && !isCount(maxIter)) refuse('maxIter is a whole number of 1 or more');
    if (given(nRestarts) && !isCount(nRestarts)) refuse('nRestarts is a whole number of 1 or more');
    if (given(perturbPct) && !(Number.isFinite(perturbPct) && perturbPct >= 0)) refuse('perturbPct is a number of 0 or more');
    if (given(threads) && !isCount(threads)) refuse('threads is a whole number of 1 or more');
}

function seedOf(seed) {
    if (!given(seed)) return null;
    if (!(Number.isInteger(seed) && seed >= 1 && seed <= MAX_SEED)) refuse(`seed ${seed} is not a whole number from 1 to 2^32 - 1`);
    return seed;
}

/**
 * Whether a run of `method` takes the DLS worker pool: 'dls' or 'dls-multi'
 * alone, as an id or a list of one. Every other method and every longer list
 * takes the method flow.
 */
export function runsOnDlsPool(method) {
    const only = Array.isArray(method) && method.length === 1 ? method[0] : method;
    return only === 'dls' || only === 'dls-multi';
}

/**
 * The run plan for `settings`: the method list, whether it runs on the DLS
 * worker pool, and every number filled in. Throws on an unknown setting, method
 * or value.
 */
export function planRun(settings) {
    if (!settings || typeof settings !== 'object') refuse('settings is an object');
    for (const key of Object.keys(settings)) if (!KNOWN.has(key)) refuse(`unknown setting '${key}'`);
    const methods = methodList(settings.method);
    const single = methods.length === 1;
    checkNumbers(settings, single);
    return {
        methods,
        onPool: runsOnDlsPool(methods),
        maxIter: single ? (settings.maxIter ?? defaultMaxIter(methods[0])) : undefined,
        nRestarts: settings.nRestarts ?? DEFAULT_SETTINGS.nRestarts,
        perturbPct: settings.perturbPct ?? DEFAULT_SETTINGS.perturbPct,
        seed: seedOf(settings.seed),
        threads: settings.threads ?? 1,
    };
}
