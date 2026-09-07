/**
 * Only the rows over the scroller are built.
 *
 * A row is eleven cells and an operand-type picker. With every row of a large
 * merit function in the page, the browser lays all of them out again each time
 * the pane changes width, which is once a frame while a dock divider is
 * dragged, however little React is doing. The window keeps the built rows to
 * what is visible; the arithmetic below is what places them, so it has to
 * account for exactly the table's height whatever the scroller is doing.
 * Run: node tests/mf_table_row_window.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { ROW_H, rowWindow, scrollToRow } from
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/rowWindow.js';

shimBrowserGlobals();
await loadApp();
const { MFTable } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/mfTable/MFTable.js');

const built = view => view.to - view.from + 1;
// A window must always describe the whole table: the rows it builds plus the
// space standing in for the rest come to the height every row would occupy.
const spansTable = (view, count) =>
    view.padTop + built(view) * ROW_H + view.padBottom === count * ROW_H;

// ── An empty table builds nothing ────────────────────────────────────────────
{
    for (const count of [0, -1, undefined, null]) {
        const view = rowWindow(count, 0, 440);
        assert.ok(view.to < view.from, 'nothing to build');
        assert.equal(view.padTop + view.padBottom, 0, 'and no space to hold');
    }
}

// ── A table shorter than the pane is built whole ─────────────────────────────
{
    const view = rowWindow(12, 0, 440);
    assert.deepEqual([view.from, view.to], [0, 11]);
    assert.equal(view.padTop + view.padBottom, 0, 'nothing is stood in for');
    assert.ok(spansTable(view, 12));
}

// ── A long table builds a pane's worth wherever it is scrolled ───────────────
{
    for (const count of [600, 8000]) {
        const height = 440;
        const rowsVisible = Math.ceil(height / ROW_H);
        // Every position the scroller can actually be in, ends included.
        const bottom = count * ROW_H - height;
        for (const top of [0, ROW_H * 100, bottom / 2, bottom]) {
            const view = rowWindow(count, top, height);
            assert.ok(built(view) >= rowsVisible,
                `${count} rows at ${top}px: the pane is covered`);
            assert.ok(built(view) <= rowsVisible + 14,
                `${count} rows at ${top}px: little more than the pane is built`);
            assert.ok(spansTable(view, count),
                `${count} rows at ${top}px: the table keeps its full height`);
            assert.ok(view.from >= 0 && view.to <= count - 1, 'the window stays in the table');
        }
    }
}

// ── The rows on screen are inside the window ─────────────────────────────────
// The overscan is what lets a scroll of a line or two reveal rows already built.
{
    const view = rowWindow(8000, ROW_H * 300, 440);
    const firstOnScreen = 300;
    const lastOnScreen = 300 + Math.ceil(440 / ROW_H);
    assert.ok(view.from < firstOnScreen, 'rows are built above the fold');
    assert.ok(view.to > lastOnScreen, 'and below it');
}

// ── A scroller not yet measured still produces a table ───────────────────────
// There is no layout pass behind the first render, so a height of nothing must
// not collapse the window to a couple of rows.
{
    const view = rowWindow(600, 0, 0);
    assert.ok(built(view) > 30, 'a pane of rows stands in until the scroller is read');
    assert.ok(spansTable(view, 600));
}

// ── Scrolling a row into view ────────────────────────────────────────────────
{
    const height = 440;
    const header = 17;
    assert.equal(scrollToRow(50, ROW_H * 50 - header, height, header), null,
        'a row already in view does not move the scroller');
    assert.equal(scrollToRow(10, ROW_H * 40, height, header), 10 * ROW_H,
        'a row above the fold comes to the top, clear of the header');
    assert.equal(scrollToRow(100, 0, height, header), header + 101 * ROW_H - height,
        'a row below the fold comes to the bottom');
    assert.equal(scrollToRow(0, ROW_H * 5, height, header), 0,
        'the first row does not scroll past the start of the table');

    // The header is scrolled content sitting above row 0, so a row spans
    // [header + i*ROW_H, header + (i+1)*ROW_H). Asserting the returned offset
    // against that, rather than against the formula that produced it, is what
    // catches an offset that leaves the row under the header or off the foot.
    for (const rowIdx of [0, 1, 10, 100, 3617]) {
        for (const from of [0, ROW_H * 40, ROW_H * 4000]) {
            const moved = scrollToRow(rowIdx, from, height, header);
            const at = moved == null ? from : moved;
            const rowTop = header + rowIdx * ROW_H;
            assert.ok(rowTop >= at + header && rowTop + ROW_H <= at + height,
                `row ${rowIdx} from ${from}px is wholly between the header and the foot`);
        }
    }
}

// ── Scrolled to the end, the last row is built ───────────────────────────────
{
    const count = 8000;
    const height = 440;
    const view = rowWindow(count, count * ROW_H - height, height);
    assert.equal(view.to, count - 1, 'the last row is reachable');
    assert.equal(view.padBottom, 0, 'and nothing is left standing in below it');
    assert.ok(spansTable(view, count));
}

// ── The table puts a bounded number of rows in the page ─────────────────────
// A row names the operand it stands for, because its position among the built
// rows is not its position in the table.
{
    const operands = Array.from({ length: 4000 }, (_, index) => ({
        id: `op${index}`, type: 'RGT', enabled: true, lambdaStart: 400, lambdaEnd: 700,
        aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1,
    }));
    const html = renderToStaticMarkup(React.createElement(MFTable, {
        operands, computed: operands.map(() => 0.004), selectedId: null,
        noOperandsMsg: 'none', onSelect: () => {}, onEdit: () => {}, onAdd: () => {},
        onInsertAt: () => {}, onDuplicate: () => {}, onDelete: () => {}, onClear: () => {},
        onMoveUp: () => {}, onMoveDown: () => {}, c: makeTheme(), t: makeLocale(),
    }));
    const rows = [...html.matchAll(/data-row="(\d+)"/g)].map(match => Number(match[1]));
    assert.ok(rows.length > 0 && rows.length < 100,
        `a 4000-row table builds ${rows.length} rows, not all of them`);
    assert.equal(rows[0], 0, 'the window starts at the top of the table');
    assert.deepEqual(rows, rows.map((_, index) => index), 'and runs without a gap');
    assert.ok(!html.includes('data-row="3999"'), 'the far end of the table is not built');

    // The rows that are not built are stood in for, so the scrollbar and every
    // row position still match a table of four thousand.
    const missing = 4000 - rows.length;
    assert.ok(html.includes(`height:${missing * ROW_H}px`),
        'the rest of the table is held open by a spacer');

    // ── Nothing in a row may outgrow ROW_H ──────────────────────────────────
    // A row is placed from its index, and `height` on a table row is only a
    // minimum, so any cell content taller than ROW_H silently pushes the whole
    // table out of step with its scrollbar. Two things in a row can: the
    // dropdowns, which the customizable-select UA style gives a 24px minimum
    // height of their own, and the DMFS header, which is a sentence.
    for (const tag of html.match(/<select[^>]*>/g) || []) {
        assert.match(tag, /min-height:0/, `a row dropdown clears the UA minimum: ${tag.slice(0, 90)}`);
        assert.match(tag, new RegExp(`height:${ROW_H - 2}px`),
            `a row dropdown is given a height that fits the row: ${tag.slice(0, 90)}`);
    }
    assert.ok((html.match(/<select[^>]*>/g) || []).length > 0, 'the fixture does render dropdowns');
}

// ── The DMFS header is cut short rather than wrapped ────────────────────────
{
    const long = 'Bandpass, stop 300-450 | pass 500-600 | stop 650-1000 nm, AOI 0-45 deg (5 steps), avg pol, discrete @1 nm';
    const html = renderToStaticMarkup(React.createElement(MFTable, {
        operands: [{ id: 'h', type: 'DMFS', enabled: true, comment: long }],
        computed: [null], selectedId: null, noOperandsMsg: 'none',
        onSelect: () => {}, onEdit: () => {}, onAdd: () => {}, onInsertAt: () => {},
        onDuplicate: () => {}, onDelete: () => {}, onClear: () => {},
        onMoveUp: () => {}, onMoveDown: () => {}, c: makeTheme(), t: makeLocale(),
    }));
    assert.ok(html.includes(long), 'the header is rendered in full');
    const cell = html.match(/<td colspan="\d+"[^>]*>/i)?.[0] || '';
    assert.match(cell, /white-space:nowrap/, 'the DMFS cell does not wrap onto a second line');
    assert.match(cell, /text-overflow:ellipsis/, 'and says so where it is cut');
}

console.log('mf_table_row_window: passed');
