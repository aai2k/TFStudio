// Delimited spectrum-table parser (see spectrumTable.js for the public API
// this backs).

import { X_UNITS } from './constants.js';
import { parseNumber, splitFields, sniffDelimiter, detectDecimal } from './numberParsing.js';
import { detectXUnit, guessXUnitFromRange, detectQuantity, detectIsPercent, isAbsorbanceHeader } from './headerHeuristics.js';
import {
    detectHeaderLayout, isDataMarkerLine, uniqueColumnNames,
} from './headerLayout.js';
import { buildColumn, columnDescriptors, columnXUnit } from './columnModel.js';

// Failure/empty result shape shared by every early exit of parseSpectrumTable.
function emptyTable(error, extra = {}) {
    return {
        ok: false, error,
        delimiter: ',', decimal: '.',
        headerText: '', headerLines: [], nRows: 0, skippedRows: 0,
        xUnit: X_UNITS.UNKNOWN, x: [], columns: [],
        ...extra,
    };
}

/**
 * Fields of one data row, or null if the line is not data.
 *
 * A data row is a wavelength followed by at least one value. Some instruments
 * tag every row with the measurement it belongs to, as ADAP does with
 * `uR 402.5238 0.0 0.237728 0.01`, so a leading non-numeric field is accepted
 * when everything after it is a number. That last part is what keeps prose out:
 * "Integration Time (sec): 1.0" has a non-numeric field after the first one.
 */
function dataRowFields(line, delimiter, decimal, allowTag = false) {
    if (!line.trim()) return null;
    const fields = splitFields(line, delimiter);
    if (fields.length >= 2
        && Number.isFinite(parseNumber(fields[0], decimal))
        && Number.isFinite(parseNumber(fields[1], decimal))) {
        return fields;
    }
    if (allowTag && fields.length >= 3
        && !Number.isFinite(parseNumber(fields[0], decimal))
        && fields.slice(1).every(field => Number.isFinite(parseNumber(field, decimal)))) {
        return fields.slice(1);
    }
    return null;
}

// Column count = the modal field count among data rows (robust to a stray
// ragged row).
function modalFieldCount(dataRows) {
    const counts = {};
    for (const r of dataRows) counts[r.length] = (counts[r.length] || 0) + 1;
    return +Object.keys(counts).reduce((a, b) => counts[b] > counts[a] ? b : a);
}

/**
 * Where the numbers start, and whether the rows carry a leading tag.
 *
 * A marker line says where the header ends. Without one the first line holding
 * two numbers has to stand in, and a header full of numeric settings then puts
 * its own values into the spectrum: a PerkinElmer PEDS export opens with the
 * excitation wavelength and the scan range. The marker is only a hint, so a
 * file that closes with one rather than introducing its data with one still
 * imports. Row tags are the last reading tried, because "Wavelength,1,2,3" is a
 * header naming its samples by number, and taking it for a tag and three values
 * would eat the only line carrying the column names.
 */
function locateData(rawLines, delimiter, decimal) {
    const markerIndex = rawLines.findIndex(isDataMarkerLine);
    const findFrom = (start, allowTag) => {
        for (let i = start; i < rawLines.length; i++) {
            if (dataRowFields(rawLines[i], delimiter, decimal, allowTag)) return i;
        }
        return -1;
    };
    const attempts = markerIndex >= 0
        ? [[markerIndex + 1, false], [markerIndex + 1, true], [0, false], [0, true]]
        : [[0, false], [0, true]];
    for (const [start, allowTag] of attempts) {
        const firstData = findFrom(start, allowTag);
        if (firstData >= 0) return { firstData, allowTag };
    }
    return { firstData: -1, allowTag: false };
}

/**
 * Every data row from `firstData` on, and a count of the lines between them
 * that held none.
 *
 * A blank or comment line inside the block is stepped over rather than ending
 * it, because instruments append statistics footers, and those simply never
 * match a data row. The count matters: a Shimadzu export can alternate a value
 * row with an empty one, and losing half a measurement in silence is worse than
 * losing it loudly.
 */
function collectDataRows(rawLines, firstData, delimiter, decimal, allowTag) {
    const dataRows = [];
    let skippedRows = 0;
    let pendingSkips = 0;
    for (let i = firstData; i < rawLines.length; i++) {
        const row = dataRowFields(rawLines[i], delimiter, decimal, allowTag);
        if (row) {
            dataRows.push(row);
            skippedRows += pendingSkips;
            pendingSkips = 0;
        } else if (rawLines[i].trim() !== '' && !isDataMarkerLine(rawLines[i])) {
            pendingSkips++;
        }
    }
    return { dataRows, skippedRows };
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
 *   skippedRows: number,   lines inside the data block that held no row
 *   xUnit: string, x: number[],
 *   columns: Array<{ index:number, name:string, unit:string, sampleName:string,
 *     xIndex:number, x:number[], xUnit:string, values:number[],
 *     quantity:(string|null), isPercent:boolean, isAbsorbance:boolean }>
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

    const { firstData, allowTag } = locateData(rawLines, delimiter, decimal);
    if (firstData < 0) {
        return emptyTable('No numeric data rows found', { delimiter, decimal, headerLines: rawLines });
    }
    const headerLines = rawLines.slice(0, firstData)
        .filter(line => line.trim() !== '' && !isDataMarkerLine(line));

    const { dataRows, skippedRows } = collectDataRows(rawLines, firstData, delimiter, decimal, allowTag);
    const nCols = modalFieldCount(dataRows);
    const { names: columnNames, units: columnUnits, sampleNames } =
        detectHeaderLayout(headerLines, delimiter, decimal, nCols);
    const headerText = headerLines.join('\n');

    // Parse all columns first so later columns that repeat the primary X axis
    // can become sample boundaries instead of being offered as Y data.
    const allValues = Array.from({ length: nCols }, () => []);
    for (const r of dataRows) {
        if (r.length < nCols) continue;        // skip ragged short rows
        for (let c = 0; c < nCols; c++) allValues[c].push(parseNumber(r[c], decimal));
    }
    const x = allValues[0];

    const xUnit = columnXUnit(headerText, columnNames[0], x);

    const namedColumns = uniqueColumnNames(columnDescriptors({
        nCols, allValues, headerText, columnNames, columnUnits, sampleNames,
    }));
    const columns = namedColumns.map(column => buildColumn({
        ...column,
        hasColumnNames: columnNames.length > 0,
        headerText,
    }));

    return {
        ok: true, delimiter, decimal, headerText, headerLines,
        nRows: x.length, skippedRows, xUnit, x, columns,
    };
}
