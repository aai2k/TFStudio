// Delimited spectrum-table parser (see spectrumTable.js for the public API
// this backs).

import { X_UNITS } from './constants.js';
import { parseNumber, splitFields, sniffDelimiter, detectDecimal } from './numberParsing.js';
import { detectXUnit, guessXUnitFromRange, detectQuantity, detectIsPercent, isAbsorbanceHeader } from './headerHeuristics.js';

// Failure/empty result shape shared by every early exit of parseSpectrumTable.
function emptyTable(error, extra = {}) {
    return {
        ok: false, error,
        delimiter: ',', decimal: '.',
        headerText: '', headerLines: [], nRows: 0,
        xUnit: X_UNITS.UNKNOWN, x: [], columns: [],
        ...extra,
    };
}

// A line is "data" if its first two fields parse as numbers.
function isSpectrumDataLine(line, delimiter, decimal) {
    if (!line.trim()) return false;
    const f = splitFields(line, delimiter);
    return f.length >= 2 &&
           Number.isFinite(parseNumber(f[0], decimal)) &&
           Number.isFinite(parseNumber(f[1], decimal));
}

// Column count = the modal field count among data rows (robust to a stray
// ragged row).
function modalFieldCount(dataRows) {
    const counts = {};
    for (const r of dataRows) counts[r.length] = (counts[r.length] || 0) + 1;
    return +Object.keys(counts).reduce((a, b) => counts[b] > counts[a] ? b : a);
}

// Column names come from the last header line only IF it splits into ~nCols
// fields and is non-numeric (a real header row like "Wavelength (nm),%T").
function detectColumnNames(headerLines, delimiter, decimal, nCols) {
    if (!headerLines.length) return [];
    const cand = splitFields(headerLines[headerLines.length - 1], delimiter);
    const nonNumeric = cand.filter(f => !Number.isFinite(parseNumber(f, decimal))).length;
    if (cand.length >= 2 && Math.abs(cand.length - nCols) <= 1 && nonNumeric >= 1) return cand;
    return [];
}

function buildColumn(values, k, columnNames, headerText) {
    const name = columnNames[k + 1] || `Column ${k + 2}`;
    const hdr = `${headerText}\n${name}`;
    const isAbsorbance = isAbsorbanceHeader(name) || (columnNames.length === 0 && isAbsorbanceHeader(headerText));
    return {
        index: k + 1,
        name,
        values,
        quantity: detectQuantity(name) || detectQuantity(headerText),
        isPercent: isAbsorbance ? false : detectIsPercent(hdr, values),
        isAbsorbance,
    };
}

/**
 * Parse a delimited spectrum table.
 *
 * @param {string} text  raw file text
 * @param {object} [opts]
 *   opts.delimiter  force ',' | ';' | '\t' | ' '  (default: sniff)
 *   opts.decimal    force '.' | ','               (default: detect)
 * @returns {{
 *   ok: boolean, error?: string,
 *   delimiter: string, decimal: string,
 *   headerText: string, headerLines: string[], nRows: number,
 *   xUnit: string, x: number[],
 *   columns: Array<{ index:number, name:string, values:number[], quantity:(string|null), isPercent:boolean, isAbsorbance:boolean }>
 * }}
 *
 * The first numeric column is X; every remaining numeric column is a Y
 * candidate. X is returned in the SOURCE unit (not yet converted) so callers
 * can show/override the detected unit; makeMeasuredCurve does the nm conversion.
 */
export function parseSpectrumTable(text, opts = {}) {
    if (typeof text !== 'string' || text.trim() === '') {
        return emptyTable('Empty file');
    }

    const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
    const decimal = opts.decimal || detectDecimal(text);

    // Sample non-empty lines for delimiter sniffing.
    const sample = rawLines.filter(l => l.trim()).slice(0, 200);
    const delimiter = opts.delimiter || sniffDelimiter(sample, decimal);

    // Leading non-data lines = header. Find first data line.
    const firstData = rawLines.findIndex(l => isSpectrumDataLine(l, delimiter, decimal));
    if (firstData < 0) {
        return emptyTable('No numeric data rows found', { delimiter, decimal, headerLines: rawLines });
    }
    const headerLines = rawLines.slice(0, firstData).filter(l => l.trim() !== '');

    // Collect contiguous-ish data rows (skip the occasional blank/comment line
    // interspersed, but stop nothing — instruments sometimes append a stats
    // footer of non-numeric lines, which simply won't match isSpectrumDataLine).
    const dataRows = [];
    for (let i = firstData; i < rawLines.length; i++) {
        if (isSpectrumDataLine(rawLines[i], delimiter, decimal)) dataRows.push(splitFields(rawLines[i], delimiter));
    }

    const nCols = modalFieldCount(dataRows);
    const columnNames = detectColumnNames(headerLines, delimiter, decimal, nCols);
    const headerText = headerLines.join('\n');

    // Build X (col 0) + Y columns (cols 1..nCols-1).
    const x = [];
    const colValues = Array.from({ length: nCols - 1 }, () => []);
    for (const r of dataRows) {
        if (r.length < nCols) continue;        // skip ragged short rows
        x.push(parseNumber(r[0], decimal));
        for (let c = 1; c < nCols; c++) colValues[c - 1].push(parseNumber(r[c], decimal));
    }

    let xUnit = detectXUnit(headerText + ' ' + (columnNames[0] || ''));
    if (xUnit === X_UNITS.UNKNOWN) xUnit = guessXUnitFromRange(x);

    const columns = colValues.map((values, k) => buildColumn(values, k, columnNames, headerText));

    return { ok: true, delimiter, decimal, headerText, headerLines, nRows: x.length, xUnit, x, columns };
}
