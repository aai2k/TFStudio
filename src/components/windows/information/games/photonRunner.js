/**
 * Photon Runner: jump dust, double-jump columns and duck under shutters. The
 * distance covered is shown as path length in nm. Geometry and drawing:
 * photonRunnerBoard.js.
 */

import { makeRng } from './rng.js';
import {
    GROUND, PX, SHUTTER_BOTTOM, STAND, COLUMN_MIN_H, COLUMN_MAX_H,
    box, draw, trailLength,
} from './photonRunnerBoard.js';

const GRAVITY = 2400;
// The second jump is weaker, so it gains the most height when taken at the top
// of the first.
const JUMP_V = -780;
const JUMP_V2 = -640;
const JUMPS_PER_TAKEOFF = 2;
const BASE_SPEED = 340;
const MAX_SPEED = 720;

function reset(s) {
    s.state = 'ready';
    s.y = GROUND - STAND.h / 2;
    s.vy = 0;
    s.jumps = 0;
    s.ducking = false;
    s.speed = BASE_SPEED;
    s.dist = 0;
    s.obstacles = [];
    s.nextKind = 'dust';
    s.nextGap = 420;
    s.trail = [];
    s.night = false;
    s.shakeT = 0;
}

function jump(s) {
    if (s.state !== 'play') {
        if (s.state === 'dead') reset(s);
        s.state = 'play';
        return;
    }
    if (s.jumps >= JUMPS_PER_TAKEOFF) return;
    s.vy = s.jumps === 0 ? JUMP_V : JUMP_V2;
    s.jumps++;
    s.ducking = false;
}

function hits(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Choose the next obstacle and the gap before it. The gap is a time, not a
 * distance, so the rhythm holds as the run speeds up. A column gets a longer
 * gap, because its double jump has to start from the ground well before it.
 */
function schedule(s) {
    const roll = s.rng();
    s.nextKind = roll < 0.45 ? 'dust' : roll < 0.65 ? 'column' : 'shutter';
    const room = s.nextKind === 'column' ? 1.10 : 0.78;
    s.nextGap = (room + s.rng() * 0.55) * s.speed;
}

function spawn(s) {
    if (s.nextKind === 'dust') {
        const h = 22 + s.rng() * 26;
        s.obstacles.push({ kind: 'dust', x: s.W + 20, y: GROUND - h, w: 13 + s.rng() * 14, h });
    } else if (s.nextKind === 'column') {
        const h = COLUMN_MIN_H + s.rng() * (COLUMN_MAX_H - COLUMN_MIN_H);
        s.obstacles.push({ kind: 'column', x: s.W + 20, y: GROUND - h, w: 18 + s.rng() * 8, h });
    } else {
        // The collision box starts at the top of the stage, like the drawn bar,
        // so a shutter cannot be jumped over.
        s.obstacles.push({ kind: 'shutter', x: s.W + 20, y: 0, w: 16, h: SHUTTER_BOTTOM });
    }
    schedule(s);
}

function stepObstacles(s, dt, me) {
    s.nextGap -= s.speed * dt;
    if (s.nextGap <= 0) spawn(s);

    for (let i = s.obstacles.length - 1; i >= 0; i--) {
        s.obstacles[i].x -= s.speed * dt;
        if (hits(me, s.obstacles[i])) {
            s.state = 'dead';
            s.shakeT = 0.3;
            s.best('photonRunner', Math.floor(s.dist));
        }
        if (s.obstacles[i].x < -60) s.obstacles.splice(i, 1);
    }
}

// Ducking in the air makes the photon fall about twice as fast, to get down
// from a mistimed jump.
function fall(s, dt) {
    s.vy += GRAVITY * (s.ducking && s.vy > 0 ? 2.1 : 1) * dt;
    s.y += s.vy * dt;
    if (s.y > GROUND - STAND.h / 2) {
        s.y = GROUND - STAND.h / 2;
        s.vy = 0;
        s.jumps = 0;
    }
}

function pushTrail(s, dt, me) {
    s.trail.push({ x: PX, y: me.y + me.h / 2 });
    while (s.trail.length > trailLength(s.dist)) s.trail.shift();
    for (const p of s.trail) p.x -= s.speed * dt;
}

function update(s, dt) {
    if (s.shakeT > 0) s.shakeT -= dt;
    if (s.state !== 'play') return;

    s.speed = Math.min(BASE_SPEED + s.dist * 0.035, MAX_SPEED);
    s.dist += s.speed * dt * 0.5;
    s.night = Math.floor(s.dist / 1400) % 2 === 1;

    fall(s, dt);
    const me = box(s);
    pushTrail(s, dt, me);
    stepObstacles(s, dt, me);
}

export function createPhotonRunner(api) {
    const s = {
        W: api.W, H: api.H, S: api.skin, t: api.t, g: api.t.photonRunner, best: api.best,
        rng: makeRng(api.seed),
    };
    reset(s);

    return {
        update: (dt) => update(s, dt),
        draw: (ctx) => draw(s, ctx),
        hud: () => [
            [s.g.hudPath, Math.floor(s.dist) + ' nm'],
            [s.g.hudSpeed, Math.round(s.speed)],
            [s.t.hudBest, s.best('photonRunner', 0) + ' nm'],
        ],
        // While a message box is up, the only input that gets through is the
        // press that dismisses it, and key releases.
        onKey: (code, down) => {
            if (down && (code === 'Space' || code === 'ArrowUp' || code === 'KeyW')) { jump(s); return; }
            if (s.state !== 'play' && down) return;
            if (code === 'ArrowDown' || code === 'KeyS') s.ducking = down;
        },
        onPointer: (type, x, y) => {
            if (s.state !== 'play') { if (type === 'pointerdown') jump(s); return; }
            if (type === 'pointerdown') {
                if (y > s.H * 0.62) s.ducking = true;
                else jump(s);
            } else if (type === 'pointerup') {
                s.ducking = false;
            }
        },
    };
}
