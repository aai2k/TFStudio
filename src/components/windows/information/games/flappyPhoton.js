/** Flappy Photon: fly a photon through the gaps between H and L layers. */

import { makeRng } from './rng.js';

const PX = 170;
const GRAVITY = 1450;
const FLAP_V = -410;
const GAP = 134;
const BAR_W = 54;
const SPACING = 276;
const FLOOR = 396;
const R = 9;

function addBar(s, x) {
    const margin = 62;
    s.bars.push({ x, top: margin + s.rng() * (FLOOR - GAP - margin * 2), passed: false });
}

function reset(s) {
    s.state = 'ready';
    s.y = s.H / 2;
    s.vy = 0;
    s.score = 0;
    s.speed = 200;
    s.scroll = 0;
    s.spin = 0;
    s.bars = [];
    for (let i = 0; i < 4; i++) addBar(s, s.W + 120 + i * SPACING);
}

/** Whether a message box is up. The press that dismisses it is not also a flap. */
const modalUp = (s) => s.state !== 'play';

function flap(s) {
    if (modalUp(s)) {
        if (s.state === 'dead') reset(s);
        s.state = 'play';
        return;
    }
    s.spin = 1;
    s.vy = FLAP_V;
}

function die(s) {
    s.state = 'dead';
    s.best('flappyPhoton', s.score);
}

function stepBars(s, dt) {
    for (let i = s.bars.length - 1; i >= 0; i--) {
        const b = s.bars[i];
        b.x -= s.speed * dt;
        const overlapX = PX + R > b.x && PX - R < b.x + BAR_W;
        if (overlapX && (s.y - R < b.top || s.y + R > b.top + GAP)) die(s);
        if (!b.passed && b.x + BAR_W < PX - R) { b.passed = true; s.score++; }
        if (b.x < -BAR_W - 20) {
            s.bars.splice(i, 1);
            addBar(s, s.bars[s.bars.length - 1].x + SPACING);
        }
    }
}

function update(s, dt) {
    if (s.spin > 0) s.spin = Math.max(0, s.spin - dt * 3);
    if (s.state !== 'play') return;

    s.speed = Math.min(200 + s.score * 3.5, 300);
    s.scroll += s.speed * dt;
    s.vy += GRAVITY * dt;
    s.y += s.vy * dt;

    if (s.y > FLOOR - R) { s.y = FLOOR - R; die(s); }
    if (s.y < 10) { s.y = 10; s.vy = 0; }

    stepBars(s, dt);
}

// Top block is the high index material, bottom is the low index one.
function drawBars(s, ctx) {
    const c = s.S.colors;
    for (const b of s.bars) {
        s.S.block(ctx, { x: b.x, y: -4, w: BAR_W, h: b.top + 4 }, c.h);
        s.S.block(ctx, { x: b.x, y: b.top + GAP, w: BAR_W, h: FLOOR - b.top - GAP + 4 }, c.l);
        s.S.text(ctx, 'H', b.x + BAR_W / 2, b.top - 12, { color: s.S.on(c.h), size: 13, align: 'center', bold: true });
        s.S.text(ctx, 'L', b.x + BAR_W / 2, b.top + GAP + 24, { color: s.S.on(c.l), size: 13, align: 'center', bold: true });
    }
}

function draw(s, ctx) {
    const c = s.S.colors;
    s.S.clear(ctx);

    const off = s.scroll % 48;
    for (let x = -48; x < s.W + 48; x += 48) {
        s.S.line(ctx, [[x - off, 0], [x - off, FLOOR]], c.grid, 1);
    }
    drawBars(s, ctx);

    s.S.block(ctx, { x: 0, y: FLOOR, w: s.W, h: s.H - FLOOR }, c.panel);
    s.S.line(ctx, [[0, FLOOR], [s.W, FLOOR]], c.ink, 2);

    ctx.save();
    ctx.translate(PX, s.y);
    ctx.rotate(Math.max(-0.5, Math.min(0.9, s.vy / 700)));
    s.S.dot(ctx, 0, 0, 10 - s.spin * 2, c.photon);
    ctx.restore();

    s.S.text(ctx, String(s.score), s.W / 2, 66, { color: c.dim, size: 44, align: 'center', bold: true });

    if (s.state === 'ready') {
        s.S.overlay(ctx, s.g.name, [s.g.howTo, '', s.g.controls], 'info', s.t.start);
    } else if (s.state === 'dead') {
        s.S.overlay(ctx, s.g.absorbed, [
            s.g.cleared(s.score),
            s.g.bestCleared(s.best('flappyPhoton', 0)),
        ], 'bad', s.t.playAgain);
    }
}

export function createFlappyPhoton(api) {
    const s = {
        W: api.W, H: api.H, S: api.skin, t: api.t, g: api.t.flappyPhoton, best: api.best,
        rng: makeRng(api.seed),
    };
    reset(s);

    return {
        update: (dt) => update(s, dt),
        draw: (ctx) => draw(s, ctx),
        hud: () => [
            [s.g.hudCleared, s.score],
            [s.t.hudBest, s.best('flappyPhoton', 0)],
        ],
        onKey: (code, down) => {
            if (down && (code === 'Space' || code === 'ArrowUp' || code === 'KeyW')) flap(s);
        },
        onPointer: (type) => { if (type === 'pointerdown') flap(s); },
    };
}
