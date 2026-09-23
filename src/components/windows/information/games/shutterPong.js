/**
 * Shutter Pong: first to five against the machine. The machine paddle lags the
 * ball and returns to centre while the ball moves away, so wide angles beat it.
 */

import { makeRng } from './rng.js';

const PAD_W = 12, PAD_H = 74;
const BASE_SPEED = 330, MAX_SPEED = 620;
const AI_SPEED = 400;
const BALL_R = 7;
const EDGE = 30;
const TARGET = 5;

const speedFor = (rally) => Math.min(BASE_SPEED + rally * 18, MAX_SPEED);

function serve(s, dir) {
    s.longest = Math.max(s.longest, s.rally);
    s.rally = 0;
    s.serveT = 0.7;
    s.ball = {
        x: s.W / 2, y: 120 + s.rng() * 180,
        vx: dir * BASE_SPEED * 0.8,
        vy: (s.rng() * 2 - 1) * BASE_SPEED * 0.45,
        trail: [],
    };
}

function reset(s) {
    s.state = 'ready';
    s.you = s.H / 2;
    s.machine = s.H / 2;
    s.scoreYou = 0;
    s.scoreMachine = 0;
    s.rally = 0;
    s.longest = 0;
    s.keyDir = 0;
    serve(s, s.rng() < 0.5 ? -1 : 1);
}

/** Whether a message box is up. While it is, the game takes no input except the press that dismisses it. */
const modalUp = (s) => s.state !== 'play';

function start(s) {
    if (s.state === 'over') reset(s);
    s.state = 'play';
}

// While a message box is up, the only input that gets through is the press
// that dismisses it, and key releases, so a key held when it appeared is not
// left stuck down.
function handleKey(s, code, down) {
    if (down && (code === 'Space' || code === 'Enter')) { start(s); return; }
    if (modalUp(s) && down) return;
    if (code === 'ArrowUp' || code === 'KeyW') s.keyDir = down ? -1 : 0;
    if (code === 'ArrowDown' || code === 'KeyS') s.keyDir = down ? 1 : 0;
}

function handlePointer(s, type, y) {
    if (modalUp(s)) { if (type === 'pointerdown') start(s); return; }
    if (type !== 'pointerup') s.you = y;
}

function bounceOff(s, padY, dir) {
    const off = Math.max(-1, Math.min(1, (s.ball.y - padY) / (PAD_H / 2)));
    const ang = off * 0.95;
    const speed = speedFor(s.rally);
    s.ball.vx = dir * Math.cos(ang) * speed;
    s.ball.vy = Math.sin(ang) * speed;
    s.rally++;
}

function finishPoint(s, dir) {
    if (s.scoreMachine >= TARGET || s.scoreYou >= TARGET) {
        s.longest = Math.max(s.longest, s.rally);
        // A key held now must not move the paddle behind the box.
        s.keyDir = 0;
        s.state = 'over';
        if (s.scoreYou >= TARGET) s.best('shutterPongWins', 1);
    } else {
        serve(s, dir);
    }
}

// Follows the ball at a capped speed with a small wobble, and moves back to
// the middle while the ball is heading away.
function moveMachine(s, dt) {
    const aim = s.ball.vx > 0 ? s.ball.y + Math.sin(s.rally * 1.7) * 16 : s.H / 2;
    const step = AI_SPEED * dt;
    if (Math.abs(aim - s.machine) > step) s.machine += Math.sign(aim - s.machine) * step;
    else s.machine = aim;
    s.machine = Math.max(PAD_H / 2, Math.min(s.H - PAD_H / 2, s.machine));
}

function collidePaddles(s) {
    const b = s.ball;
    if (b.vx < 0 && b.x - BALL_R <= EDGE + PAD_W && b.x > EDGE &&
        Math.abs(b.y - s.you) < PAD_H / 2 + BALL_R) {
        b.x = EDGE + PAD_W + BALL_R;
        bounceOff(s, s.you, 1);
    }
    const right = s.W - EDGE - PAD_W;
    if (b.vx > 0 && b.x + BALL_R >= right && b.x < s.W - EDGE &&
        Math.abs(b.y - s.machine) < PAD_H / 2 + BALL_R) {
        b.x = right - BALL_R;
        bounceOff(s, s.machine, -1);
    }
}

