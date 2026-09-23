/**
 * Level contents of the three games with levels: Turning Point runs, Breakout
 * layouts, and Sputter Storm openings and rows.
 *
 * Run: node tests/games_levels.mjs
 */

import { SEED, makeGame } from './_gamesHarness.mjs';
import { levelPlan, layerPlan, PATTERNS } from '../src/components/windows/information/games/turningPointLevels.js';
import {
    layoutFor, LEVEL_COUNT, ROWS, COLS, bandOf, buildBricks, BOUNDS,
} from '../src/components/windows/information/games/refractingBreakoutBoard.js';
import { hpRange } from '../src/components/windows/information/games/sputterStormStack.js';
import {
    layoutFor as stormLayout, rowsFor, readLine, KINDS,
    LEVEL_COUNT as STORM_LEVELS, OPENING_ROWS,
} from '../src/components/windows/information/games/sputterStormLevels.js';
import { COLS as STORM_COLS } from '../src/components/windows/information/games/sputterStormBoard.js';

let fails = 0;
function check(name, fn) {
    try {
        console.log(`  ok   ${name}  (${fn() || ''})`);
    } catch (e) {
        console.error(`  FAIL ${name}: ${e.message}`);
        fails++;
    }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('games_levels: ladders, layouts and openings\n');

// Every generated run must be playable: the signal stays on the trace, the
// target can be cut, and a run number always gives the same run.
check('the run ladder is generated, sane and repeatable', () => {
    const seen = new Set();
    for (let level = 1; level <= 200; level++) {
        const plan = levelPlan(level);
        const again = levelPlan(level);
        assert(PATTERNS.includes(plan.pattern), `run ${level} has pattern ${plan.pattern}`);
        assert(plan.pattern === again.pattern && plan.layers === again.layers,
            `run ${level} is not the same run twice`);
        assert(plan.layers >= 4 && plan.layers <= 12, `run ${level} has ${plan.layers} layers`);
        assert(plan.rate > 0 && plan.rate <= 0.7, `run ${level} grows at ${plan.rate} qwot/s`);
        assert(plan.noiseAmp > 0 && plan.noiseAmp < 0.1, `run ${level} noise is ${plan.noiseAmp}`);
        for (let i = 0; i < plan.layers; i++) {
            const layer = layerPlan(plan);
            assert(layer.target === 1 || layer.target === 2,
                `run ${level} layer ${i + 1} asks for ${layer.target} turning points`);
            assert(layer.mid - layer.amp > 0 && layer.mid + layer.amp < 1,
                `run ${level} layer ${i + 1} swings off the trace`);
        }
        seen.add(plan.pattern);
    }
    assert(seen.size === PATTERNS.length, `only ${seen.size} of ${PATTERNS.length} patterns came up`);
    return `200 runs, all ${PATTERNS.length} patterns, repeatable`;
});

// Layouts: right shape, all different, and not too small.
check('the breakout layouts are the right shape, all different, and big', () => {
    const shapes = new Set();
    let most = 0;
    for (let level = 1; level <= LEVEL_COUNT * 3; level++) {
        const layout = layoutFor(level);
        assert(layout.length === ROWS, `level ${level} has ${layout.length} brick rows, not ${ROWS}`);
        for (const row of layout) {
            assert(row.length === COLS, `level ${level} has a row ${row.length} wide, not ${COLS}`);
            assert(/^[#.]+$/.test(row), `level ${level} has a row with something other than bricks in it`);
        }
        const bricks = layout.join('').split('#').length - 1;
        assert(bricks >= 40, `level ${level} has only ${bricks} bricks`);
        if (level <= LEVEL_COUNT) { shapes.add(layout.join('')); most = Math.max(most, bricks); }
    }
    assert(shapes.size === LEVEL_COUNT, `only ${shapes.size} of ${LEVEL_COUNT} layouts are different`);
    assert(most >= 140, `the biggest level is only ${most} bricks`);
    assert(layoutFor(1)[0] === layoutFor(1 + LEVEL_COUNT)[0], 'the layouts do not cycle');
    return `${LEVEL_COUNT} layouts, ${ROWS}x${COLS}, up to ${most} bricks`;
});

// A brick takes its medium's colour, so none may lie across an interface.
check('no brick straddles an interface, and every level fills the stack', () => {
    const media = new Set();
    for (let level = 1; level <= LEVEL_COUNT; level++) {
        const board = { level };
        buildBricks(board);
        for (const brick of board.bricks) {
            const band = bandOf(brick.y);
            assert(band === bandOf(brick.y + brick.h - 0.001),
                `level ${level} has a brick at y ${brick.y} lying across an interface`);
            assert(brick.y + brick.h < BOUNDS[BOUNDS.length - 1],
                `level ${level} has a brick below the last interface, where the paddle is`);
            media.add(band);
        }
        assert(board.bricks.length > 0, `level ${level} built no bricks`);
    }
    assert(media.size >= 3, `the layouts only ever reach ${media.size} of the media`);
    return `${LEVEL_COUNT} levels, ${media.size} media, no brick across an interface`;
});

// Openings: right size, only legend characters, all different, and the same
// level on every play.
check('every Sputter Storm level opens with its own arrangement', () => {
    const shapes = new Set();
    for (let level = 1; level <= STORM_LEVELS * 2; level++) {
        const layout = stormLayout(level);
        assert(layout.length === OPENING_ROWS,
            `level ${level} opens with ${layout.length} rows, not ${OPENING_ROWS}`);
        let cells = 0;
        for (const line of layout) {
            assert(line.length === STORM_COLS,
                `level ${level} has a line ${line.length} wide, not ${STORM_COLS}`);
            for (const ch of line) {
                assert(ch === '.' || KINDS[ch], `level ${level} has "${ch}" in it, which is not in the legend`);
            }
            cells += readLine(line).length;
        }
        assert(cells >= 20, `level ${level} opens with only ${cells} cells`);
        if (level <= STORM_LEVELS) shapes.add(layout.join(''));
    }
    assert(shapes.size === STORM_LEVELS, `only ${shapes.size} of ${STORM_LEVELS} openings are different`);
    assert(stormLayout(1)[0] === stormLayout(1 + STORM_LEVELS)[0], 'the openings do not cycle');

    // Seeded by the level number, not by the game seed.
    const hud = (n) => makeGame('sputterStorm', n * 7919, { level: 5 }).game.hud().map(r => r[1]).join();
    assert(hud(1) === hud(2), 'the same level came out different twice');
    return `${STORM_LEVELS} openings, ${OPENING_ROWS}x${STORM_COLS}, all different and repeatable`;
});

// A level sends one row per turn until its run is out, and block hp depends
// on the level, not on the turn.
check('a level sends a fixed run of rows, and toughness follows the level not the turn', () => {
    let ranOut = false;
    for (const level of [1, 5]) {
        const [low, high] = hpRange(level);
        const { game, frame, step } = makeGame('sputterStorm', SEED, { level });
        const on = () => game.hud()[0][1];
        const turn = () => game.hud()[1][1];
        const rowsLeft = () => game.hud()[2][1];
        assert(game.hud()[4][1] > 0, `level ${level} opened with an empty board`);

        let worst = 0;
        // Stop at the next level, which may have tougher blocks.
        for (let i = 0; i < 40000 && on() === level; i++) {
            step();
            if (on() !== level) break;
            // Checked every frame: a bot that loses restarts the level and may
            // never reach the end of the run.
            const due = Math.max(0, rowsFor(level) - (turn() - 1));
            assert(rowsLeft() === due,
                `level ${level} is on turn ${turn()} with ${rowsLeft()} rows to come, not ${due}`);
            for (const text of frame.texts) {
                if (/^\d+$/.test(text.str)) worst = Math.max(worst, Number(text.str));
            }
            ranOut = ranOut || rowsLeft() === 0;
            if (i % 4 === 0) {
                game.onPointer('pointerdown', 30 + (i * 53) % 660, 60 + (i * 17) % 260);
                game.onPointer('pointerup', 0, 0);
            }
        }
        assert(worst >= low && worst <= high,
            `level ${level} put a ${worst} hit block up, outside the ${low} to ${high} a level ${level} block can be`);
    }
    assert(ranOut, 'no level was played to the end of its run, so where the rows stop is untested');
    return 'levels 1 and 5, one row a turn and none after the run, no block outside its level band';
});

console.log('');
if (fails === 0) { console.log('PASS games_levels'); process.exit(0); }
console.error(`${fails} failure(s).`);
process.exit(1);
