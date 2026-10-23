// The checks the API's calls make on what they are given: an option a call does
// not take, or a value it cannot use, is refused with an error naming what it
// takes, so a misspelt name never runs on a default instead.

/**
 * An Error saying `message`, in the words of the plain calls, that also
 * carries `code`, which refusal it is, and `fields`, the call, names and
 * values it was worded from. The object API of each language words such a
 * refusal again in its own names from these (objects/refusals.js, the Python
 * package); the API server sends both on with the message.
 *
 *   unknownOption    { call, option, options, row }  an option the call does not take
 *   badValue         { call, option, takes, value, row }  a value the option cannot take
 *   noMerit          { call }  a design with no merit function
 *   noSpecification  { call }  a design with no specification check, or none enabled where the call needs one
 *   noLayers         { call }  a design with no layers on either side
 *   emptySide        { call, side }  a side with no layers for a call that shows one side's layers
 *   noQwot           { call, material, wavelength, n }  a layer whose material has no quarter wave: it resolves to nothing (n null), or its n is 0 or less
 *   closedSide      { call, side, surfaceMode }  a side the Design Editor does not let you edit
 *   wavelengthRange  { call, from, to }  wavelengths that are not a range
 *   bandOrder        { call, row, start, end }  a merit row or a check whose band starts above its end
 *   fileExists       { call, path }  a file that is there, without overwrite
 *   formulaMedia     { call }  a stack formula that names media
 *
 * `row` is there on a refusal of a merit row or a specification check only:
 * its place in the rows or checks.
 */
export function refusal(code, fields, message) {
    return Object.assign(new Error(message), { code, fields });
}

/** `options` (an object or nothing) after refusing any name not in `known`. */
export function checkOptions(call, options, known) {
    if (options == null) return {};
    if (typeof options !== 'object' || Array.isArray(options)) throw new Error(`${call}: the options are an object of ${known.join(', ')}`);
    const unknown = Object.keys(options).find(key => !known.includes(key));
    if (unknown) {
        throw refusal('unknownOption', { call, option: unknown, options: known }, `${call}: unknown option '${unknown}'; the options are ${known.join(', ')}`);
    }
    return options;
}

/** Refuses `value` unless `ok(value)`, saying the option `name` is `takes`. */
export function requireValue(call, name, value, ok, takes) {
    if (!ok(value)) throw refusal('badValue', { call, option: name, takes, value }, `${call}: ${name} is ${takes}, not ${shown(value)}`);
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
/** One coated side. */
export const isSide = v => v === 'front' || v === 'back';
/** A side a stack is read on: one side's layers, or both sides of the part. */
export const isViewSide = v => v === 'front' || v === 'back' || v === 'total';

/**
 * Points a spectrum, a Monte Carlo grid or a field profile may hold, so a
 * mistyped step cannot exhaust the process's memory: a spectrum holds five
 * arrays of this many numbers, 40 MB at the limit.
 */
export const MAX_POINTS = 1e6;

/**
 * Refuses a wavelength range [from, to] in nm sampled every `step` nm at
 * `angles` angles that is not a range, or that holds more than MAX_POINTS
 * points. `names` are the call's names for from and to.
 */
export function checkRange(call, { from, to, step }, angles = 1, [first, last] = ['from', 'to']) {
    if (!(Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > from)) {
        throw refusal('wavelengthRange', { call, from, to }, `${call}: ${first} and ${last} are wavelengths in nm, 0 < ${first} < ${last}`);
    }
    requireValue(call, 'step', step, isPositive, 'a wavelength step in nm above 0');
    const points = (Math.floor((to - from) / step) + 1) * angles;
    if (points > MAX_POINTS) throw new Error(`${call}: ${points} points (wavelengths times angles) is more than ${MAX_POINTS}; take a larger step`);
}
