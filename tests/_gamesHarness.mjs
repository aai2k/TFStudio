/**
 * Shared by the games tests: a skin that records draw calls instead of painting,
 * and a bot that plays Photon Runner well. The bot sees only what the game
 * draws, so the games need no test-only API. The underscore keeps the test
 * runner from running this file as a test.
 */

import en from '../src/constants/locales/en.js';
import { createTurningPoint } from '../src/components/windows/information/games/turningPoint.js';
import { createPhotonRunner } from '../src/components/windows/information/games/photonRunner.js';
import { createFlappyPhoton } from '../src/components/windows/information/games/flappyPhoton.js';
import { createRefractingBreakout } from '../src/components/windows/information/games/refractingBreakout.js';
import { createShutterPong } from '../src/components/windows/information/games/shutterPong.js';
import { createSputterStorm } from '../src/components/windows/information/games/sputterStorm.js';

export const W = 720, H = 420;
export const GAMES = {
    turningPoint: createTurningPoint,
    photonRunner: createPhotonRunner,
    flappyPhoton: createFlappyPhoton,
    refractingBreakout: createRefractingBreakout,
    sputterStorm: createSputterStorm,
    shutterPong: createShutterPong,
};

// A fixed seed, so a failure can be reproduced.
export const SEED = 20260921;

const noop = () => {};

// Approximates the width of the proportional font the window uses.
const textWidth = (str, o = {}) => String(str).length * (o.size || 11) * 0.55;

export function stubCtx() {
    return {
        canvas: { width: W, height: H },
        setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
        beginPath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
        ellipse: noop, closePath: noop, fill: noop, stroke: noop, save: noop,
        restore: noop, translate: noop, rotate: noop, scale: noop, clip: noop,
        rect: noop, setLineDash: noop, fillText: noop, strokeText: noop,
        measureText: (s) => ({ width: String(s).length * 7 }),
        createPattern: () => ({}),
    };
}

/** A skin that draws nothing and remembers everything drawn this frame. */
function recordingSkin() {
    const frame = { dots: [], blocks: [], overlays: [], texts: [], rings: [] };
    return {
        frame,
        colors: {
            bg: '#fff', panel: '#c0c0c0', ink: '#000', dim: '#808080', grid: '#c0c0c0',
            photon: '#000080', h: '#800000', l: '#000080', danger: '#f00', good: '#080',
            obstacle: '#808080', paddle: '#c0c0c0',
        },
        clear() {
            frame.dots = []; frame.blocks = []; frame.overlays = [];
            frame.texts = []; frame.rings = [];
        },
        text(ctx, str, x, y, o = {}) { frame.texts.push({ str: String(str), x, y, ...o }); },
        width(ctx, str, o) { return textWidth(str, o); },
        on() { return '#ffffff'; },
        dot(ctx, x, y, r) { frame.dots.push({ x, y, r }); },
        ring(ctx, x, y, r) { frame.rings.push({ x, y, r }); },
        block(ctx, rect) { frame.blocks.push({ ...rect }); },
        line: noop, trail: noop, band: noop, plate: noop,
        overlay(ctx, title) { frame.overlays.push(String(title)); },
        post: noop,
    };
}

export function makeGame(id, seed = SEED, extra = {}) {
    const skin = recordingSkin();
    const keep = (key, value) => value || 0;
    const api = { W, H, skin, t: en.games, best: keep, fewest: keep, seed, ...extra };
    const game = GAMES[id](api);
    const ctx = stubCtx();
    return { game, frame: skin.frame, step: (dt = 1 / 60) => { game.update(dt); game.draw(ctx); } };
}

/**
 * The bounding box of each string drawn this frame, from a line height above
 * the baseline to a descender below it.
 */
export function textBoxes(frame) {
    return frame.texts.map(t => {
        const w = textWidth(t.str, t);
        const size = t.size || 11;
        const left = t.align === 'right' ? t.x - w : t.align === 'center' ? t.x - w / 2 : t.x;
        return { str: t.str, x: left, y: t.y - size, w, h: size + 2 };
    });
}

