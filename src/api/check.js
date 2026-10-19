// The checks the API's calls make on what they are given: an option a call does
// not take, or a value it cannot use, is refused with an error naming what it
// takes, so a misspelt name never runs on a default instead.

/** `options` (an object or nothing) after refusing any name not in `known`. */
export function checkOptions(call, options, known) {
    if (options == null) return {};
    if (typeof options !== 'object' || Array.isArray(options)) throw new Error(`${call}: the options are an object of ${known.join(', ')}`);
    const unknown = Object.keys(options).find(key => !known.includes(key));
    if (unknown) throw new Error(`${call}: unknown option '${unknown}'; the options are ${known.join(', ')}`);
    return options;
}

/** Refuses `value` unless `ok(value)`, saying the option `name` is `takes`. */
export function requireValue(call, name, value, ok, takes) {
    if (!ok(value)) throw new Error(`${call}: ${name} is ${takes}, not ${shown(value)}`);
}

/** A value as a refusal names it: NaN and Infinity as themselves, which JSON would print as null. */
export const shown = value => (typeof value === 'number' ? String(value) : JSON.stringify(value));

/**
 * `hooks` after refusing a name the call does not take (`names`), a signal
 * that is not an AbortSignal and a hook that is not a function.
 */
export function checkHooks(call, hooks, names) {
    const given = checkOptions(call, hooks, names);
    for (const [name, hook] of Object.entries(given)) {
        if (hook === undefined) continue;
        if (name === 'signal' ? !(hook instanceof AbortSignal) : typeof hook !== 'function') {
            throw new Error(`${call}: ${name} is ${name === 'signal' ? 'an AbortSignal' : 'a function'}`);
        }
    }
    return given;
}

export const isPositive = v => Number.isFinite(v) && v > 0;
export const isNonNegative = v => Number.isFinite(v) && v >= 0;
/** An angle of incidence in degrees that the evaluators take: 0 or more and below grazing. */
export const isAngle = v => Number.isFinite(v) && v >= 0 && v < 90;
export const isBoolean = v => typeof v === 'boolean';

// Points a spectrum or a Monte Carlo grid may hold, so a mistyped step cannot
// exhaust the process's memory: an answer holds five arrays of this many
// numbers, 40 MB at the limit.
const MAX_POINTS = 1e6;

/**
 * Refuses a wavelength range [from, to] in nm sampled every `step` nm at
 * `angles` angles that is not a range, or that holds more than MAX_POINTS
 * points.
 */
export function checkRange(call, { from, to, step }, angles = 1) {
    if (!(Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > from)) {
        throw new Error(`${call}: from and to are wavelengths in nm, 0 < from < to`);
    }
    requireValue(call, 'step', step, isPositive, 'a wavelength step in nm above 0');
    const points = (Math.floor((to - from) / step) + 1) * angles;
    if (points > MAX_POINTS) throw new Error(`${call}: ${points} points (wavelengths times angles) is more than ${MAX_POINTS}; take a larger step`);
}
