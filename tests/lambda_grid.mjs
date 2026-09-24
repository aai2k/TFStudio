/**
 * The wavelength grid every spectrum evaluation samples on.
 *
 * Points are start + i·step for a counted i, so a fine step over a long range
 * still ends on the requested end wavelength, and a step below a picometre does
 * not collapse neighbouring points into one.
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

// An end that is not a whole number of steps away stops at the last full step.
{
    const grid = buildLambdaGrid(380, 780, 3);
    assert.equal(grid.length, 134);
    assert.equal(grid[grid.length - 1], 779);
}

// Degenerate requests.
{
    assert.deepEqual(buildLambdaGrid(550, 550, 1), [550], 'a zero-width range is one point');
    assert.deepEqual(buildLambdaGrid(600, 500, 1), [], 'a reversed range is empty');
    assert.deepEqual(buildLambdaGrid(400, 420, 0), buildLambdaGrid(400, 420, 5),
        'a non-positive step falls back to 5 nm');
    assert.deepEqual(buildLambdaGrid(400, 420, NaN), [400, 405, 410, 415, 420]);
}

console.log('PASS: lambda_grid');
