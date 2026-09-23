/**
 * Ion flight: spawning a burst, bouncing off walls and blocks, landing, and
 * bringing a burst down or home early.
 */

import { FLOOR, ION_R, COLS, blockRect, colAt, rowAt, bounceAxis } from './sputterStormBoard.js';
import { keyOf, isCannon, hit, collect, fireCannon } from './sputterStormStack.js';

const ION_SPEED = 900;

// Longest wait between two ions of a burst, and longest time a whole burst may
// take to leave, in seconds. Together with the speed they set how far apart the
// ions fly; closer than about a diameter and a burst reads as one line.
const ION_GAP = 0.06;
const BURST_S = 3.0;

const burstGap = (balls) => Math.min(ION_GAP, BURST_S / balls);

/** Distance between two ions of a burst of `balls`, in stage units. */
export const burstSpacing = (balls) => burstGap(balls) * ION_SPEED;

// Longest single move, in stage units, so an ion cannot skip through a block
// between two frames.
const SUB_STEP = 5;

// Time for the ions still in the air to fly home once the board is clear.
const RECALL_S = 0.5;

/** Release the next ion of the burst, if one is due this frame. */
export function spawn(s, dt) {
    if (s.toFire <= 0) return;
    s.fireTimer -= dt;
    if (s.fireTimer > 0) return;
    s.fireTimer = burstGap(s.balls);
    s.toFire--;
    s.shots.push({
        x: s.launchX, y: FLOOR - ION_R, alive: true,
        vx: Math.cos(s.aim) * ION_SPEED,
        vy: Math.sin(s.aim) * ION_SPEED,
    });
}

// Every landing moves the next launch point, so the last ion down sets it.
function land(s, shot) {
    shot.alive = false;
    s.nextX = Math.max(20, Math.min(s.W - 20, shot.x));
}

function bounceWalls(s, shot) {
    if (shot.x < ION_R) { shot.x = ION_R; shot.vx = -shot.vx; }
    if (shot.x > s.W - ION_R) { shot.x = s.W - ION_R; shot.vx = -shot.vx; }
    if (shot.y < ION_R) { shot.y = ION_R; shot.vy = -shot.vy; }
}

/** Bounce off the face of the block the ion has gone least far past. */
function reflect(shot, rect) {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    if (bounceAxis(shot.x, shot.y, rect) === 'x') {
        shot.vx = -shot.vx;
        shot.x = cx + Math.sign(shot.x - cx || 1) * (rect.w / 2 + ION_R);
    } else {
        shot.vy = -shot.vy;
        shot.y = cy + Math.sign(shot.y - cy || 1) * (rect.h / 2 + ION_R);
    }
}

function touches(shot, rect) {
    return shot.x >= rect.x - ION_R && shot.x <= rect.x + rect.w + ION_R
        && shot.y >= rect.y - ION_R && shot.y <= rect.y + rect.h + ION_R;
}

/**
 * Cells the ion is touching. The ion is smaller than a cell, so only the 3x3
 * neighbourhood around it needs checking.
 */
function touchedCells(s, shot) {
    const col = colAt(shot.x);
    const row = rowAt(shot.y);
    const found = [];
    for (let r = row - 1; r <= row + 1; r++) {
        for (let c = Math.max(0, col - 1); c <= Math.min(COLS - 1, col + 1); c++) {
            const cell = s.grid.get(keyOf(r, c));
            if (cell && touches(shot, blockRect(cell))) found.push(cell);
        }
    }
    return found;
}

/** Pickups and cannons are flown through; only a block bounces the ion. */
function hitCells(s, shot) {
    for (const cell of touchedCells(s, shot)) {
        if (cell.kind === 'plus') { collect(s, cell); continue; }
        if (isCannon(cell)) { trigger(s, shot, cell); continue; }
        reflect(shot, blockRect(cell));
        hit(s, cell);
        return;
    }
}

/**
 * Fire a cannon once per ion. An ion stays inside a cannon for several sub-steps,
 * which without this would fire it on each of them.
 */
function trigger(s, shot, cell) {
    if (!shot.fired) shot.fired = new Set();
    if (shot.fired.has(cell)) return;
    shot.fired.add(cell);
    fireCannon(s, cell);
}

export function moveShot(s, shot, dt) {
    const speed = Math.hypot(shot.vx, shot.vy);
    const steps = Math.max(1, Math.ceil(speed * dt / SUB_STEP));
    const step = dt / steps;
    for (let i = 0; i < steps && shot.alive; i++) {
        shot.x += shot.vx * step;
        shot.y += shot.vy * step;
        bounceWalls(s, shot);
        hitCells(s, shot);
        if (shot.y > FLOOR) land(s, shot);
    }
}

/** Stop firing and land every ion still in the air where it is. */
export function callBack(s) {
    s.toFire = 0;
    for (const shot of s.shots) land(s, shot);
}

/** Start flying the ions still in the air back into the gun. */
export function startRecall(s) {
    s.recall = 0;
    s.toFire = 0;
    for (const shot of s.shots) shot.from = { x: shot.x, y: shot.y };
}

/** Advance the recall. True once every ion is home. */
export function homeIn(s, dt) {
    s.recall = Math.min(1, s.recall + dt / RECALL_S);
    // Ease out: fast at first, slowing into the gun.
    const gone = 1 - (1 - s.recall) * (1 - s.recall);
    for (const shot of s.shots) {
        shot.x = shot.from.x + (s.launchX - shot.from.x) * gone;
        shot.y = shot.from.y + (FLOOR - ION_R - shot.from.y) * gone;
    }
    return s.recall >= 1;
}
