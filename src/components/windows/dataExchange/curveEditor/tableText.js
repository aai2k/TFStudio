/**
 * Text into and out of a curve editor table: a file read whole, a block pasted
 * at the selection, and the table written as CSV.
 *
 * Text is read by the Measured Spectra importer's parser, parseSpectrumTable,
 * which finds the delimiter and a decimal comma in the text itself and takes
 * units and quantities from a header, so a table copied from Excel in a
 * comma-decimal locale reads the way the same table saved as a file imports.
 */
import {
    X_UNITS, detectDecimal, parseNumber, parseSpectrumTable, tableToCsv,
} from '../../../../utils/io/spectrumTable.js';
import { parseCellGrid } from '../../../ui/grid/gridModel.js';
import {
    addColumn, columnIndex, gridFor, setCells, setColumn, setXUnit, withRowCount, X_KEY,
} from './curveTable.js';
import { KIND_QUANTITIES, unitForQuantity } from './units.js';
import { typeColumns } from '../measuredEllipsometry/model.js';

// What a parsed column says it is, read the way each importer reads it. A
// spectrum column the parser could not type is T, and an absorbance column is
// T in optical density. Ψ and Δ are told apart as Measured Ellipsometry does.
function spectrumColumn(column) {
    if (column.isAbsorbance) return { quantity: 'T', unit: 'OD' };
    const quantity = KIND_QUANTITIES.spectrum.includes(column.quantity) ? column.quantity : 'T';
    return { quantity, unit: column.isPercent ? '%' : 'fraction' };
}

function parsedColumns(kind, columns) {
    if (kind === 'weight') return columns.map(() => ({ quantity: 'W', unit: 'rel' }));
    if (kind === 'ellipsometry') {
        return typeColumns(columns).map(quantity => ({ quantity: quantity || 'PSI', unit: 'deg' }));
    }
    return columns.map(spectrumColumn);
}

function baseName(fileName) {
    return (fileName || '').replace(/\.[^.]+$/, '');
}

// The name the importers give a column of a file: the file's, and the column's
// own after it when the file holds several.
function columnName(fileName, parsed, column) {
    const base = baseName(fileName);
    if (!base) return parsed.columns.length > 1 ? column.name : '';
    return parsed.columns.length > 1 ? `${base}: ${column.name}` : base;
}

/**
 * A file's table as an editor table, or { error } when it holds no table of
 * numbers. A table whose columns are fixed keeps them and takes the file's
 * first columns into them, in the file's unit where the quantity allows it.
 */
export function tableFromText(text, base, fileName = '') {
    const parsed = parseSpectrumTable(text);
    if (!parsed.ok) return { error: 'parse' };
    const usable = parsed.columns.filter(column => column.values.length === parsed.x.length);
    if (!usable.length) return { error: 'parse' };
    const read = parsedColumns(base.kind, usable).map((column, index) => ({
        ...column, name: columnName(fileName, parsed, usable[index]),
    }));
    const columns = base.fixed
        ? base.columns.map((column, index) => ({
            ...column, unit: unitForQuantity(column.quantity, read[index]?.unit ?? column.unit),
        }))
        : read;
    const taken = usable.slice(0, columns.length);
    const rows = parsed.x.map((x, row) => [x, ...columns.map((_, index) => taken[index]?.values[row] ?? NaN)]);
    const xUnit = parsed.xUnit === X_UNITS.UNKNOWN ? X_UNITS.NM : parsed.xUnit;
    return { table: { ...base, xUnit, columns, rows, source: fileName || base.source } };
}

// A header's units for a pasted block: the wavelength unit when it names one,
// and what each value column is.
function headerUnits(parsed) {
    if (!parsed.ok || !parsed.headerLines.length) return null;
    return {
        xUnit: parsed.xUnit === X_UNITS.UNKNOWN ? null : parsed.xUnit,
        columns: parsed.columns,
    };
}

// The numbers of a tab-separated block cell by cell, with the decimal mark the
// parser found for the whole text. A blank cell stays blank, so the cells keep
// the places they had in the spreadsheet they were copied from. Lines that hold
// no number, a header, are left out.
function tabbedGrid(text, decimal) {
    return parseCellGrid(text)
        .map(line => line.map(cell => parseNumber(cell, decimal)))
        .filter(line => line.some(Number.isFinite));
}

