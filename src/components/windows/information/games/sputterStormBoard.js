/**
 * Sputter Storm grid geometry and drawing.
 *
 * Cells are square. The field runs from under the header down to the gun line,
 * which gives 15 rows of 30 columns.
 */

export const COLS = 30;

// Rows on screen. A block reaching this row has reached the gun and ends the game.
export const ROWS_MAX = 15;

const FIELD_L = 24;
const FIELD_R = 696;
const TOP = 34;
const CELL = (FIELD_R - FIELD_L) / COLS;
const BLOCK = CELL - 3;
const INSET = (CELL - BLOCK) / 2;

export const FLOOR = 392;
export const ION_R = 3.5;

const HEAD_Y = 22;
const GUTTER_X = 12;

// Lifetime in seconds of the ring left by a removed block, and how far it grows.
export const POP_S = 0.22;
const POP_GROW = 9;

export function blockRect(cell) {
    return {
        x: FIELD_L + cell.col * CELL + INSET,
        y: TOP + cell.row * CELL,
        w: BLOCK,
        h: BLOCK,
    };
}

export function cellCentre(cell) {
    return {
        x: FIELD_L + cell.col * CELL + CELL / 2,
        y: TOP + cell.row * CELL + BLOCK / 2,
    };
}

/** Column and row under a point. Off the grid gives an index with no cell. */
export const colAt = (x) => Math.floor((x - FIELD_L) / CELL);
export const rowAt = (y) => Math.floor((y - TOP) / CELL);

/** Blocks still standing. Pickups and cannons do not count towards clearing a level. */
export function blocksStanding(s) {
    let n = 0;
    for (const cell of s.grid.values()) if (cell.kind === 'block') n++;
    return n;
}

/** Whether a point touching `rect` bounces off a side ('x') or off the top or bottom ('y'). */
export function bounceAxis(x, y, rect) {
    const pastX = rect.w / 2 + ION_R - Math.abs(x - (rect.x + rect.w / 2));
    const pastY = rect.h / 2 + ION_R - Math.abs(y - (rect.y + rect.h / 2));
    return pastX < pastY ? 'x' : 'y';
}

function drawPickup(s, ctx, rect) {
    const c = s.S.colors;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    s.S.dot(ctx, cx, cy, rect.w / 2, c.good);
    s.S.text(ctx, s.g.plusOne, cx, cy + 3, { color: s.S.on(c.good), size: 9, align: 'center', bold: true });
}

/** One arrowhead with its point at `tip`, facing along `dx, dy`. */
function arrowHead(s, ctx, tip, color) {
    const { x, y, dx, dy } = tip;
    const back = 3;
    const side = 3;
    s.S.line(ctx, [
        [x - dx * back - dy * side, y - dy * back - dx * side],
        [x, y],
        [x - dx * back + dy * side, y - dy * back + dx * side],
    ], color, 2);
}

/** A cannon: a disc with a double arrow along its firing line, grey once used this turn. */
function drawCannon(s, ctx, cell, rect) {
    const c = s.S.colors;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const color = cell.spent ? c.dim : c.danger;
    const reach = rect.w / 2 - 2;
    const across = cell.kind === 'rowCannon';
    const dx = across ? 1 : 0;
    const dy = across ? 0 : 1;

    const mark = s.S.on(color);
    s.S.dot(ctx, cx, cy, rect.w / 2, color);
    s.S.line(ctx, [[cx - dx * reach, cy - dy * reach], [cx + dx * reach, cy + dy * reach]], mark, 2);
    arrowHead(s, ctx, { x: cx + dx * reach, y: cy + dy * reach, dx, dy }, mark);
    arrowHead(s, ctx, { x: cx - dx * reach, y: cy - dy * reach, dx: -dx, dy: -dy }, mark);
}

function drawCell(s, ctx, cell) {
    const c = s.S.colors;
    const rect = blockRect(cell);
    if (cell.kind === 'plus') { drawPickup(s, ctx, rect); return; }
    if (cell.kind !== 'block') { drawCannon(s, ctx, cell, rect); return; }
    // Blocks above the level's typical hp are drawn in a different colour.
    const fill = cell.hp > s.hard ? c.h : c.l;
    s.S.block(ctx, rect, fill);
    s.S.text(ctx, String(cell.hp), rect.x + rect.w / 2, rect.y + rect.h / 2 + 3,
        { color: s.S.on(fill), size: 9, align: 'center', bold: true });
}

