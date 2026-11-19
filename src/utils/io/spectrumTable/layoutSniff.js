// Delimiter and decimal-mark detection from the data block of a spectrum table.

import { DELIMITERS, detectDecimal, parseNumber, splitFields } from './numberParsing.js';

// The score of the longest block of consecutive lines that all split into the
// same count of fields, two or more of them numbers, under one delimiter and
// decimal mark. The data of a table is such a block; a header above it, a layer
// table in the .res style, is a shorter one or one that splits differently.
function longestBlockScore(lines, delimiter, decimal) {
    let best = 0, run = 0, fieldCount = null;
    for (const line of lines) {
        if (!line.trim()) continue;
        const fields = splitFields(line, delimiter);
        const numbers = fields.filter(f => Number.isFinite(parseNumber(f, decimal))).length;
        if (numbers < 2) { run = 0; fieldCount = null; continue; }
        if (fieldCount !== fields.length) { run = 0; fieldCount = fields.length; }
        run += numbers / fields.length;
        if (run > best) best = run;
    }
    return best;
}

/**
 * The delimiter and decimal mark of a table, read from its data block: the
 * longest run of lines with one field count, as a header above the data (a
 * dotted layer table, a date) does not decide either. A mark given in `force`
 * is kept. Where nothing reads as data the whitespace delimiter and the
 * decimal mark `detectDecimal` finds are returned.
 */
export function sniffLayout(lines, force = {}) {
    const preferred = force.decimal || detectDecimal(lines.join('\n'));
    const decimals = force.decimal ? [force.decimal] : [preferred, preferred === ',' ? '.' : ','];
    const delimiters = force.delimiter ? [force.delimiter] : DELIMITERS.map(d => d.id);
    let best = { delimiter: force.delimiter || ' ', decimal: preferred, score: 0 };
    for (const decimal of decimals) {
        for (const delimiter of delimiters) {
            if (delimiter === ',' && decimal === ',') continue;
            const score = longestBlockScore(lines, delimiter, decimal);
            if (score > best.score) best = { delimiter, decimal, score };
        }
    }
    return { delimiter: best.delimiter, decimal: best.decimal };
}