// One number per line, read with the decimal mark found in the text, or null.
// A single cell or column copied from a spreadsheet in a comma-decimal locale
// arrives as "0,5" alone on its line, which a table parser would split into
// two columns, 0 and 5.
function singleColumn(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const decimal = detectDecimal(text);
    const values = lines.map(line => parseNumber(line, decimal));
    return values.length && values.every(Number.isFinite) ? values.map(value => [value]) : null;
}

/**
 * A pasted text as a grid of numbers, NaN for a blank cell, with the units a
 * header gives (null without one). A spreadsheet's clipboard is tab-separated
 * and is read cell by cell; other text, a CSV or a table copied from a file, is
 * read as the importer reads a file.
 */
export function readPastedText(text) {
    const column = text.includes('\t') ? null : singleColumn(text);
    if (column) return { grid: column, header: null };
    const parsed = parseSpectrumTable(text);
    const decimal = parsed.ok ? parsed.decimal : detectDecimal(text);
    const header = headerUnits(parsed);
    if (text.includes('\t') || !parsed.ok) return { grid: tabbedGrid(text, decimal), header };
    const grid = parsed.x.map((x, row) => [x, ...parsed.columns.map(column => column.values[row])]);
    return { grid, header };
}

// Room for a block laid from the focused cell: rows, and on a table whose
// columns are not fixed, value columns.
function grownFor(table, focus, grid) {
    let grown = withRowCount(table, focus.rowIdx + grid.length);
    const width = Math.max(...grid.map(line => line.length));
    const needed = columnIndex(focus.colKey) + width - 1;
    while (!grown.fixed && grown.columns.length < needed) grown = addColumn(grown);
    return grown;
}

// A pasted header's units, taken when the block starts at the wavelength.
function withHeaderUnits(table, header, focus) {
    if (!header || focus.colKey !== X_KEY) return table;
    let next = header.xUnit ? setXUnit(table, header.xUnit) : table;
    parsedColumns(table.kind, header.columns).forEach((column, index) => {
        if (index >= next.columns.length) return;
        const patch = next.fixed ? { unit: column.unit } : column;
        next = setColumn(next, index, patch);
    });
    return next;
}

/**
 * The table with a pasted block laid on it. Cells gathered with Ctrl take a
 * single value each; over a range the block repeats to fill it; from one cell
 * it is laid down and to the right, and the table grows to hold it.
 */
export function pasteIntoTable(table, pasted, selection) {
    const { range, extraCells, focus } = selection;
    const text = pasted.grid.map(line => line.map(value => (Number.isFinite(value) ? value : '')));
    if (!text.length || !focus) return table;
    const single = text.length === 1 && text[0].length === 1;
    if (single && extraCells?.size) {
        const cells = gridFor(table).selectedCells(selection);
        return text[0][0] === '' ? table : setCells(table, cells.map(cell => ({ ...cell, value: text[0][0] })));
    }
    const target = range ? table : grownFor(table, focus, text);
    const targets = gridFor(target).pasteTargets({ grid: text, range, focus, rows: target.rows });
    const filled = setCells(target, targets.map(cell => ({ rowIdx: cell.rowIdx, colKey: cell.colKey, value: cell.text })));
    return range ? filled : withHeaderUnits(filled, pasted.header, focus);
}

const CSV_X_LABEL = {
    [X_UNITS.NM]: 'Wavelength (nm)',
    [X_UNITS.UM]: 'Wavelength (µm)',
    [X_UNITS.CM1]: 'Wavenumber (cm-1)',
    [X_UNITS.EV]: 'Photon energy (eV)',
};
const CSV_QUANTITY = { T: 'T', R: 'R', A: 'A', PSI: 'Psi', DEL: 'Delta', W: 'weight' };
const CSV_UNIT = { '%': ' (%)', fraction: '', dB: ' (dB)', OD: ' (OD)', deg: ' (deg)', rel: '' };

/**
 * The table as CSV, its column names written the way the importers read them
 * back: a T column in percent is headed "T (%)", one in density "T (OD)".
 */
export function tableCsv(table) {
    return tableToCsv({
        x: table.rows.map(row => row[0]),
        xLabel: CSV_X_LABEL[table.xUnit] || CSV_X_LABEL[X_UNITS.NM],
        columns: table.columns.map((column, index) => ({
            name: `${column.name || CSV_QUANTITY[column.quantity]}${CSV_UNIT[column.unit] ?? ''}`,
            values: table.rows.map(row => row[index + 1]),
        })),
    });
}
