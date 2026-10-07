import { CodevParseError } from './parseError.js';
import { CODEV_LIMITS } from './serialize.js';

// A comma between two digits, read as a decimal point. Essential Macleod's
// CODE V export writes every decimal that way ("403,03") on a machine set to
// a decimal-comma locale, and CODE V 11.2 rejects such a number as "Invalid
// data". Only a comma between digits is read so: "400, 500" or "400," stays
// a bad number.
const DECIMAL_COMMA = /(\d),(?=\d)/g;

/** Whether `text` holds a comma between two digits. */
export const hasDecimalComma = (text) => /\d,\d/.test(text);

/**
 * A token read as a number. A Fortran D exponent (1.5D-3) reads as E, and a
 * comma between two digits as a decimal point.
 * @throws {CodevParseError} badNumber, with the line and the token's text
 */
export function numberOf(token, line) {
    const text = token && !token.quoted ? token.text : '';
    const value = text ? Number(text.replace(DECIMAL_COMMA, '$1.').replace(/[dD]/, 'e')) : NaN;
    if (!Number.isFinite(value)) throw new CodevParseError('badNumber', { line, text: token?.text ?? '' });
    return value;
}

export const numbersOf = (tokens, line) => tokens.map(token => numberOf(token, line));

/**
 * The values one command keeps. CODE V 11.2 reads the first 21 values of one
 * WL, MWL, 'label' n or EXT command and ignores the rest with "Extra data ...
 * ignored"; they are left out here too and reported as an extraValues
 * warning under `command`.
 */
export function keptValues(tokens, command, line, warnings) {
    const limit = CODEV_LIMITS.valuesPerCommand;
    if (tokens.length > limit) warnings.push({ kind: 'extraValues', command, line, count: tokens.length - limit, limit });
    return numbersOf(tokens.slice(0, limit), line);
}

/**
 * The key of `map` (a Map or an object) that names `label`: the same text, or
 * failing that the same text in another case.
 */
export function findLabel(map, label) {
    const keys = map instanceof Map ? [...map.keys()] : Object.keys(map);
    if (keys.includes(label)) return label;
    const upper = String(label).toUpperCase();
    return keys.find(key => key.toUpperCase() === upper);
}
