/**
 * Refracting Breakout: the ball refracts by Snell's law at every interface, and
 * a steep exit from the high-index layer is turned back by total internal
 * reflection.
 *
 * The ball keeps its speed across an interface to stay playable. A real ray
 * slows to c/n in the denser medium: the angles are right, the speed is not.
 * Board and drawing: refractingBreakoutBoard.js.
 */

import { makeRng } from './rng.js';
import { refractStep } from './snell.js';
import {
    BOUNDS, MEDIA, PADDLE_Y, PADDLE_W, BALL_R,
    bandOf, buildBricks, draw, bounceWalls, movePaddle, collidePaddle, modalUp,
} from './refractingBreakoutBoard.js';

const BASE_SPEED = 330;
const SPEED_PER_LEVEL = 0.08;
const MAX_SPEED_FACTOR = 1.6;
// More lives than classic Breakout, because a level holds up to 190 bricks.
const LIVES = 5;
const TRAIL_POINTS = 34;

const speedFor = (level) =>
    BASE_SPEED * Math.min(1 + (level - 1) * SPEED_PER_LEVEL, MAX_SPEED_FACTOR);

function placeBall(s) {
    s.ball = {
        x: s.paddle.x, y: PADDLE_Y - 12, r: BALL_R,
        vx: (s.rng() < 0.5 ? -1 : 1) * s.speed * 0.42,
        vy: -s.speed * 0.91,
        band: bandOf(PADDLE_Y - 12),
        trail: [],
    };
}

function startLevel(s, level) {
    s.level = level;
    s.speed = speedFor(level);
    s.cleared = 0;
    s.tirRun = 0;
    buildBricks(s);
    placeBall(s);
    s.state = 'ready';
}

function reset(s) {
    s.lives = LIVES;
    s.tirFlash = 0;
    s.ftirFlash = 0;
    s.keyDir = 0;
    s.paddle = { x: s.W / 2, w: PADDLE_W };
    startLevel(s, s.startLevel);
}

function launch(s) {
    if (s.state === 'play') return;
    if (s.state === 'dead') reset(s);
    else if (s.state === 'cleared') startLevel(s, s.level + 1);
    s.started = true;
    s.state = 'play';
}

/** Snell at a horizontal interface: the normal is the y axis. */
function crossBoundary(s, from, to, boundaryY) {
    const b = s.ball;
    const step = refractStep(MEDIA[from].n, MEDIA[to].n, Math.abs(b.vx) / s.speed, s.tirRun);

    if (step.kind === 'tir') {
        s.tirRun++;
        b.vy = -b.vy;
        b.y = b.vy > 0 ? boundaryY + b.r : boundaryY - b.r;
        s.tirFlash = 0.7;
        return;
    }
    if (step.kind === 'ftir') s.ftirFlash = 1.1;
    s.tirRun = 0;
    b.vx = Math.sign(b.vx) * s.speed * step.sin2;
    b.vy = Math.sign(b.vy) * s.speed * Math.sqrt(1 - step.sin2 * step.sin2);
    b.band = to;
}

function hitBrick(s, brick) {
    brick.alive = false;
    s.cleared++;
    s.tirRun = 0;
    s.ball.vy = -s.ball.vy;
    // A small kick, so the angle inside a layer can drift into TIR.
    const a = Math.atan2(s.ball.vy, s.ball.vx) + (s.rng() - 0.5) * 0.28;
    s.ball.vx = Math.cos(a) * s.speed;
    s.ball.vy = Math.sin(a) * s.speed;
    if (s.cleared >= s.bricks.length) {
        s.state = 'cleared';
        s.best('breakout', s.level);
    }
}

function collideBricks(s) {
    const b = s.ball;
    for (const brick of s.bricks) {
        if (!brick.alive) continue;
        if (b.x > brick.x - b.r && b.x < brick.x + brick.w + b.r &&
            b.y > brick.y - b.r && b.y < brick.y + brick.h + b.r) {
            hitBrick(s, brick);
            return;
        }
    }
}

function stepBall(s, dt) {
    const b = s.ball;
    const prevBand = b.band;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    bounceWalls(s);

    const nowBand = bandOf(b.y);
    if (nowBand !== prevBand) {
        crossBoundary(s, prevBand, nowBand, nowBand > prevBand ? BOUNDS[prevBand] : BOUNDS[nowBand]);
    }
}

function loseLife(s) {
    s.lives--;
    if (s.lives <= 0) { s.state = 'dead'; s.best('breakout', s.level - 1); }
    else { placeBall(s); s.state = 'ready'; }
}

function pushTrail(s) {
    s.ball.trail.push({ x: s.ball.x, y: s.ball.y });
    if (s.ball.trail.length > TRAIL_POINTS) s.ball.trail.shift();
}

function update(s, dt) {
    if (s.tirFlash > 0) s.tirFlash -= dt;
    if (s.ftirFlash > 0) s.ftirFlash -= dt;
    // Not behind a message box, or an arrow key held when it appeared keeps
    // moving the paddle.
    if (!modalUp(s)) movePaddle(s, dt);

    if (s.state !== 'play') {
        if (s.state === 'ready') { s.ball.x = s.paddle.x; s.ball.y = PADDLE_Y - 12; }
        return;
    }

    stepBall(s, dt);
    collideBricks(s);
    collidePaddle(s, s.speed);
    if (s.ball.y > s.H + 20) loseLife(s);
    pushTrail(s);
}

// While a message box is up, the only input that gets through is the press
// that dismisses it, and key releases, so a key held when it appeared is not
// left stuck down.
function handleKey(s, code, down) {
    if (down && (code === 'Space' || code === 'Enter')) { launch(s); return; }
    if (modalUp(s) && down) return;
    if (code === 'ArrowLeft' || code === 'KeyA') s.keyDir = down ? -1 : 0;
    if (code === 'ArrowRight' || code === 'KeyD') s.keyDir = down ? 1 : 0;
}

function handlePointer(s, type, x) {
    if (modalUp(s)) { if (type === 'pointerdown') launch(s); return; }
    if (type === 'pointermove') { s.paddle.x = x; return; }
    if (type !== 'pointerdown') return;
    s.paddle.x = x;
    launch(s);
}

export function createRefractingBreakout(api) {
    const s = {
        W: api.W, H: api.H, S: api.skin, t: api.t, g: api.t.refractingBreakout, best: api.best,
        rng: makeRng(api.seed),
        // The level picked in the window. Losing sends the game back here.
        startLevel: Math.max(1, api.level || 1),
    };
    // Set once: after the first serve the opening box does not come back.
    s.started = false;
    reset(s);

    return {
        update: (dt) => update(s, dt),
        draw: (ctx) => draw(s, ctx),
        level: () => s.level,
        hud: () => [
            [s.g.hudLevel, s.level],
            [s.g.hudBricks, s.bricks.length - s.cleared],
            [s.g.hudLives, s.lives],
            [s.t.hudBest, s.best('breakout', 0)],
        ],
        onKey: (code, down) => handleKey(s, code, down),
        onPointer: (type, x) => handlePointer(s, type, x),
    };
}
