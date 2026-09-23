/** Photon Runner geometry, collision box and drawing. */

export const GROUND = 330;
export const PX = 118;
// A shutter hangs from the top of the stage down to here. The standing photon
// overlaps it by 3 px and the ducking one clears it by 5, so a shutter can only
// be ducked.
export const SHUTTER_BOTTOM = 313;
export const STAND = { w: 20, h: 20 };
export const DUCK = { w: 24, h: 12 };

// A single jump rises 126 px, so every column needs the double jump.
export const COLUMN_MIN_H = 132;
export const COLUMN_MAX_H = 152;

// Photon colour and trail length by distance: day colours for a light page,
// night colours for the black chamber and for a dark scheme.
const TIERS = [
    { from: 0, day: '#000080', night: '#00ffff' },
    { from: 1200, day: '#008080', night: '#00ff00' },
    { from: 2400, day: '#008000', night: '#ffff00' },
    { from: 3600, day: '#800080', night: '#ff00ff' },
    { from: 4800, day: '#800000', night: '#ff0000' },
];

function photonTier(dist) {
    let index = 0;
    for (let i = 0; i < TIERS.length; i++) if (dist >= TIERS[i].from) index = i;
    return index;
}

export function photonColor(dist, night) {
    const tier = TIERS[photonTier(dist)];
    return night ? tier.night : tier.day;
}

export function trailLength(dist) {
    return 16 + photonTier(dist) * 6;
}

/** The photon's collision box, which is also the drawn size. */
export function box(s) {
    if (s.ducking && s.y > GROUND - 26) {
        return { x: PX - DUCK.w / 2, y: GROUND - DUCK.h, w: DUCK.w, h: DUCK.h };
    }
    return { x: PX - STAND.w / 2, y: s.y - STAND.h / 2, w: STAND.w, h: STAND.h };
}

// Layer boundaries drifting past, slower than the ground.
function drawBackground(s, ctx) {
    s.S.clear(ctx, { night: s.night });
    const grid = s.night ? '#303030' : s.S.colors.grid;
    for (let i = 0; i < 6; i++) {
        const ly = 60 + i * 34;
        s.S.line(ctx, [[0, ly], [s.W, ly]], grid, 1);
    }
    const off = (s.dist * 0.6) % 160;
    for (let v = -1; v < 6; v++) {
        const vx = v * 160 - off + 40;
        s.S.line(ctx, [[vx, 60], [vx, 230]], grid, 1);
    }
}

function drawGround(s, ctx) {
    const ink = s.night ? '#ffffff' : s.S.colors.ink;
    s.S.line(ctx, [[0, GROUND], [s.W, GROUND]], ink, 2);
    const hatch = (s.dist * 2) % 22;
    const faint = s.night ? '#303030' : s.S.colors.grid;
    for (let x = -22; x < s.W + 22; x += 22) {
        s.S.line(ctx, [[x - hatch, s.H], [x - hatch + 26, GROUND + 2]], faint, 1);
    }
}

function drawObstacles(s, ctx) {
    const c = s.S.colors;
    for (const o of s.obstacles) {
        s.S.block(ctx, o, c.obstacle);
        // Red edge on the side to clear: the bottom of a shutter, the top of a column.
        if (o.kind === 'shutter') s.S.block(ctx, { x: o.x - 3, y: o.h - 6, w: o.w + 6, h: 6 }, c.danger);
        if (o.kind === 'column') s.S.block(ctx, { x: o.x - 3, y: o.y, w: o.w + 6, h: 6 }, c.danger);
    }
}

function drawOverlay(s, ctx) {
    if (s.state === 'ready') {
        s.S.overlay(ctx, s.g.name, [s.g.howTo, '', s.g.controls], 'info', s.t.start);
    } else if (s.state === 'dead') {
        s.S.overlay(ctx, s.g.scattered, [
            s.g.pathLength(Math.floor(s.dist)),
            s.g.bestPath(s.best('photonRunner', 0)),
        ], 'bad', s.t.playAgain);
    }
}

export function draw(s, ctx) {
    const c = s.S.colors;
    ctx.save();
    if (s.shakeT > 0) ctx.translate((s.rng() - 0.5) * 7, (s.rng() - 0.5) * 7);

    drawBackground(s, ctx);
    drawGround(s, ctx);
    drawObstacles(s, ctx);

    const me = box(s);
    const tint = photonColor(s.dist, s.night || s.S.dark);
    s.S.trail(ctx, s.trail, tint);
    s.S.dot(ctx, me.x + me.w / 2, me.y + me.h / 2, me.h / 2, tint);

    const ink = s.night ? '#ffffff' : c.ink;
    s.S.text(ctx, Math.floor(s.dist) + ' nm', s.W - 18, 34, { color: ink, size: 13, align: 'right' });
    s.S.text(ctx, s.night ? s.g.nightShift : s.g.dayShift, 18, 34, { color: ink, size: 10 });
    ctx.restore();

    drawOverlay(s, ctx);
}
