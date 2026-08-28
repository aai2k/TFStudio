/**
 * How a spectrum file's header names its columns.
 *
 * Real headers are not one tidy row of labels: they are split across a name row
 * and a unit row, commented out with a marker, quoted, padded with settings
 * lines that look like data, or absent entirely. Everything that decides which
 * text belongs to which column lives here; reading the numbers is
 * `tableParser.js`.
 */

import { parseNumber, splitFields } from './numberParsing.js';

// Tokens a header line can be commented out with. They are not column names.
const COMMENT_TOKENS = new Set([';', '#', '//', '%', '*', '!']);

// The line an instrument writes to say the header is over: ">>>>>Begin Spectral
// Data<<<<<" from Ocean Optics, "#DATA" from the PerkinElmer PEDS ASCII format.
function isDataMarkerLine(line) {
    const text = String(line || '').trim();
    return /begin\s+(spectral|spectrum)\s+data/i.test(text) ||
        (/^[<>]{3,}/.test(text) && /data/i.test(text)) ||
        /^#\s*data\b/i.test(text);
}

function stripQuotes(field) {
    const text = String(field ?? '').trim();
    return text.length >= 2 && /^(["']).*\1$/.test(text) ? text.slice(1, -1).trim() : text;
}

function headerFields(line, delimiter, nCols) {
    const fields = splitFields(line, delimiter).map(stripQuotes);
    // "; Wavelength S000 S001" has one field more than it has columns, and
    // leaving the marker in shifts every name onto its neighbour.
    if (fields.length > nCols && (COMMENT_TOKENS.has(fields[0]) || fields[0] === '')) fields.shift();
    while (fields.length > nCols && fields[fields.length - 1] === '') fields.pop();
    return fields;
}

// A row of units rather than names: "[nm] ;[counts] ;[%]". Avantes and others
// split the header over two lines, names above, units below.
function isUnitRow(fields) {
    const filled = fields.filter(field => field !== '');
    return filled.length > 0 && filled.every(field => /^[[(].*[\])]$/.test(field));
}

/**
 * Does this row name the columns?
 *
 * A name row names the wavelength column first, so a row opening with a number
 * is a settings line: PerkinElmer writes "405 350 NORM" in its header. A row
 * that is otherwise mostly numbers has to match the column count exactly to be
 * believed, which keeps "Wavelength,1,2,3", where the samples are numbered, and
 * rejects a stray "AOI 75.7".
 */
function isNameRow(names, nCols, decimal) {
    if (names.length < 2 || Math.abs(names.length - nCols) > 1) return false;
    if (Number.isFinite(parseNumber(names[0], decimal))) return false;
    const numeric = names.filter(f => Number.isFinite(parseNumber(f, decimal))).length;
    return numeric * 2 < names.length || names.length === nCols;
}

/**
 * Read the row above the names, which holds either the units that go with them
 * or the sample each group of columns belongs to.
 */
function pairRowAbove(names, previous) {
    if (previous.length < 2) return { names, units: [], sampleNames: [] };
    if (isUnitRow(names) && previous.length === names.length) {
        return { names: previous, units: names, sampleNames: [] };
    }
    return { names, units: [], sampleNames: previous };
}

// Find the last header-shaped row rather than assuming the final non-data row
// is the header. Instruments commonly put a "Begin Spectral Data" marker after
// the column labels.
function detectHeaderLayout(headerLines, delimiter, decimal, nCols) {
    for (let i = headerLines.length - 1; i >= 0; i--) {
        if (isDataMarkerLine(headerLines[i])) continue;
        const names = headerFields(headerLines[i], delimiter, nCols);
        if (!isNameRow(names, nCols, decimal)) continue;
        const above = i > 0 && !isDataMarkerLine(headerLines[i - 1])
            ? headerFields(headerLines[i - 1], delimiter, nCols)
            : [];
        const usable = Math.abs(above.length - nCols) <= 1 ? above : [];
        return pairRowAbove(names, usable);
    }
    return { names: [], units: [], sampleNames: [] };
}

function groupSampleName(sampleNames, start, end) {
    const candidates = sampleNames.slice(start, end).map(value => String(value || '').trim()).filter(Boolean);
    return candidates.length ? candidates[candidates.length - 1] : '';
}

function uniqueColumnNames(columns) {
    const counts = new Map();
    columns.forEach(column => counts.set(column.baseName, (counts.get(column.baseName) || 0) + 1));
    const occurrences = new Map();
    const used = new Set();
    return columns.map((column) => {
        const occurrence = (occurrences.get(column.baseName) || 0) + 1;
        occurrences.set(column.baseName, occurrence);
        let name = column.baseName;
        if (counts.get(column.baseName) > 1) {
            name = column.sampleName
                ? `${column.sampleName}: ${column.baseName}`
                : `${column.baseName} (${occurrence})`;
        }
        if (used.has(name)) name = `${name} (${occurrence})`;
        used.add(name);
        return { ...column, name };
    });
}

export {
    detectHeaderLayout, groupSampleName, isDataMarkerLine, uniqueColumnNames,
};
