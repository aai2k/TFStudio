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

// A marker written against the first name, "#ROIidx", is still a marker. The
// percent sign is not one here: "%T" is a name.
const GLUED_MARKER = /^(?:#|;|\/\/|!)(?=\S)/;

function headerFields(line, delimiter, nCols) {
    const fields = splitFields(line, delimiter).map(stripQuotes);
    // "; Wavelength S000 S001" has one field more than it has columns, and
    // leaving the marker in shifts every name onto its neighbour.
    if (fields.length > nCols && (COMMENT_TOKENS.has(fields[0]) || fields[0] === '')) fields.shift();
    else if (fields.length) fields[0] = fields[0].replace(GLUED_MARKER, '').trim();
    while (fields.length > nCols && fields[fields.length - 1] === '') fields.pop();
    return fields;
}

// Units written bare, as an imaging ellipsometer does: "- nm nm deg us µm".
const BARE_UNIT = /^(?:-|nm|[µμu]m|mm|cm|m|deg|°|%|ev|cm-?1|1\/cm|s|ms|[µμu]s|min|h|counts?|a\.?u\.?|arb\.?)$/i;

// A row of units rather than names: "[nm] ;[counts] ;[%]". Avantes and others
// split the header over two lines, names above, units below.
function isUnitRow(fields) {
    const filled = fields.filter(field => field !== '');
    return filled.length > 0
        && filled.every(field => /^[[(].*[\])]$/.test(field) || BARE_UNIT.test(field));
}

/**
 * A variable-angle header that names the angles once per quantity.
 *
 * Woollam CompleteEASE writes a multi-angle measurement as one wide table
 * headed "Wavelength (nm)  Psi (45.00, 50.00°)  Delta (45.00, 50.00°)" over
 * 1 + 2n columns. The pair for each angle sits side by side, Ψ then Δ at the
 * first angle and then at the next, which is what its exports hold and not what
 * the header's order suggests. Each column is named after its own quantity and
 * angle, and the angle travels with the column.
 */
function angleListLayout(line, nCols, decimal) {
    const psi = String(line || '').match(/\bpsi\s*\(([^)]*)\)/i);
    const delta = String(line || '').match(/\bdelta\s*\(([^)]*)\)/i);
    if (!psi || !delta) return null;
    const angles = text => text.split(',')
        .map(field => parseNumber(field.replace(/°/g, ''), decimal))
        .filter(Number.isFinite);
    const psiAngles = angles(psi[1]);
    const deltaAngles = angles(delta[1]);
    const same = psiAngles.length === deltaAngles.length
        && psiAngles.every((angle, index) => Math.abs(angle - deltaAngles[index]) <= 1e-9);
    if (!psiAngles.length || !same || nCols !== 1 + 2 * psiAngles.length) return null;
    const names = [String(line).slice(0, Math.min(psi.index, delta.index)).trim()];
    const aois = [null];
    for (const angle of psiAngles) {
        const label = Number.isInteger(angle) ? angle : angle.toFixed(3);
        names.push(`Psi @${label}°`, `Delta @${label}°`);
        aois.push(angle, angle);
    }
    return { names, units: [], sampleNames: [], aois };
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
// the column labels. `aois` holds an angle per column when the header states
// one per column, and is empty otherwise.
function detectHeaderLayout(headerLines, delimiter, decimal, nCols) {
    for (let i = headerLines.length - 1; i >= 0; i--) {
        if (isDataMarkerLine(headerLines[i])) continue;
        const byAngle = angleListLayout(headerLines[i], nCols, decimal);
        if (byAngle) return byAngle;
        const names = headerFields(headerLines[i], delimiter, nCols);
        if (!isNameRow(names, nCols, decimal)) continue;
        const above = i > 0 && !isDataMarkerLine(headerLines[i - 1])
            ? headerFields(headerLines[i - 1], delimiter, nCols)
            : [];
        const usable = Math.abs(above.length - nCols) <= 1 ? above : [];
        return { ...pairRowAbove(names, usable), aois: [] };
    }
    return { names: [], units: [], sampleNames: [], aois: [] };
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
