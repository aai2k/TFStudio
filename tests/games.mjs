/**
 * The six games, played headless against the real English locale, so a missing
 * string fails here. Harness and bots: _gamesHarness.mjs. Stage and window:
 * games_window.mjs. Level contents: games_levels.mjs. Message boxes:
 * games_input.mjs.
 *
 * Run: node tests/games.mjs
 */

import en from '../src/constants/locales/en.js';
import { GAMES, W, H, SEED, makeGame, playRunner } from './_gamesHarness.mjs';
import { refractStep } from '../src/components/windows/information/games/snell.js';
import { TURN_MAX_S, DROP_S, START_IONS } from '../src/components/windows/information/games/sputterStorm.js';
import { burstSpacing } from '../src/components/windows/information/games/sputterStormIons.js';
import { ION_R, ROWS_MAX, blocksStanding } from '../src/components/windows/information/games/sputterStormBoard.js';
import {
    indexCells, fireCannon, clearSpent, lowerStack,
} from '../src/components/windows/information/games/sputterStormStack.js';

// Colours for the removal marks on a board built by hand.
const WIN95_COLORS = { l: '#000080', good: '#008000', danger: '#ff0000' };

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

console.log('games: six games, headless\n');

check('all six run, and every string they ask for exists', () => {
    const keys = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS'];
    for (const id of Object.keys(GAMES)) {
        const { game, step } = makeGame(id);
        for (let i = 0; i < 4000; i++) {
            step();
            game.hud();
            if (i % 37 === 0) { const k = keys[i % keys.length]; game.onKey(k, true); game.onKey(k, false); }
            if (i % 53 === 0) {
                game.onPointer('pointerdown', (i * 37) % W, (i * 53) % H);
                game.onPointer('pointermove', (i * 71) % W, (i * 29) % H);
                game.onPointer('pointerup', 0, 0);
            }
        }
    }
    return `${Object.keys(GAMES).length} games, 4000 frames each`;
});

// Checked by playing rather than by reading the drawn bar, since the collision
// box is what decides it.
check('a shutter cannot be jumped, only ducked', () => {
    const run = playRunner({ duckShutters: false });
    assert(run.died, 'jumping cleared every shutter for a minute, so a shutter can be jumped');
    assert(run.kind === 'shutter',
        `the run ended at ${run.at.toFixed(1)} s on ${run.kind} rather than on a shutter`);
    return `died at a shutter after ${run.at.toFixed(1)} s of perfect jumps`;
});

// Every obstacle must be survivable. A column needs a double jump from the
// ground, so it needs enough room after the obstacle before it.
check('played well, no obstacle is unsurvivable', () => {
    for (const seed of [1, 7, 20260921, 424242]) {
        const run = playRunner({ duckShutters: true, seed });
        assert(!run.died,
            `seed ${seed}: perfect play still died on ${run.kind} at ${run.at.toFixed(1)} s`);
    }
    return '4 seeds, a minute each, no death';
});

// A ray above the critical angle at both faces of a layer must still escape.
// Checked on the rule directly, since a bot reaches such angles only by chance.
check('no ray can be trapped inside the high index layer', () => {
    let worst = 0;
    for (let s = 1; s <= 99; s++) {
        const sin1 = s / 100;
        let tirRun = 0, up = true, crossings = 0, escaped = false;
        while (crossings < 60 && !escaped) {
            const r = refractStep(2.35, up ? 1.00 : 1.46, sin1, tirRun);
            crossings++;
            if (r.kind === 'tir') { tirRun++; up = !up; } else escaped = true;
        }
        assert(escaped, `a ray at sin ${sin1.toFixed(2)} never leaves the TiO2 layer`);
        if (crossings > worst) worst = crossings;
    }
    assert(refractStep(2.35, 1.0, 0.9, 0).kind === 'tir',
        'a steep ray into vacuum should reflect, not transmit');
    const straightThrough = refractStep(1.0, 2.35, 0.3, 0);
    assert(straightThrough.kind === 'transmit' && Math.abs(straightThrough.sin2 - 0.3 / 2.35) < 1e-12,
        'Snell is wrong on the transmitting case');
    return `every entry angle escapes within ${worst} crossings`;
});

// Ions closer than a few diameters read as one line.
check('the ions of a burst leave far enough apart to be seen as ions', () => {
    const spacing = burstSpacing(START_IONS);
    assert(spacing >= 3 * ION_R,
        `a burst of ${START_IONS} leaves ${spacing.toFixed(1)} units apart, and an ion is ${2 * ION_R} across`);
    assert(burstSpacing(1) >= spacing, 'a smaller burst should not be tighter than a bigger one');
    return `${spacing.toFixed(0)} units apart, ${(spacing / (2 * ION_R)).toFixed(1)} ion widths`;
});

