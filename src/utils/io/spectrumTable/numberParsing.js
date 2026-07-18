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
        // thousands separator → drop dots, swap comma → dot.
        s = s.replace(/\./g, '').replace(',', '.');
    }
    // Accept leading +, scientific notation, etc. Reject anything with letters
    // other than a single E/e exponent.
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
}

const DELIMITERS = [
    { id: ',',  re: /,/g },
    { id: ';',  re: /;/g },
    { id: '\t', re: /\t/g },
    { id: ' ',  re: /\s+/ },   // whitespace-delimited (split, not count)
];

export function splitFields(line, delimiter) {
    if (delimiter === ' ') return line.trim().split(/\s+/);
    return line.split(delimiter).map(f => f.trim());
}

// Reward many rows that split into >=2 numeric columns, plus a consistent
// column count. A delimiter that never produces 2 numeric columns scores 0.
function scoreDelimiter(lines, delimiterId, decimal) {
    let good = 0, fieldCount = null, consistent = true;
    for (const line of lines) {
        if (!line.trim()) continue;
        const fields = splitFields(line, delimiterId);
        const nums = fields.filter(f => Number.isFinite(parseNumber(f, decimal)));
        if (nums.length < 2) continue;
        good++;
        if (fieldCount == null) fieldCount = fields.length;
        else if (fields.length !== fieldCount) consistent = false;
    }
    return good === 0 ? 0 : good + (consistent ? 0.5 : 0);
}

/**
 * Decide the column delimiter by scanning candidate data lines and picking the
 * delimiter that yields the most consistent (>=2)-numeric-column split.
 */
export function sniffDelimiter(lines, decimal = '.') {
    let best = { id: ' ', score: -1 };
    for (const cand of DELIMITERS) {
        const score = scoreDelimiter(lines, cand.id, decimal);
        if (score > best.score) best = { id: cand.id, score };
    }
    return best.id;
}

/**
 * Detect a decimal-comma locale: only meaningful when the delimiter is NOT a
 * comma. If any field looks like `\d+,\d+`, treat comma as the radix point.
 */
export function detectDecimal(text) {
    // If commas are clearly column delimiters (multiple per line with no
    // following space pattern), '.' is the radix. Heuristic: a number like
    // "1,5" with nothing else comma-ish on simple lines → decimal comma.
    const hasDecimalComma = /(^|[\s;\t])[+-]?\d+,\d+([\s;\t]|$)/m.test(text);
    const hasDotNumber    = /(^|[\s;,\t])[+-]?\d+\.\d+/m.test(text);
    if (hasDecimalComma && !hasDotNumber) return ',';
    return '.';
}
