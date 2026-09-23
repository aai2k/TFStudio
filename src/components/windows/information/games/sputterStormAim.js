/**
 * Aiming the gun, and the aim line: traced through the same board and bounce
 * rules the ions use, up to the first bounce and one segment after it. Later
 * bounces are not shown because the burst changes the board as it goes.
 */

import { COLS, FLOOR, ION_R, blockRect, colAt, rowAt, bounceAxis } from './sputterStormBoard.js';
import { keyOf } from './sputterStormStack.js';

// Flattest allowed shot, in radians above the horizontal. A shot this flat can
// run along under a row; the turn cap stops it from taking forever.
const AIM_LIMIT = 0.10;
// Arrow-key turn rate, in radians per second.
const AIM_KEY_RATE = 1.5;

const clampAim = a => Math.max(-Math.PI + AIM_LIMIT, Math.min(-AIM_LIMIT, a));

/** Aim from the gun at a point, clamped above the horizontal. */
export function aimAt(s, x, y) {
    if (s.state !== 'aim') return;
    s.aim = clampAim(Math.atan2(Math.min(y - FLOOR, -1), x - s.launchX));
}

/** Turn the aim while an arrow key is held. */
export function steerAim(s, dt) {
    if (s.state === 'aim' && s.keyAim) s.aim = clampAim(s.aim + s.keyAim * AIM_KEY_RATE * dt);
}

// Trace step, in stage units. Coarser than an ion's step; the error is not
// visible on a dashed line.
const STEP = 4;
const MAX = 900;
const AFTER = 260;

const inside = (x, y, rect) =>
    x >= rect.x - ION_R && x <= rect.x + rect.w + ION_R
    && y >= rect.y - ION_R && y <= rect.y + rect.h + ION_R;

/** The block at a point. Pickups and cannons are ignored. */
function blockAt(s, x, y) {
    const col = colAt(x);
    const row = rowAt(y);
    for (let r = row - 1; r <= row + 1; r++) {
        for (let c = Math.max(0, col - 1); c <= Math.min(COLS - 1, col + 1); c++) {
            const cell = s.grid.get(keyOf(r, c));
            if (cell && cell.kind === 'block' && inside(x, y, blockRect(cell))) return cell;
        }
    }
    return null;
}

/** Step along `dir` until a wall or block is hit. Null if nothing is within MAX. */
function march(s, from, dir) {
    let x = from.x;
    let y = from.y;
    for (let gone = 0; gone < MAX; gone += STEP) {
        x += dir.x * STEP;
        y += dir.y * STEP;
        if (x <= ION_R) return { x: ION_R, y, axis: 'x' };
        if (x >= s.W - ION_R) return { x: s.W - ION_R, y, axis: 'x' };
        if (y <= ION_R) return { x, y: ION_R, axis: 'y' };
        const cell = blockAt(s, x, y);
        if (cell) return { x, y, axis: bounceAxis(x, y, blockRect(cell)) };
    }
    return null;
}

/** Points of the aim line: gun, first bounce, and the end of the reflected segment. */
export function previewPath(s) {
    const dir = { x: Math.cos(s.aim), y: Math.sin(s.aim) };
    const from = { x: s.launchX, y: FLOOR - ION_R };
    const hit = march(s, from, dir);
    if (!hit) return [from, { x: from.x + dir.x * MAX, y: from.y + dir.y * MAX }];
    const back = hit.axis === 'x' ? { x: -dir.x, y: dir.y } : { x: dir.x, y: -dir.y };
    return [
        from,
        { x: hit.x, y: hit.y },
        { x: hit.x + back.x * AFTER, y: hit.y + back.y * AFTER },
    ];
}
