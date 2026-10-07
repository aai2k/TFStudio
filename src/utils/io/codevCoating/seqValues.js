import { CodevParseError } from './parseError.js';

/**
 * A token read as a number. A Fortran D exponent (1.5D-3) reads as E.
 * @throws {CodevParseError} badNumber, with the line and the token's text
 */
export function numberOf(token, line) {
    const text = token && !token.quoted ? token.text : '';
    const value = text ? Number(text.replace(/[dD]/, 'e')) : NaN;
    if (!Number.isFinite(value)) throw new CodevParseError('badNumber', { line, text: token?.text ?? '' });
    return value;
}

export const numbersOf = (tokens, line) => tokens.map(token => numberOf(token, line));

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
