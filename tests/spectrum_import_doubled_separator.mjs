/**
 * A spectrum file with a doubled separator imports no made-up number.
 *
 * In a file read with a comma as the decimal mark, a dot is a thousands
 * separator. The reader used to drop every dot whatever the digits between, so
 * a typo '94..2' imported as 942 % with no skipped row. A dot now counts only
 * between groups of three; anything else is not a number, so the row is skipped
 * and counted, as any other unreadable line in the data block is.
 *
 *   1. The typo row is skipped and counted; the rows around it are read.
 *   2. Grouping in threes still reads ('1.234,5').
 *   3. Curve Editor paste, which reads through the same parser, keeps no 942,
 *      and a pasted column with one mistyped value keeps its other values in
 *      one column, the typo a blank cell.
 *
 * Run: node tests/spectrum_import_doubled_separator.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { parseSpectrumTable } = await import('../src/utils/io/spectrumTable.js');
const { parseNumber } = await import('../src/utils/io/spectrumTable/numberParsing.js');
const { readPastedText } = await import('../src/components/windows/dataExchange/curveEditor/tableText.js');

const FILE = 'nm;T\n400,0;88,51\n401,0;94..2\n402,0;93,10\n';

// ── 1. The typo row ──────────────────────────────────────────────────────────
{
    const parsed = parseSpectrumTable(FILE);
    assert.ok(parsed.ok);
    assert.equal(parsed.decimal, ',', 'setup: read with a decimal comma');
    assert.deepEqual(parsed.x, [400, 402], 'the rows around the typo are read');
    assert.deepEqual(parsed.columns[0].values, [88.51, 93.1], 'and no value of 942 appears');
    assert.equal(parsed.skippedRows, 1, 'the typo row is counted as skipped');
}

// ── 2. Grouping ──────────────────────────────────────────────────────────────
assert.equal(parseNumber('1.234,5', ','), 1234.5, 'a dot between groups of three is grouping');
assert.equal(parseNumber('12.345.678,9', ','), 12345678.9);
assert.equal(parseNumber('1.000', ','), 1000);
for (const field of ['94..2', '1.2,5', '12.34,5', '1.2.3']) {
    assert.ok(Number.isNaN(parseNumber(field, ',')), `'${field}' is not a number`);
}

// ── 3. Paste ─────────────────────────────────────────────────────────────────
{
    const { grid } = readPastedText(FILE);
    assert.ok(!grid.flat().includes(942), `a pasted block keeps no 942: ${JSON.stringify(grid)}`);
    // A column copied in a comma-decimal locale, one value mistyped: the other
    // values keep their places and the typo is a blank cell, rather than every
    // value split at its decimal comma into two columns.
    const column = readPastedText('88,51\n94..2\n93,10\n').grid;
    assert.equal(column.length, 3, `three rows: ${JSON.stringify(column)}`);
    assert.deepEqual([column[0], column[2]], [[88.51], [93.1]], 'the readable values are one column');
    assert.ok(column[1].length === 1 && Number.isNaN(column[1][0]), 'the typo is a blank cell');
    // A dot-decimal column reads as before: a line that is not a number, such
    // as a date above the values, is left out.
    assert.deepEqual(readPastedText('10.10.2026\n550\n560').grid, [[550], [560]], 'a dot-decimal column is unchanged');
}

console.log('Spectrum import doubled separator tests passed.');
