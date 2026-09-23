/**
 * Sputter Storm: fire a burst of ions at a stack of blocks. Each block takes the
 * number of hits written on it.
 *
 * A level is a fixed opening arrangement plus a fixed run of rows, one sent per
 * turn. It is cleared when no block is left, and lost when a block reaches the
 * gun. Block toughness is set by the level, not by the turn.
 *
 * Every level starts with the same burst size, so a pickup adds an ion for the
 * rest of that level only. The next burst fires from where the last ion landed.
 *
 * Ions: sputterStormIons.js. Blocks: sputterStormStack.js. Drawing:
 * sputterStormBoard.js.
 */

import { draw, modalUp, blocksStanding } from './sputterStormBoard.js';
import { addRow, addOpening, indexCells, clearSpent, hpCentre, lowerStack } from './sputterStormStack.js';
import { levelRng, rowsFor } from './sputterStormLevels.js';
import { spawn, moveShot, callBack, startRecall, homeIn } from './sputterStormIons.js';
import { previewPath, aimAt, steerAim } from './sputterStormAim.js';

export const START_IONS = 70;

/**
 * Longest a turn may run before the ions still in the air are brought down.
 *
 * Not a stall detector: an ion rattling through tough blocks is still doing
 * damage. Measured at the current ion speed over 40 runs, half of all turns end
 * inside 5 s and nine in ten inside 11 s; the cap only cuts the few percent that
 * rattle on past that.
 */
export const TURN_MAX_S = 14;

// Time for the stack to slide down one row at the start of a turn.
export const DROP_S = 0.25;

/** Score key for one level's fewest-turns record. */
const levelKey = (level) => `sputter:${level}`;

/** Send the level's next row, if it has any left. */
function sendRow(s) {
    if (s.rowsLeft <= 0) return;
    addRow(s);
    s.rowsLeft--;
}

function startLevel(s, level) {
    s.level = level;
    s.turn = 1;
    s.rowsLeft = rowsFor(level);
    s.balls = START_IONS;
    s.pending = 0;
    s.cells = [];
    s.grid = new Map();
    s.pops = [];
    s.preview = null;
    s.recall = 0;
    // Fewest turns this level has been cleared in, 0 if never.
    s.record = s.fewest(levelKey(level), 0);
    // Blocks tougher than this are drawn in the warning colour.
    s.hard = hpCentre(level);
    // Seeded by the level number, so a replayed level is the same level.
    s.rng = levelRng(level);
    addOpening(s);
    indexCells(s);
    // The first burst of a level fires from the middle.
    s.launchX = s.W / 2;
    s.nextX = null;
    s.drop = 0;
    s.state = 'aim';
}

function reset(s) {
    s.shots = [];
    s.beam = null;
    s.aim = -Math.PI / 2;
    s.keyAim = 0;
    s.toFire = 0;
    s.fireTimer = 0;
    s.turnAge = 0;
    startLevel(s, s.startLevel);
}

function press(s) {
    // A press on a message box only dismisses it.
    if (s.state === 'over') { reset(s); return; }
    if (s.state === 'cleared') { startLevel(s, s.level + 1); return; }
    if (!s.started) { s.started = true; return; }
    if (s.state !== 'aim') return;
    s.state = 'fire';
    s.toFire = s.balls;
    s.fireTimer = 0;
    s.turnAge = 0;
    s.nextX = null;
}

const levelDone = (s) => s.rowsLeft === 0 && blocksStanding(s) === 0;

function clearLevel(s) {
    s.shots = [];
    s.best('sputter', s.level);
    // The level score is turns taken, so the record keeps the lowest.
    s.record = s.fewest(levelKey(s.level), s.turn);
    s.state = 'cleared';
}

function endTurn(s) {
    clearSpent(s);
    s.cells = s.cells.filter(cell => cell.alive);
    s.balls += s.pending;
    s.pending = 0;
    s.launchX = s.nextX === null ? s.launchX : s.nextX;
    s.turn++;
    const full = lowerStack(s);
    sendRow(s);
    indexCells(s);

    if (full) {
        s.state = 'over';
        s.best('sputter', s.level - 1);
        return;
    }
    // No aiming until the stack has finished sliding into place.
    s.drop = 1;
    s.state = 'drop';
}

/** Run down the cannon beam and the block pops, in every state. */
function fade(s, dt) {
    if (s.beam) {
        s.beam.t -= dt;
        if (s.beam.t <= 0) s.beam = null;
    }
    for (const pop of s.pops) pop.t -= dt;
    if (s.pops.length && s.pops[0].t <= 0) s.pops = s.pops.filter(pop => pop.t > 0);
}

function flyBurst(s, dt) {
    s.turnAge += dt;
    spawn(s, dt);
    for (const shot of s.shots) moveShot(s, shot, dt);
    if (s.turnAge > TURN_MAX_S) callBack(s);
    s.shots = s.shots.filter(shot => shot.alive);
    if (levelDone(s)) {
        if (!s.shots.length) { clearLevel(s); return; }
        startRecall(s);
        s.state = 'recall';
        return;
    }
    if (s.toFire === 0 && s.shots.length === 0) endTurn(s);
}

function update(s, dt) {
    fade(s, dt);
    if (s.state === 'recall') { if (homeIn(s, dt)) clearLevel(s); return; }
    if (s.state === 'drop') {
        s.drop = Math.max(0, s.drop - dt / DROP_S);
        if (s.drop === 0) s.state = 'aim';
        return;
    }
    steerAim(s, dt);
    s.preview = s.state === 'aim' ? previewPath(s) : null;
    if (s.state === 'fire') flyBurst(s, dt);
}

// While a message box is up, the only input that gets through is the press
// that dismisses it, and key releases, so a key held when it appeared is not
// left stuck down.
function handleKey(s, code, down) {
    if (down && (code === 'Space' || code === 'Enter')) { press(s); return; }
    if (modalUp(s) && down) return;
    if (code === 'ArrowLeft' || code === 'KeyA') s.keyAim = down ? -1 : 0;
    if (code === 'ArrowRight' || code === 'KeyD') s.keyAim = down ? 1 : 0;
}

// A box is dismissed on press, and a release fires only if its press began
// with no box up. Otherwise the release of the dismissing press would fire, and
// a press held from before a box appeared would dismiss it unseen.
function handlePointer(s, type, x, y) {
    if (type === 'pointerdown') s.armed = !modalUp(s);
    if (modalUp(s)) { if (type === 'pointerdown') press(s); return; }
    if (type !== 'pointerup') { aimAt(s, x, y); return; }
    if (s.armed) press(s);
    s.armed = false;
}

export function createSputterStorm(api) {
    const s = {
        W: api.W, H: api.H, S: api.skin, t: api.t, g: api.t.sputterStorm,
        best: api.best, fewest: api.fewest,
        // The level picked in the window. Losing sends the game back here.
        startLevel: Math.max(1, api.level || 1),
    };
    // Set once: Play again skips the opening message box.
    s.started = false;
    reset(s);

    return {
        update: (dt) => update(s, dt),
        draw: (ctx) => draw(s, ctx),
        level: () => s.level,
        hud: () => [
            [s.g.hudLevel, s.level],
            [s.g.hudTurn, s.turn],
            [s.g.hudRows, s.rowsLeft],
            [s.g.hudIons, s.balls],
            [s.g.hudBlocks, blocksStanding(s)],
            [s.t.hudBest, s.best('sputter', 0)],
        ],
        onKey: (code, down) => handleKey(s, code, down),
        onPointer: (type, x, y) => handlePointer(s, type, x, y),
    };
}
