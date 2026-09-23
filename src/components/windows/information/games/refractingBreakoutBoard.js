/**
 * Refracting Breakout board: the media stack, brick layouts, paddle and ball
 * collisions, and drawing.
 */

export const BOUNDS = [118, 208, 300];
export const MEDIA = [
    { n: 1.00, key: null },
    { n: 2.35, name: 'TiO2', key: 'h' },
    { n: 1.46, name: 'SiO2', key: 'l' },
    { n: 1.00, key: null },
];
export const PADDLE_Y = 384;
export const PADDLE_W = 104;
export const PADDLE_H = 12;
export const BALL_R = 6;

// The brick field. It starts right of the media labels and ends above the
// lowest interface, so no brick is in the paddle's vacuum. The top and row pitch
// put the interfaces at 118 and 208 between rows, so every brick lies in one
// medium and takes its colour.
const FIELD_L = 92;
const FIELD_R = 708;
const FIELD_T = 100;
export const COLS = 22;
export const ROWS = 10;
const GAP = 3;
const BRICK_H = 15;
const ROW_PITCH = 18;

// Label gutter, header baseline, and the baseline of the reflection message.
const GUTTER_X = 12;
const HEAD_Y = 24;
const FLASH_Y = 62;

/**
 * One layout per level: a line per brick row, `#` for a brick. Levels past the
 * last layout repeat from the first, with a faster ball.
 */
const LAYOUTS = [
    [   // Two slabs.
        '......................',
        '......................',
        '.####################.',
        '.####################.',
        '......................',
        '......................',
        '.####################.',
        '.####################.',
        '......................',
        '......................',
    ],
    [   // Checkerboard.
        '......................',
        '#.#.#.#.#.#.#.#.#.#.#.',
        '.#.#.#.#.#.#.#.#.#.#.#',
        '#.#.#.#.#.#.#.#.#.#.#.',
        '.#.#.#.#.#.#.#.#.#.#.#',
        '#.#.#.#.#.#.#.#.#.#.#.',
        '.#.#.#.#.#.#.#.#.#.#.#',
        '#.#.#.#.#.#.#.#.#.#.#.',
        '.#.#.#.#.#.#.#.#.#.#.#',
        '......................',
    ],
    [   // Three nested shells around a core.
        '######################',
        '#....................#',
        '#.##################.#',
        '#.#................#.#',
        '#.#.##############.#.#',
        '#.#.##############.#.#',
        '#.#................#.#',
        '#.##################.#',
        '#....................#',
        '######################',
    ],
    [   // Pillars, open from below.
        '######################',
        '######################',
        '##..##..##..##..##..##',
        '##..##..##..##..##..##',
        '##..##..##..##..##..##',
        '##..##..##..##..##..##',
        '##..##..##..##..##..##',
        '######################',
        '......................',
        '......................',
    ],
    [   // Wedge, widest at the bottom.
        '..........##..........',
        '.........####.........',
        '........######........',
        '.......########.......',
        '......##########......',
        '.....############.....',
        '....##############....',
        '...################...',
        '..##################..',
        '.####################.',
    ],
    [   // Comb: tunnels open at the bottom.
        '######################',
        '######################',
        '#.#.#.#.#.#.#.#.#.#.#.',
        '#.#.#.#.#.#.#.#.#.#.#.',
        '#.#.#.#.#.#.#.#.#.#.#.',
        '#.#.#.#.#.#.#.#.#.#.#.',
        '#.#.#.#.#.#.#.#.#.#.#.',
        '#.#.#.#.#.#.#.#.#.#.#.',
        '#.#.#.#.#.#.#.#.#.#.#.',
        '......................',
    ],
    [   // Four rooms off one corridor.
        '##########..##########',
        '##......##..##......##',
        '##......##..##......##',
        '##########..##########',
        '......................',
        '##########..##########',
        '##......##..##......##',
        '##......##..##......##',
        '##########..##########',
        '......................',
    ],
    [   // One tunnel folded four times.
        '######################',
        '#....................#',
        '####################.#',
        '#....................#',
        '#.####################',
        '#....................#',
        '####################.#',
        '#....................#',
        '#.####################',
        '######################',
    ],
    [   // Wall with four holes.
        '######################',
        '###.##############.###',
        '######################',
        '#######.######.#######',
        '######################',
        '###.##############.###',
        '######################',
        '#######.######.#######',
        '######################',
        '......................',
    ],
    [   // Staggered lattice.
        '##..##..##..##..##..##',
        '##..##..##..##..##..##',
        '..##..##..##..##..##..',
        '..##..##..##..##..##..',
        '##..##..##..##..##..##',
        '##..##..##..##..##..##',
        '..##..##..##..##..##..',
        '..##..##..##..##..##..',
        '##..##..##..##..##..##',
        '##..##..##..##..##..##',
    ],
    [   // Hourglass.
        '.####################.',
        '..##################..',
        '...################...',
        '....##############....',
        '.....############.....',
        '.....############.....',
        '....##############....',
        '...################...',
        '..##################..',
        '.####################.',
    ],
    [   // Four corridors.
        '######################',
        '#....................#',
        '######################',
        '#....................#',
        '######################',
        '#....................#',
        '######################',
        '#....................#',
        '######################',
        '......................',
    ],
];

export const LEVEL_COUNT = LAYOUTS.length;

export function layoutFor(level) {
    return LAYOUTS[(level - 1) % LAYOUTS.length];
}

/** Index of the medium at height `y`. */
export function bandOf(y) {
    for (let i = 0; i < BOUNDS.length; i++) if (y < BOUNDS[i]) return i;
    return BOUNDS.length;
}

