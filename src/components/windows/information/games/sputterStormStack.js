/**
 * The block stack: building rows, taking hits, and cannons.
 *
 * A cell is a block, a pickup or a cannon. A block bounces ions and loses one hp
 * per hit. Ions fly through pickups and cannons. A pickup adds one ion to the
 * next burst. A cannon takes one hp off every block in its row or column each
 * time an ion passes through it, and is removed at the end of the turn it fired
 * in. An unused cannon moves down with the stack.
 *
 * Cells are also indexed by row and column, so an ion only checks the cells
 * around it.
 */

import { rngInt } from './rng.js';
import { COLS, ROWS_MAX, POP_S, cellCentre } from './sputterStormBoard.js';
import { layoutFor, readLine } from './sputterStormLevels.js';

// Cells in a new row, out of 30. Mostly full, so rows arrive as walls.
const ROW_MIN = 18;
const ROW_MAX = 27;

const BEAM_S = 0.16;

// Cap on block-removal marks kept at once. A burst can remove many blocks in
// one frame; the oldest marks are dropped first.
const MAX_POPS = 120;

export const keyOf = (row, col) => row * COLS + col;

export const isCannon = (cell) => cell.kind === 'rowCannon' || cell.kind === 'colCannon';

/** Rebuild the grid index. Call after anything that moves or adds cells. */
export function indexCells(s) {
    s.grid = new Map();
    for (const cell of s.cells) {
        if (cell.alive) s.grid.set(keyOf(cell.row, cell.col), cell);
    }
}

/**
 * Move the stack down one row. A pickup or cannon reaching the gun row is
 * removed; only a block there ends the game.
 * @returns {boolean} whether a block has reached the gun row
 */
export function lowerStack(s) {
    for (const cell of s.cells) cell.row++;
    s.cells = s.cells.filter(cell => cell.kind === 'block' || cell.row < ROWS_MAX);
    return s.cells.some(cell => cell.row >= ROWS_MAX);
}

// Block hp depends on the level only, not on the turn.
const HP_BASE = 24;
const HP_PER_LEVEL = 9;
const HP_SPREAD = 0.35;

/** Typical block hp for a level, before the per-row spread. */
export const hpCentre = (level) => HP_BASE + (level - 1) * HP_PER_LEVEL;

/** Lowest and highest block hp a level can produce. */
export const hpRange = (level) => [
    Math.max(1, Math.round(hpCentre(level) * (1 - HP_SPREAD))),
    Math.max(1, Math.round(hpCentre(level) * (1 + HP_SPREAD))),
];

/** Hp for every block in one row. All blocks in a row share it. */
function rowHp(s) {
    const spread = 1 - HP_SPREAD + s.rng() * 2 * HP_SPREAD;
    return Math.max(1, Math.round(hpCentre(s.level) * spread));
}

const newCell = (col, row, kind, hp) =>
    ({ col, row, kind, alive: true, spent: false, hp: kind === 'block' ? hp : 1 });

/** Kinds of the cells in the next row. */
function rowKinds(s, count) {
    const kinds = [];
    for (let i = 0; i < count; i++) {
        const roll = s.rng();
        if (roll < 0.055) kinds.push('rowCannon');
        else if (roll < 0.10) kinds.push('colCannon');
        else kinds.push('block');
    }
    // At most one pickup per row, in 60% of rows.
    if (s.rng() < 0.6) kinds[rngInt(s.rng, 0, count - 1)] = 'plus';
    return kinds;
}

export function addRow(s) {
    const free = [];
    for (let col = 0; col < COLS; col++) free.push(col);
    const kinds = rowKinds(s, rngInt(s.rng, ROW_MIN, ROW_MAX));
    const hp = rowHp(s);
    for (const kind of kinds) {
        const col = free.splice(rngInt(s.rng, 0, free.length - 1), 1)[0];
        s.cells.push(newCell(col, 0, kind, hp));
    }
}

/** Lay out the level's opening arrangement from the top row down. */
export function addOpening(s) {
    const layout = layoutFor(s.level);
    for (let row = 0; row < layout.length; row++) {
        const hp = rowHp(s);
        for (const { col, kind } of readLine(layout[row])) s.cells.push(newCell(col, row, kind, hp));
    }
}

function remove(s, cell, color) {
    cell.alive = false;
    s.grid.delete(keyOf(cell.row, cell.col));
    if (!color) return;
    const { x, y } = cellCentre(cell);
    s.pops.push({ x, y, t: POP_S, color });
    if (s.pops.length > MAX_POPS) s.pops.shift();
}

/** Take one hp off a block, removing it at zero. */
export function hit(s, cell) {
    cell.hp--;
    if (cell.hp <= 0) remove(s, cell, s.S.colors.l);
}

/** An ion has passed through a pickup. */
export function collect(s, cell) {
    remove(s, cell, s.S.colors.good);
    s.pending++;
}

/**
 * Fire a cannon: one hit on every block in its row or column. It stays on the
 * board and fires again for the next ion; `spent` removes it at the turn end.
 * Blocks it hits do not fire anything in turn.
 */
export function fireCannon(s, cell) {
    const across = cell.kind === 'rowCannon';
    cell.spent = true;
    s.beam = { across, from: { col: cell.col, row: cell.row }, t: BEAM_S, life: BEAM_S };
    for (const other of s.cells) {
        if (!other.alive || other.kind !== 'block') continue;
        if (across ? other.row !== cell.row : other.col !== cell.col) continue;
        hit(s, other);
    }
}

/** Remove the cannons that fired this turn. Called once, at the turn end. */
export function clearSpent(s) {
    for (const cell of s.cells) {
        if (cell.alive && cell.spent) remove(s, cell, s.S.colors.danger);
    }
}
