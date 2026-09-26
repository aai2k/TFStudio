/**
 * The wavelength grid every spectrum evaluation samples on.
 *
 * Points are start + i·step for a counted i, so a fine step over a long range
 * still ends on the requested end wavelength, and a step below a picometre does
 * not collapse neighbouring points into one. A step that does not divide the
 * range ends on the end wavelength too, after one shorter interval.
 *
 * Run: node tests/lambda_grid.mjs
 */
import assert from 'node:assert/strict';
import { buildLambdaGrid } from '../src/utils/physics/thinFilmMath.js';

// 400-2500 nm at 0.01 nm: 210001 points, the last one at 2500 nm.
{
    const grid = buildLambdaGrid(400, 2500, 0.01);
    assert.equal(grid.length, 210001, 'one point per 0.01 nm step, both ends included');
    assert.equal(grid[0], 400);
    assert.equal(grid[grid.length - 1], 2500, 'the end wavelength is on the grid');
    assert.equal(grid[12345], 523.45, 'an inner point is the decimal wavelength, not a float residue');
}

// A step below 0.001 nm keeps every point distinct and ascending.
{
    const grid = buildLambdaGrid(400, 400.01, 0.0004);
    assert.equal(grid.length, 26);
    for (let i = 1; i < grid.length; i++) {
        assert.ok(grid[i] > grid[i - 1], `point ${i} lies above point ${i - 1}`);
    }
}

// An end that is not a whole number of steps away is still the last point, one
// shorter interval after the last full step; every full step stays in place.
{
    const grid = buildLambdaGrid(380, 780, 3);
    assert.equal(grid.length, 135);
    assert.equal(grid[grid.length - 2], 779, 'the last full step');
    assert.equal(grid[grid.length - 1], 780, 'then the end wavelength');
    for (let i = 0; i < grid.length - 1; i++) assert.equal(grid[i], 380 + 3 * i, `point ${i} is a full step`);
}

// A step that divides the range adds nothing past the end.
{
    const grid = buildLambdaGrid(300, 2500, 5);
    assert.equal(grid.length, 441);
    assert.equal(grid[grid.length - 1], 2500);
    assert.equal(grid[grid.length - 2], 2495);
}

// A step worked out as span/(n − 1) gives n points ending on the end.
{
    for (const [start, end, n] of [[412.7, 1987.3, 301], [300, 2500, 1024], [1.1, 7.9, 97]]) {
        const grid = buildLambdaGrid(start, end, (end - start) / (n - 1));
        assert.equal(grid.length, n, `${start}-${end} in ${n} points`);
        assert.equal(grid[n - 1], end, `${start}-${end} ends on ${end}`);
    }
}

// An end a hair past a whole step is that step's point moved onto the end,
// not a new point a nanometre-billionth after it.
assert.deepEqual(buildLambdaGrid(0, 3.0000000009, 1), [0, 1, 2, 3.000000001]);

// A range shorter than the step keeps its start and adds the end.
assert.deepEqual(buildLambdaGrid(1543, 1543.001, 1), [1543, 1543.001]);

// Degenerate requests.
{
    assert.deepEqual(buildLambdaGrid(550, 550, 1), [550], 'a zero-width range is one point');
    assert.deepEqual(buildLambdaGrid(600, 500, 1), [], 'a reversed range is empty');
    assert.deepEqual(buildLambdaGrid(400, 420, 0), buildLambdaGrid(400, 420, 5),
        'a non-positive step falls back to 5 nm');
    assert.deepEqual(buildLambdaGrid(400, 420, NaN), [400, 405, 410, 415, 420]);
}

console.log('PASS: lambda_grid');