export function buildBricks(s) {
    s.bricks = [];
    const layout = layoutFor(s.level);
    const w = (FIELD_R - FIELD_L - (COLS - 1) * GAP) / COLS;
    for (let r = 0; r < ROWS; r++) {
        for (let col = 0; col < COLS; col++) {
            if (layout[r][col] !== '#') continue;
            const y = FIELD_T + r * ROW_PITCH;
            s.bricks.push({
                x: FIELD_L + col * (w + GAP), y, w, h: BRICK_H, alive: true,
                key: MEDIA[bandOf(y + BRICK_H / 2)].key || 'obstacle',
            });
        }
    }
}

export function movePaddle(s, dt) {
    if (s.keyDir) s.paddle.x += s.keyDir * 520 * dt;
    s.paddle.x = Math.max(s.paddle.w / 2, Math.min(s.W - s.paddle.w / 2, s.paddle.x));
}

export function bounceWalls(s) {
    const b = s.ball;
    if (b.x < b.r) { b.x = b.r; b.vx = -b.vx; }
    if (b.x > s.W - b.r) { b.x = s.W - b.r; b.vx = -b.vx; }
    if (b.y < b.r) { b.y = b.r; b.vy = -b.vy; }
}

/** Bounce off the paddle. Where the ball lands on it sets the exit angle. */
export function collidePaddle(s, speed) {
    const b = s.ball;
    if (b.vy <= 0 || b.y + b.r < PADDLE_Y || b.y - b.r >= PADDLE_Y + PADDLE_H) return;
    if (Math.abs(b.x - s.paddle.x) >= s.paddle.w / 2 + b.r) return;

    const ang = -Math.PI / 2 + (b.x - s.paddle.x) / (s.paddle.w / 2);
    b.vx = Math.cos(ang) * speed;
    b.vy = Math.sin(ang) * speed;
    b.y = PADDLE_Y - b.r - 1;
    b.band = bandOf(b.y);
    s.tirRun = 0;
}

// Labels sit on the band pattern, so they get an opaque plate behind them.
function plateLabel(s, ctx, text, y) {
    const w = s.S.width(ctx, text, { size: 11 });
    s.S.plate(ctx, GUTTER_X - 5, y - 11, w + 10, 15);
    s.S.text(ctx, text, GUTTER_X, y, { color: s.S.colors.dim, size: 11 });
}

function drawBands(s, ctx) {
    const c = s.S.colors;
    let top = 0;
    for (let m = 0; m < MEDIA.length; m++) {
        const bottom = m < BOUNDS.length ? BOUNDS[m] : s.H;
        if (MEDIA[m].key) s.S.band(ctx, top, bottom, c[MEDIA[m].key]);
        // Name and index, centred in the band in the label gutter.
        const mid = Math.round((top + bottom) / 2);
        plateLabel(s, ctx, MEDIA[m].name || s.g.vacuum, mid - 3);
        plateLabel(s, ctx, 'n = ' + MEDIA[m].n.toFixed(2), mid + 12);
        top = bottom;
    }
    for (const b of BOUNDS) s.S.line(ctx, [[0, b], [s.W, b]], c.dim, 1);
}

/**
 * Whether a message box is up. While it is, the game takes no input except the
 * press that dismisses it. The opening box shows only before the first serve.
 */
export const modalUp = (s) =>
    s.state === 'dead' || s.state === 'cleared' || (s.state === 'ready' && !s.started);

function drawOverlay(s, ctx) {
    if (!modalUp(s)) return;
    if (s.state === 'ready') {
        s.S.overlay(ctx, s.g.name, [s.g.howTo, '', s.g.controls], 'info', s.t.start);
    } else if (s.state === 'dead') {
        s.S.overlay(ctx, s.g.stackSurvived, [
            s.g.levelsCleared(s.level - s.startLevel),
            s.g.bestLevels(s.best('breakout', 0)),
        ], 'bad', s.t.playAgain);
    } else if (s.state === 'cleared') {
        s.S.overlay(ctx, s.g.levelCleared(s.level), [s.g.livesLeft(s.lives)], 'good', s.g.nextLevel);
    }
}

export function draw(s, ctx) {
    const c = s.S.colors;
    s.S.clear(ctx);
    drawBands(s, ctx);

    for (const brick of s.bricks) {
        if (brick.alive) s.S.block(ctx, brick, c[brick.key]);
    }

    s.S.trail(ctx, s.ball.trail, c.photon);
    s.S.dot(ctx, s.ball.x, s.ball.y, s.ball.r, c.photon);
    s.S.block(ctx, { x: s.paddle.x - s.paddle.w / 2, y: PADDLE_Y, w: s.paddle.w, h: PADDLE_H }, c.paddle);

    if (s.ftirFlash > 0) {
        s.S.text(ctx, s.g.frustrated, s.W / 2, FLASH_Y, { color: c.good, size: 14, align: 'center', bold: true });
    } else if (s.tirFlash > 0) {
        s.S.text(ctx, s.g.totalInternal, s.W / 2, FLASH_Y, { color: c.h, size: 14, align: 'center', bold: true });
    }

    s.S.text(ctx, s.g.lives(s.lives), GUTTER_X, HEAD_Y, { color: c.dim, size: 11 });
    s.S.text(ctx, s.g.level(s.level), s.W / 2, HEAD_Y, { color: c.dim, size: 11, align: 'center' });
    s.S.text(ctx, s.g.bricksLeft(s.bricks.length - s.cleared), s.W - GUTTER_X, HEAD_Y,
        { color: c.dim, size: 11, align: 'right' });

    drawOverlay(s, ctx);
}
