/**
 * Turning Point Cutter: reflectance at 550 nm swings as a layer grows and
 * flattens at each quarter-wave point, where the layer is cut.
 *
 * The signal is flat near an extremum, so its noise decides how precisely the
 * turning point can be found. Runs: turningPointLevels.js. Drawing:
 * turningPointBoard.js.
 */

import { makeRng } from './rng.js';
import { levelPlan, layerPlan } from './turningPointLevels.js';
import { draw } from './turningPointBoard.js';

const LAMBDA_NM = 550;
const MATERIALS = [
    { name: 'TiO2', n: 2.35, key: 'h' },
    { name: 'SiO2', n: 1.46, key: 'l' },
];

const BUDGET_NM = 40;
const SCRAP_AFTER = 0.8;
const HISTORY_POINTS = 900;

function newLayer(s) {
    const mat = MATERIALS[s.layerIndex % 2];
    const plan = layerPlan(s.plan);
    s.layer = {
        mat,
        qwot: LAMBDA_NM / (4 * mat.n),
        target: plan.target,
        mid: plan.mid,
        amp: plan.amp,
        dir: s.layerIndex % 2 === 0 ? 1 : -1,
        x: 0,
    };
    s.history = [];
    s.noise = 0;
}

// The error budget is per run: each run is a new coating.
function startLevel(s, level) {
    s.level = level;
    s.plan = levelPlan(level);
    s.layerIndex = 0;
    s.budget = BUDGET_NM;
    s.budgetMax = BUDGET_NM;
    s.totalErr = 0;
    s.stack = [];
    newLayer(s);
    s.state = 'ready';
}

function reset(s) {
    s.flash = null;
    startLevel(s, s.startLevel);
}

/** True signal: the extrema land on integer quarter-wave points. */
function signal(layer, x) {
    return layer.mid - layer.dir * layer.amp * Math.cos(Math.PI * x);
}

function cut(s, auto) {
    const errNm = Math.abs(s.layer.x - s.layer.target) * s.layer.qwot;
    s.totalErr += errNm;
    s.budget -= errNm;
    s.stack.push({ mat: s.layer.mat, nm: s.layer.target * s.layer.qwot, err: errNm });
    s.flash = { t: 0.9, err: errNm, auto: !!auto };

    if (s.budget <= 0) {
        s.state = 'dead';
        s.best('turningPoint', s.level - 1);
        return;
    }
    s.layerIndex++;
    if (s.layerIndex >= s.plan.layers) {
        s.state = 'cleared';
        s.best('turningPoint', s.level);
        return;
    }
    newLayer(s);
}

function press(s) {
    if (s.state === 'play') { cut(s, false); return; }
    if (s.state === 'dead') reset(s);
    else if (s.state === 'cleared') startLevel(s, s.level + 1);
    s.state = 'play';
}

function update(s, dt) {
    if (s.flash) {
        s.flash.t -= dt;
        if (s.flash.t <= 0) s.flash = null;
    }
    if (s.state !== 'play') return;

    s.layer.x += s.plan.rate * dt;
    s.noise = s.noise * 0.86 + (s.rng() * 2 - 1) * 0.42;
    s.history.push({ x: s.layer.x, v: signal(s.layer, s.layer.x) + s.noise * s.plan.noiseAmp });
    if (s.history.length > HISTORY_POINTS) s.history.shift();

    // A layer grown SCRAP_AFTER quarter waves past its target is cut where it is.
    if (s.layer.x > s.layer.target + SCRAP_AFTER) cut(s, true);
}

export function createTurningPoint(api) {
    const s = {
        W: api.W, H: api.H, S: api.skin, t: api.t, g: api.t.turningPoint, best: api.best,
        rng: makeRng(api.seed),
        // The run picked in the window. Losing sends the game back here.
        startLevel: Math.max(1, api.level || 1),
    };
    reset(s);

    return {
        update: (dt) => update(s, dt),
        draw: (ctx) => draw(s, ctx),
        level: () => s.level,
        hud: () => [
            [s.g.hudRun, s.level],
            [s.g.hudLayers, s.layerIndex],
            [s.g.hudBudget, Math.max(0, s.budget).toFixed(1) + ' nm'],
            [s.g.hudError, s.totalErr.toFixed(1) + ' nm'],
            [s.t.hudBest, s.best('turningPoint', 0)],
        ],
        onKey: (code, down) => { if (down && (code === 'Space' || code === 'Enter')) press(s); },
        onPointer: (type) => { if (type === 'pointerdown') press(s); },
    };
}