// A cannon fires for every ion through it and is removed at the end of the
// turn, not when it fires. Checked on a board built by hand.
check('a cannon hits its line for every ion through it, and goes at the turn end', () => {
    const cannon = { col: 4, row: 2, kind: 'rowCannon', alive: true, spent: false, hp: 1 };
    const sameRow = { col: 9, row: 2, kind: 'block', alive: true, spent: false, hp: 5 };
    const otherRow = { col: 9, row: 3, kind: 'block', alive: true, spent: false, hp: 5 };
    const board = {
        level: 3, pending: 0, pops: [], S: { colors: WIN95_COLORS },
        cells: [cannon, sameRow, otherRow],
    };
    indexCells(board);

    fireCannon(board, cannon);
    assert(sameRow.hp === 4, `a block in the line went from 5 to ${sameRow.hp}, not to 4`);
    assert(otherRow.hp === 5, `a block outside the line went to ${otherRow.hp}`);
    assert(cannon.alive, 'the cannon disappeared the moment it fired');

    fireCannon(board, cannon);
    fireCannon(board, cannon);
    assert(sameRow.hp === 2, `three ions through the cannon left the line on ${sameRow.hp}, not 2`);
    assert(cannon.alive, 'the cannon stopped working part way through the burst');

    clearSpent(board);
    assert(!cannon.alive, 'a used cannon is still on the board after the turn');
    assert(sameRow.alive, 'clearing the used cannons took a block with them');
    return 'one hit on the line per ion, gone at the turn boundary';
});

// Only blocks count: a pickup or cannon reaching the gun is removed, and one
// left on the board does not stop the level being cleared.
check('only blocks fill the chamber or hold a level open', () => {
    const cell = (kind, col, row) => ({ col, row, kind, alive: true, spent: false, hp: 5 });
    const plus = cell('plus', 3, ROWS_MAX - 1);
    const cannon = cell('colCannon', 8, ROWS_MAX - 1);
    const block = cell('block', 12, ROWS_MAX - 2);
    const board = { cells: [plus, cannon, block] };
    indexCells(board);
    assert(blocksStanding(board) === 1,
        `one block, a pickup and a cannon were counted as ${blocksStanding(board)} blocks`);

    assert(!lowerStack(board), 'a pickup and a cannon reaching the gun filled the chamber');
    assert(board.cells.length === 1, 'a pickup or a cannon is still on the board below the gun');
    assert(board.cells[0] === block, 'the block was taken off with them');
    assert(lowerStack(board), 'a block reaching the gun did not fill the chamber');
    return 'a pickup and a cannon go off the bottom, a block ends the game';
});

// Every turn must end, since two blocks facing each other can hold an ion, and
// a level must be clearable.
check('every Sputter Storm turn ends and levels are cleared, one after another', () => {
    const FRAME = 1 / 60;
    const ENDINGS = [en.games.sputterStorm.chamberFull, en.games.sputterStorm.levelCleared(1)];
    let reached = 1;
    for (const seed of [1, 7, 22, SEED]) {
        const { game, frame, step } = makeGame('sputterStorm', seed);
        const level = () => game.hud()[0][1];
        const turnNo = () => game.hud()[1][1];
        const ions = () => game.hud()[3][1];
        let best = START_IONS, turn = 0, longest = 0, turns = 0, at = 1;
        let top = 1, ended = false;
        for (let i = 0; i < 40000; i++) {
            step();
            best = Math.max(best, ions());
            top = Math.max(top, level());
            // Recorded as it happens: the bot presses through the end screens
            // and Play again resets the counters.
            if (ENDINGS.some(title => frame.overlays.includes(title))) ended = true;
            if (turnNo() !== at) { at = turnNo(); turns++; longest = Math.max(longest, turn); turn = 0; }
            turn += FRAME;
            // Fire at the lowest block. A bot firing at random spreads its damage
            // and loses even level 1, so it cannot tell a hard level from an
            // unwinnable one. Levels do not depend on the seed, so the seed only
            // moves the aim point across the block.
            if (i % 4 === 0) {
                const lowest = [...frame.blocks].sort((a, b) => b.y - a.y)[0];
                const at = lowest ? [lowest.x + lowest.w * ((seed % 5) + 0.5) / 5, lowest.y + lowest.h / 2] : [0, 0];
                game.onPointer('pointerdown', ...at);
                game.onPointer('pointerup', ...at);
            }
        }
        assert(turns >= 30, `seed ${seed}: only ${turns} turns in 660 s, so a turn is hanging`);
        assert(ended, `seed ${seed}: 660 s of firing and no level was ever finished either way`);
        reached = Math.max(reached, top);
        assert(best > START_IONS, `seed ${seed}: the burst never grew past the ${best} it started with`);
        // Measured between turn changes, so it also includes the drop and the
        // bot's idle frames.
        assert(longest <= TURN_MAX_S + DROP_S + 8 * FRAME,
            `seed ${seed}: a turn ran ${longest.toFixed(2)} s, past the ${TURN_MAX_S} s cap`);
    }
    assert(reached > 1, 'no seed ever cleared a level, so a level may not be finishable');
    return `4 seeds, every turn inside ${TURN_MAX_S} s, up to level ${reached}, every burst grew`;
});

console.log('');
if (fails === 0) { console.log('PASS games'); process.exit(0); }
console.error(`${fails} failure(s).`);
process.exit(1);