export const overlaps = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ── Photon Runner bot ────────────────────────────────────────────────────────

const RUN = {
    PX: 118,
    DT: 1 / 60,
    APEX_S: 780 / 2400,                     // first jump, to the top of its arc
    DOUBLE_PEAK_S: 780 / 2400 + 640 / 2400, // and the second jump from there
    GROUND_Y: 319,
};

const isColumn = (b) => b.y > 150 && b.y < 260;
const kindOf = (b) => (b.y === 0 ? 'shutter' : isColumn(b) ? 'column' : 'dust');

/** What the bot sees this frame, from the draw calls. */
function runnerSight(frame) {
    // Skip the 6 px red edge drawn on shutters and columns.
    const solid = frame.blocks.filter(b => b.h > 10);
    const photon = frame.dots[frame.dots.length - 1];
    return {
        solid,
        shutters: solid.filter(b => b.y === 0),
        ahead: solid.filter(b => b.x + b.w > RUN.PX - 10).sort((a, b) => a.x - b.x),
        onGround: Boolean(photon) && photon.y >= RUN.GROUND_Y,
    };
}

/**
 * Speed from how far the obstacles moved this frame. Null when one spawned or
 * left, so the caller keeps the last value.
 */
function speedFrom(prevXs, xs) {
    if (!prevXs || prevXs.length !== xs.length || xs.length === 0) return null;
    const moved = prevXs[0] - xs[0];
    return moved > 0 && moved < 30 ? moved / RUN.DT : null;
}

function whatKilledIt(solid) {
    const over = solid.filter(o => o.x <= RUN.PX + 10 && o.x + o.w >= RUN.PX - 10);
    return over.length === 0 ? 'nothing' : kindOf(over[0]);
}

function press(bot) {
    bot.game.onKey('Space', true);
    bot.game.onKey('Space', false);
}

function setDuck(bot, sight) {
    const want = sight.shutters.some(sh => sh.x - RUN.PX < 70 && sh.x + sh.w > RUN.PX - 14);
    if (want === bot.ducking) return;
    bot.game.onKey('ArrowDown', want);
    bot.ducking = want;
}

function takeJump(bot, sight) {
    const next = sight.ahead.filter(o => o.x - RUN.PX > 0)[0];
    if (!next || (bot.duckShutters && next.y === 0)) return;
    const lead = bot.speed * (isColumn(next) ? RUN.DOUBLE_PEAK_S : RUN.APEX_S);
    if (Math.abs((next.x - RUN.PX) - lead) >= 7) return;
    press(bot);
    if (isColumn(next)) bot.secondJumpIn = RUN.APEX_S;
}

function advance(bot, sight) {
    if (bot.secondJumpIn > 0 && (bot.secondJumpIn -= RUN.DT) <= 0) press(bot);
    const xs = sight.ahead.map(o => o.x);
    bot.speed = speedFrom(bot.prevXs, xs) ?? bot.speed;
    bot.prevXs = xs;

    if (bot.duckShutters) setDuck(bot, sight);
    if (bot.ducking || bot.speed === null || !sight.onGround) return;
    takeJump(bot, sight);
}

/**
 * Plays Photon Runner well: times each jump to peak over the obstacle, double
 * jumps columns, and ducks shutters only when `duckShutters` is on.
 */
export function playRunner({ duckShutters, frames = 3600, seed }) {
    const { game, frame, step } = makeGame('photonRunner', seed);
    const bot = {
        game, duckShutters,
        prevXs: null, speed: null, secondJumpIn: 0, ducking: false,
    };
    press(bot);

    for (let i = 0; i < frames; i++) {
        step(RUN.DT);
        const sight = runnerSight(frame);
        if (frame.overlays.length) {
            return { died: true, at: i * RUN.DT, kind: whatKilledIt(sight.solid) };
        }
        advance(bot, sight);
    }
    return { died: false, at: frames * RUN.DT, kind: null };
}
