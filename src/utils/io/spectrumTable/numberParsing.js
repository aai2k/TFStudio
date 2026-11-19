// Numeric-field parsing and delimiter/decimal-locale detection for the
// spectrum-table parser (see spectrumTable.js).

/**
 * Parse a single numeric field, tolerating a trailing '%' and a decimal-comma
 * locale. `decimal` is ',' or '.'.
 * Returns a finite number, or NaN if the field is not numeric.
 */
export function parseNumber(field, decimal = '.') {
    if (field == null) return NaN;
    let s = String(field).trim();
    if (s === '') return NaN;
    if (s.endsWith('%')) s = s.slice(0, -1).trim();
    if (decimal === ',') {
        // decimal-comma locale: comma is the radix point, dot (if any) is a
        // thousands separator → drop dots, swap comma → dot. A dot counts as
        // grouping only between groups of three digits ("1.234,5"); "94..2" is a
        // typo, not 942, and is not a number.
        if (s.includes('.') && !/^[+-]?\d{1,3}(\.\d{3})+(,\d*)?([eE][+-]?\d+)?$/.test(s)) return NaN;
        s = s.replace(/\./g, '').replace(',', '.');
    }
    // Accept leading +, scientific notation, etc. Reject anything with letters
    // other than a single E/e exponent.
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
}

export const DELIMITERS = [
    { id: ',',  re: /,/g },
    { id: ';',  re: /;/g },
    { id: '\t', re: /\t/g },
    { id: ' ',  re: /\s+/ },   // whitespace-delimited (split, not count)
];

export function splitFields(line, delimiter) {
    if (delimiter === ' ') return line.trim().split(/\s+/);
    return line.split(delimiter).map(f => f.trim());
}

/**
 * Detect a decimal-comma locale: only meaningful when the delimiter is NOT a
 * comma. If any field looks like `\d+,\d+`, treat comma as the radix point.
 */
export function detectDecimal(text) {
    // If commas are clearly column delimiters (multiple per line with no
    // following space pattern), '.' is the radix. Heuristic: a number like
    // "1,5" with nothing else comma-ish on simple lines → decimal comma.
    const body = text.replace(/^[ \t]*#.*$/gm, '');
    const hasDecimalComma = /(^|[\s;\t])[+-]?\d+,\d+([\s;\t]|$)/m.test(body);
    const hasDotNumber    = /(^|[\s;,\t])[+-]?\d+\.\d+/m.test(body);
    if (hasDecimalComma && !hasDotNumber) return ',';
    return '.';
}
