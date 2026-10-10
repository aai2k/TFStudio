/**
 * The strict number reader refuses a doubled separator instead of reading a
 * different number.
 *
 * parseNumberStrict reads a typed value in the Design Editor's thickness
 * column, the merit table and the data grids, where a value that is not a
 * number is refused and the cell keeps what it had. It took a repeated
 * separator as thousands grouping whatever the digits between, so a doubled-dot
 * typo '550..5' read as 5505 and '0,5,1' as 51. Grouping now needs groups of
 * three. The lenient reader, which turns anything it cannot read into 0, keeps
 * its old reading: there a refused value would be written as 0 on blur.
 *
 *   1. Malformed grouping is refused.
 *   2. Real grouping still reads, in either convention, with a decimal part.
 *   3. A single comma or dot is the decimal mark, as before.
 *
 * Run: node tests/number_parsing_strict_grouping.mjs
 */
import assert from 'node:assert/strict';
import { parseNumberStrict } from '../src/utils/misc/numberParsing.js';

// ── 1. Malformed grouping ────────────────────────────────────────────────────
for (const text of ['550..5', '94..2', '1.2.3', '0,5,1', '1,2,3,4', '12,34.5', '1,000,5', '1.00.000', '-0..5']) {
    assert.ok(Number.isNaN(parseNumberStrict(text)), `'${text}' is refused, not read as ${parseNumberStrict(text)}`);
}

// ── 2. Grouping ──────────────────────────────────────────────────────────────
for (const [text, value] of [
    ['1,000,000', 1000000], ['1.000.000', 1000000], ['1.000,5', 1000.5], ['1,000.5', 1000.5],
    ['-1,000.25', -1000.25], ['12.345,678', 12345.678], ['1,000.5e3', 1000500], ['1.000.000e3', 1e9],
]) {
    assert.equal(parseNumberStrict(text), value, `'${text}'`);
}

// ── 3. One separator ─────────────────────────────────────────────────────────
for (const [text, value] of [['94,2', 94.2], ['94.2', 94.2], [' -3,14 ', -3.14], ['1.5E-3', 0.0015], ['.5', 0.5]]) {
    assert.equal(parseNumberStrict(text), value, `'${text}'`);
}
assert.ok(Number.isNaN(parseNumberStrict('')), 'an empty cell has no value');
assert.ok(Number.isNaN(parseNumberStrict('94abc')), 'trailing text is refused');

console.log('Strict number grouping tests passed.');