function update(s, dt) {
    if (s.keyDir) s.you += s.keyDir * 560 * dt;
    s.you = Math.max(PAD_H / 2, Math.min(s.H - PAD_H / 2, s.you));
    if (s.state !== 'play') return;
    if (s.serveT > 0) { s.serveT -= dt; return; }

    const b = s.ball;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.y < 8) { b.y = 8; b.vy = Math.abs(b.vy); }
    if (b.y > s.H - 8) { b.y = s.H - 8; b.vy = -Math.abs(b.vy); }

    moveMachine(s, dt);
    collidePaddles(s);

    if (b.x < -20) { s.scoreMachine++; finishPoint(s, 1); }
    else if (b.x > s.W + 20) { s.scoreYou++; finishPoint(s, -1); }

    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 14) b.trail.shift();
}

function drawScore(s, ctx) {
    const c = s.S.colors;
    s.S.text(ctx, s.g.you, s.W / 2 - 120, 46, { color: c.dim, size: 11, align: 'center' });
    s.S.text(ctx, s.g.machine, s.W / 2 + 120, 46, { color: c.dim, size: 11, align: 'center' });
    s.S.text(ctx, String(s.scoreYou), s.W / 2 - 120, 92,
        { color: c.ink, size: 42, align: 'center', bold: true });
    s.S.text(ctx, String(s.scoreMachine), s.W / 2 + 120, 92,
        { color: c.h, size: 42, align: 'center', bold: true });
}

function drawEnd(s, ctx) {
    const won = s.scoreYou >= TARGET;
    s.S.overlay(ctx,
        won ? s.g.youTake : s.g.machineTakes,
        [s.g.result(Math.max(s.scoreYou, s.scoreMachine), Math.min(s.scoreYou, s.scoreMachine), s.longest)],
        won ? 'good' : 'bad',
        s.t.playAgain);
}

function draw(s, ctx) {
    const c = s.S.colors;
    s.S.clear(ctx);
    s.S.line(ctx, [[s.W / 2, 0], [s.W / 2, s.H]], c.grid, 2, { dash: true });
    drawScore(s, ctx);

    s.S.trail(ctx, s.ball.trail, c.photon);
    s.S.block(ctx, { x: EDGE, y: s.you - PAD_H / 2, w: PAD_W, h: PAD_H }, c.paddle);
    s.S.block(ctx, { x: s.W - EDGE - PAD_W, y: s.machine - PAD_H / 2, w: PAD_W, h: PAD_H }, c.paddle);
    if (s.serveT <= 0 || s.state !== 'play') s.S.dot(ctx, s.ball.x, s.ball.y, BALL_R, c.photon);
    if (s.rally > 2) {
        s.S.text(ctx, s.g.rally(s.rally), s.W / 2, s.H - 16, { color: c.dim, size: 12, align: 'center' });
    }

    if (s.state === 'ready') {
        s.S.overlay(ctx, s.g.name, [s.g.firstTo(TARGET), '', s.g.controls], 'info', s.t.start);
    } else if (s.state === 'over') {
        drawEnd(s, ctx);
    }
}

export function createShutterPong(api) {
    const s = { W: api.W, H: api.H, S: api.skin, t: api.t, g: api.t.shutterPong, best: api.best, rng: makeRng(api.seed) };
    reset(s);

    return {
        update: (dt) => update(s, dt),
        draw: (ctx) => draw(s, ctx),
        hud: () => [
            [s.g.hudYou, s.scoreYou],
            [s.g.hudMachine, s.scoreMachine],
            [s.g.hudRally, s.rally],
            [s.g.hudLongest, s.longest],
        ],
        onKey: (code, down) => handleKey(s, code, down),
        onPointer: (type, x, y) => handlePointer(s, type, y),
    };
}
