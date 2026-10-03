/**
 * The fill handle's series rules (ui/grid/gridFill.js): what a drag down or up
 * writes from the selected numbers of each column, how far it reaches, and
 * which selections have a handle.
 * Run: node tests/grid_fill.mjs
 */
import assert from 'node:assert/strict';
import {
    continuedCells, fillReach, fillSource, filledRows, seriesValues,
} from '../src/components/ui/grid/gridFill.js';
import { createGridModel } from '../src/components/ui/grid/gridModel.js';
import { tidy } from '../src/components/windows/dataExchange/curveEditor/curveTable.js';

const close = (actual, expected) => actual.forEach((value, index) =>
    assert.ok(Math.abs(value - expected[index]) < 1e-9, `${value} is not ${expected[index]}`));

// ── One number ───────────────────────────────────────────────────────────────
{
    assert.deepEqual(seriesValues([400], 3), [400, 400, 400], 'one number is copied');
    assert.deepEqual(seriesValues([400], 3, { up: true }), [400, 400, 400], 'up as well');
    assert.deepEqual(seriesValues([400], 3, { ctrl: true }), [401, 402, 403], 'Ctrl counts up by 1 going down');
    assert.deepEqual(seriesValues([400], 3, { up: true, ctrl: true }), [399, 398, 397], 'and down by 1 going up');
    assert.deepEqual(seriesValues([NaN, 7, NaN], 2), [7, 7], 'empty cells beside it change nothing');
}

// ── Two or more: the least-squares straight line ─────────────────────────────
{
    assert.deepEqual(seriesValues([400, 410], 4), [420, 430, 440, 450], 'two numbers give their step');
    assert.deepEqual(seriesValues([400, 410], 4, { ctrl: true }), [420, 430, 440, 450], 'Ctrl does not change a trend');
    assert.deepEqual(seriesValues([1, 3], 3), [5, 7, 9]);
    assert.deepEqual(seriesValues([100, 95], 2), [90, 85], 'a falling series keeps falling');
    close(seriesValues([1, 3, 4], 3), [17 / 3, 43 / 6, 26 / 3]);
    assert.deepEqual(seriesValues([1, 3, 4], 3).map(value => Number(value.toFixed(2))), [5.67, 7.17, 8.67],
        '1, 3, 4 goes on along its best straight line');
    assert.deepEqual(seriesValues([400, 410], 2, { up: true }), [390, 380], 'dragged up, the line runs back');
    assert.deepEqual(seriesValues([400, NaN, 420], 2), [430, 440], 'an empty cell keeps its row in the line');
}

// ── No number ────────────────────────────────────────────────────────────────
{
    assert.equal(seriesValues([NaN, undefined], 3), null);
    const source = { rowStart: 0, rowEnd: 1, colKeys: ['x', 'v0'] };
    const rows = [[400, NaN], [410, NaN]];
    const read = (rowIdx, colKey) => rows[rowIdx][colKey === 'x' ? 0 : 1];
    const cells = continuedCells(source, { up: false, count: 2 }, read);
    assert.deepEqual(cells, [
        { rowIdx: 2, colKey: 'x', value: 420 }, { rowIdx: 3, colKey: 'x', value: 430 },
    ], 'a column with no number is left alone');
}

// ── Tidy rounding ────────────────────────────────────────────────────────────
{
    const raw = seriesValues([400, 400.1], 9);
    assert.notDeepEqual(raw, raw.map(tidy), 'the line alone carries binary rounding');
    assert.deepEqual(raw.map(tidy), [400.2, 400.3, 400.4, 400.5, 400.6, 400.7, 400.8, 400.9, 401]);
    assert.deepEqual(seriesValues([0.1, 0.2], 3).map(tidy), [0.3, 0.4, 0.5]);
}

// ── How far a drag reaches ───────────────────────────────────────────────────
{
    const source = { rowStart: 3, rowEnd: 5, colKeys: ['x'] };
    assert.deepEqual(fillReach(source, 9), { up: false, count: 4 });
    assert.deepEqual(fillReach(source, 1), { up: true, count: 2 });
    assert.deepEqual(fillReach(source, -7), { up: true, count: 3 }, 'up it stops at the first row');
    assert.equal(fillReach(source, 4), null, 'back inside the selection it reaches nothing');
    assert.equal(fillReach(source, 3), null);
    assert.equal(fillReach({ ...source, rowStart: 0 }, -2), null, 'from row 0 there is nothing above');
    assert.deepEqual(filledRows(source, { up: false, count: 4 }), { first: 6, last: 9 });
    assert.deepEqual(filledRows(source, { up: true, count: 2 }), { first: 1, last: 2 });
}

// ── Which selections have a handle ───────────────────────────────────────────
{
    const grid = createGridModel(['x', 'v0', 'v1']);
    const focus = { rowIdx: 2, colKey: 'v0' };
    assert.deepEqual(fillSource(grid, { range: null, extraCells: new Set(), focus }, 10),
        { rowStart: 2, rowEnd: 2, colKeys: ['v0'] }, 'one focused cell');
    const range = { rowStart: 1, rowEnd: 4, colKeys: ['x', 'v0'] };
    assert.deepEqual(fillSource(grid, { range, extraCells: new Set(), focus }, 10), range, 'a range');
    assert.deepEqual(fillSource(grid, { range, extraCells: new Set(), focus }, 3),
        { ...range, rowEnd: 2 }, 'rows past the table are left out');
    assert.equal(fillSource(grid, { range: null, extraCells: new Set(), focus: null }, 10), null);
    const square = new Set(['0:x', '0:v0', '1:x']);
    assert.deepEqual(fillSource(grid, { range: null, extraCells: square, focus: { rowIdx: 1, colKey: 'v0' } }, 10),
        { rowStart: 0, rowEnd: 1, colKeys: ['x', 'v0'] }, 'Ctrl-added cells that make one rectangle');
    const scattered = new Set(['0:x', '3:x']);
    assert.equal(fillSource(grid, { range: null, extraCells: scattered, focus: { rowIdx: 3, colKey: 'x' } }, 10), null,
        'cells that are not one rectangle have no handle');
    const corner = new Set(['0:x', '0:v1']);
    assert.equal(fillSource(grid, { range: null, extraCells: corner, focus: { rowIdx: 0, colKey: 'v1' } }, 10), null,
        'nor do cells with a column missing between them');
}

console.log('PASS: grid_fill');