/**
 * The stack, shifted up by the part of the drop still to run, so a new turn
 * animates the rows sliding down. Clipped to the field so the incoming row
 * appears from under the top edge.
 */
function drawCells(s, ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TOP - 2, s.W, FLOOR - TOP + 2);
    ctx.clip();
    ctx.translate(0, -s.drop * CELL);
    for (const cell of s.cells) {
        if (cell.alive) drawCell(s, ctx, cell);
    }
    ctx.restore();
}

/** Expanding rings where blocks and pickups were just removed. */
function drawPops(s, ctx) {
    for (const pop of s.pops) {
        const out = 1 - pop.t / POP_S;
        s.S.ring(ctx, pop.x, pop.y, BLOCK / 2 + out * POP_GROW, pop.color);
    }
}

/** A cannon shot, growing outwards from the cannon along its line. */
function drawBeam(s, ctx) {
    const { across, from, t, life } = s.beam;
    const reach = (1 - t / life) * (across ? s.W : FLOOR);
    const { x, y } = cellCentre(from);
    s.S.line(ctx, across
        ? [[x - reach, y], [x + reach, y]]
        : [[x, y - reach], [x, y + reach]], s.S.colors.danger, 3);
}

/** The dashed aim line. The path is computed in the rules; this only draws it. */
function drawAim(s, ctx) {
    const c = s.S.colors;
    if (!s.preview) return;
    s.S.line(ctx, s.preview.map(p => [p.x, p.y]), c.dim, 1, { dash: true });
    if (s.preview.length > 2) s.S.dot(ctx, s.preview[1].x, s.preview[1].y, 3, c.dim);
}

/** The gun, with the count of ions left to fire above it. */
function drawGun(s, ctx) {
    const c = s.S.colors;
    const left = s.state === 'fire' ? s.toFire : s.balls;
    s.S.line(ctx, [[0, FLOOR], [s.W, FLOOR]], c.dim, 1);
    s.S.line(ctx, [[s.launchX - 9, FLOOR + 7], [s.launchX, FLOOR], [s.launchX + 9, FLOOR + 7]],
        c.photon, 2);
    s.S.dot(ctx, s.launchX, FLOOR - ION_R, ION_R, c.photon);
    s.S.text(ctx, s.g.ionCount(left), s.launchX, FLOOR - 14,
        { color: c.dim, size: 11, align: 'center', bold: true });
    if (s.state === 'aim') drawAim(s, ctx);
}

function drawHeader(s, ctx) {
    const c = s.S.colors;
    const opts = { color: c.dim, size: 11 };
    const label = s.g.levelNo(s.level);
    s.S.text(ctx, label, GUTTER_X, HEAD_Y, opts);
    // The level's fewest-turns record, once it has been cleared.
    if (s.record > 0) {
        s.S.text(ctx, s.g.bestTurns(s.record), GUTTER_X + s.S.width(ctx, label, opts) + 16,
            HEAD_Y, opts);
    }
    s.S.text(ctx, s.g.blocksLeft(blocksStanding(s)), s.W - GUTTER_X, HEAD_Y, { ...opts, align: 'right' });
}

/** Whether a message box is up. While it is, the game takes no input except the press that dismisses it. */
export const modalUp = (s) => s.state === 'over' || s.state === 'cleared' || !s.started;

function drawOverlay(s, ctx) {
    if (!modalUp(s)) return;
    if (s.state === 'over') {
        s.S.overlay(ctx, s.g.chamberFull, [
            s.g.levelsCleared(s.level - s.startLevel),
            s.g.bestLevels(s.best('sputter', 0)),
        ], 'bad', s.t.playAgain);
    } else if (s.state === 'cleared') {
        s.S.overlay(ctx, s.g.levelCleared(s.level),
            [s.g.clearedIn(s.turn), s.g.bestTurns(s.record)], 'good', s.g.nextLevel);
    } else if (!s.started) {
        s.S.overlay(ctx, s.g.name, [s.g.howTo, '', s.g.controls], 'info', s.t.start);
    }
}

export function draw(s, ctx) {
    s.S.clear(ctx);
    drawHeader(s, ctx);
    if (s.beam) drawBeam(s, ctx);
    drawCells(s, ctx);
    drawPops(s, ctx);
    for (const shot of s.shots) s.S.dot(ctx, shot.x, shot.y, ION_R, s.S.colors.photon);
    drawGun(s, ctx);
    drawOverlay(s, ctx);
}
