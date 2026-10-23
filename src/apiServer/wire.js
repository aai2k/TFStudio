// How values cross the API server's pipe: each message is one line of JSON.
//
// JSON has no NaN or Infinity, and an answer can hold them: summarize gives a
// band whose values are all NaN a NaN mean, an Infinity lowest and a -Infinity
// highest. They travel as the bare tokens NaN, Infinity and -Infinity, which
// Python's json module writes and reads by default, so a number crosses
// unchanged in both directions. Typed arrays travel as lists, and a field
// whose value is undefined is left out, as JSON.stringify leaves it.

import crypto from 'node:crypto';

const TOKENS = ['NaN', 'Infinity', '-Infinity'];

// Stands for a non-finite number while JSON.stringify writes a line, and is
// then swapped for its bare token. It is drawn for each process, so no string
// a message holds can be taken for one.
const MARK = `tfstudio-${crypto.randomBytes(12).toString('hex')}:`;
const MARKED = new RegExp(`"${MARK}(${TOKENS.join('|')})"`, 'g');
const NUMBERS = new Map(TOKENS.map(token => [`${MARK}${token}`, Number(token)]));

function replacer(key, value) {
    if (typeof value === 'number' && !Number.isFinite(value)) return `${MARK}${value}`;
    if (ArrayBuffer.isView(value)) return Array.from(value);
    return value;
}

/** `value` as one line of JSON, without its line break. */
export function encode(value) {
    return JSON.stringify(value, replacer).replace(MARKED, (_, token) => token);
}

// A JSON string, its escapes included, or one of the bare tokens.
const STRING_OR_TOKEN = /"[^"\\]*(?:\\.[^"\\]*)*"|-Infinity|Infinity|NaN/g;

/**
 * The value a line of JSON holds, with the bare tokens NaN, Infinity and
 * -Infinity outside its strings read as those numbers. Throws when the line
 * is not JSON.
 */
export function parse(text) {
    try {
        return JSON.parse(text);
    } catch (err) {
        const marked = text.replace(STRING_OR_TOKEN, found => (found[0] === '"' ? found : `"${MARK}${found}"`));
        if (marked === text) throw err;
        return JSON.parse(marked, (key, value) => (NUMBERS.has(value) ? NUMBERS.get(value) : value));
    }
}
