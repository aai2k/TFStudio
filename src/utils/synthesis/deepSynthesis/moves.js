// The search's moves (giga4.c 81-94, 203-371, 425-437, 686-730): a destroy
// operator changes the incumbent in a window of layers, the destroyed design
// is refined, and a repair rebuilds the window.
//
// Destroys: melt (the window becomes one layer of the same optical thickness),
// drop (one layer loses a half wave at a pass point), floor (layers held at
// the floor deleted), half (one layer gains a half wave at a pass point) and
// copy (the window copied after itself). Repairs: carve (probe needles inside
// the window), pair (floor-thick layers around a spacer at the best needle
// minimum) and refine (the destroyed design refined, nothing more).
//
// Moves are drawn on the calling thread (drawMove, the only function here
// that reads the random generator); a child runs in a worker (runChild) and
// draws nothing, so its result is a pure function of its item.

import { insertLayer, normalize, opticalThickness, mergedCount } from './design.js';
import { SPACERS, applyPair, pairOpts, probeStep, scanWindow } from './needleHelpers.js';
import { halfWave } from './points.js';

export const DESTROYS = Object.freeze(['melt', 'drop', 'floor', 'half', 'copy']);   // giga4.c 81-83
export const REPAIRS = Object.freeze(['carve', 'pair', 'refine']);
export const FRAC = 0.3;              // giga4.c 499: window of up to ceil(0.3 N) layers
export const TRIES = 3;               // giga4.c 494: carve's candidates per scan
export const MAX_FLOOR_DELETIONS = 3; // giga4.c 704: floor deletes 1 to 3 held layers

const D_DROP = DESTROYS.indexOf('drop');
const D_COPY = DESTROYS.indexOf('copy');

// ── Drawing a move ───────────────────────────────────────────────────────────

// giga4.c roulette 425-437: an operator drawn with probability in proportion
// to its weight among those allowed; -1 when none is. Always one draw.
export function roulette(rng, weights, ok) {
    let s = 0;
    weights.forEach((w, i) => { if (ok[i]) s += w; });
    let u = rng() * s;
    let last = -1;
    for (let i = 0; i < weights.length; i++) {
        if (!ok[i]) continue;
        last = i;
        if (u < weights[i]) return i;
        u -= weights[i];
    }
    return last;
}

const drawIndex = (rng, n) => Math.floor(rng() * n);

// giga4.c 690-695: the widest window, the widest copy that fits under the cap,
// and the destroys the incumbent allows (melt, drop, floor, half, copy).
function moveBounds({ ev, layers, thick, bound, pass }) {
    const n = layers.length;
    const wmax = Math.min(Math.max(Math.ceil(FRAC * n), 1), n);
    const wcopy = Math.min(wmax, ev.maxLayers - n);
    const okDestroy = [n > 0, thick.length > 0, bound.length > 0, n > 0 && pass.length > 0, wcopy >= 2];
    return { wmax, wcopy, okDestroy };
}

// giga4.c 702-703: a pool index; a one-layer melt does not keep the layer's
// own material.
function drawMaterial(rng, { ev, layers }, m) {
    const mat = drawIndex(rng, ev.pool.length);
    const same = m.w === 1 && layers.length > 0 && ev.pool[mat] === layers[m.k0].material;
    return same ? (mat + 1) % ev.pool.length : mat;
}

// giga4.c 698-707: every field drawn, in the C's order, whatever the destroy;
// the pass point only when there are pass points.
function drawFields(rng, ctx, bounds) {
    const { layers, bound, pass, weights, okRepair } = ctx;
    const m = { destroy: roulette(rng, weights.destroy, bounds.okDestroy) };
    m.repair = roulette(rng, weights.repair, okRepair);
    m.w = 1 + drawIndex(rng, bounds.wmax);
    m.k0 = drawIndex(rng, layers.length - m.w + 1);
    m.mat = drawMaterial(rng, ctx, m);
    m.count = 1 + drawIndex(rng, Math.min(bound.length, MAX_FLOOR_DELETIONS));
    m.layer = m.k0 + drawIndex(rng, m.w);
    m.point = pass.length > 0 ? pass[drawIndex(rng, pass.length)] : -1;
    m.spacer = SPACERS[drawIndex(rng, SPACERS.length)];
    return m;
}

// giga4.c 708-720: a layer that can drop a half wave, a pass point where it
// can, and the window placed around the layer.
function placeDrop(rng, { ev, layers, thick, points, pass }, m) {
    m.layer = thick[drawIndex(rng, thick.length)];
    const can = pass.filter(i => canDrop(ev, layers, m.layer, points[i]));
    m.point = can[drawIndex(rng, can.length)];
    m.k0 = Math.min(Math.max(m.layer - drawIndex(rng, m.w), 0), layers.length - m.w);
}

// giga4.c 721-728: a window of 2 to wcopy layers, one shorter when its ends are
// of one material, so the copy does not merge with the window.
function placeCopy(rng, { layers }, m, wcopy) {
    m.w = 2 + drawIndex(rng, wcopy - 1);
    m.k0 = drawIndex(rng, layers.length - m.w + 1);
    if (layers[m.k0].material === layers[m.k0 + m.w - 1].material) m.w--;
}

// giga4.c 686-730: one child's move from the incumbent, or null when no
// destroy is allowed. ctx: { ev, layers (the incumbent), bound (floorHeld),
// thick (dropLayers), points, pass (indices of the pass points), weights:
// { destroy, repair }, okRepair }; the pool and the layer cap are ev's.
export function drawMove(rng, ctx) {
    const bounds = moveBounds(ctx);
    const m = drawFields(rng, ctx, bounds);
    if (m.destroy === D_DROP) placeDrop(rng, ctx, m);
    if (m.destroy === D_COPY) placeCopy(rng, ctx, m, bounds.wcopy);
    return m.destroy >= 0 ? m : null;
}

// giga4.c can_drop 221-224: layer k can lose a half wave at the point and keep
// at least the floor, with some thickness left.
export function canDrop(ev, layers, k, point) {
    const d = layers[k].thickness - halfWave(ev, layers[k].material, point);
    return d >= ev.floor && d > 0;
}

// giga4.c drop_layers 228-234: the layers that can drop a half wave at one of
// the pass points, in order. pass: indices into points.
export function dropLayers(ev, layers, points, pass) {
    return layers.map((_, k) => k).filter(k => pass.some(i => canDrop(ev, layers, k, points[i])));
}

// ── Destroys (giga4.c destroy 238-278) ───────────────────────────────────────

const copyLayers = layers => layers.map(l => ({ material: l.material, thickness: l.thickness }));

function shiftLayer(layers, k, dt) {
    const out = copyLayers(layers);
    out[k].thickness += dt;
    return out;
}

// The window becomes one layer of pool material m.mat with the window's
// optical thickness at the reference wavelength, at least the floor; the repair
// works on that layer, merged with a neighbour of its material.
function melt(ev, layers, m) {
    const material = ev.pool[m.mat];
    const opt = opticalThickness(ev.nRef, layers.slice(m.k0, m.k0 + m.w));
    const rest = layers.filter((_, k) => k < m.k0 || k >= m.k0 + m.w);
    const T = insertLayer(rest, m.k0, material, Math.max(opt / ev.nRef(material), ev.floor));
    const at = m.k0 > 0 && T[m.k0 - 1].material === material ? m.k0 - 1 : m.k0;
    return { layers: normalize(T), k0: at, k1: at + 1 };
}

// Drop and half: the drawn layer loses or gains a half wave at the pass point,
// which keeps T and R there; the repair works in the drawn window.
function drop(ev, layers, m, { points }) {
    const hw = halfWave(ev, layers[m.layer].material, points[m.point]);
    return { layers: shiftLayer(layers, m.layer, -hw), k0: m.k0, k1: m.k0 + m.w };
}

function half(ev, layers, m, { points }) {
    const hw = halfWave(ev, layers[m.layer].material, points[m.point]);
    return { layers: shiftLayer(layers, m.layer, hw), k0: m.k0, k1: m.k0 + m.w };
}

// The first m.count layers held at the floor deleted (marked by index into the
// incumbent, then dropped); the repair works on the whole design.
function floorDelete(ev, layers, m, { bound }) {
    const gone = new Set(bound.slice(0, m.count));
    const T = normalize(layers.map((l, k) => ({ material: l.material, thickness: gone.has(k) ? 0 : l.thickness })));
    return { layers: T, k0: 0, k1: T.length };
}

// The window copied right after itself; the repair works in both.
function copyWindow(ev, layers, m) {
    const end = m.k0 + m.w;
    const T = normalize([...layers.slice(0, end), ...layers.slice(m.k0, end), ...layers.slice(end)]);
    return { layers: T, k0: m.k0, k1: m.k0 + 2 * m.w };
}

const DESTROY_FNS = [melt, drop, floorDelete, half, copyWindow];

// giga4.c destroy 238-278: the destroyed design and the window [k0, k1) the
// repair works in. bound: floorHeld of the incumbent; points: the run's points.
export function destroy(ev, layers, move, { bound, points }) {
    return DESTROY_FNS[move.destroy](ev, layers, move, { bound, points });
}

// ── Repairs ──────────────────────────────────────────────────────────────────

// giga4.c 291-292, 324-325: without a floor, refinement can delete layers and
// shorten the window.
function clampWindow(n, k0, k1) {
    const hi = Math.min(k1, n);
    return { k0: Math.min(k0, hi), k1: hi };
}

// giga4.c carve 283-316: probe needles in [k0, k1), the best TRIES of each scan
// tried in order, the first that lowers the merit kept, until none does. With
// fit only insertions that fit under the layer cap are scanned.
export function carve(ev, layers, mf, { k0, k1, fit }) {
    let cur = { layers, mf };
    let win = { k0, k1 };
    for (;;) {
        win = clampWindow(cur.layers.length, win.k0, win.k1);
        const room = ev.maxLayers - cur.layers.length;
        const cands = scanWindow(ev, cur.layers, { ...win, fit, room, max: TRIES });
        const next = probeStep(ev, cur.layers, cur.mf, { cands, cap: ev.maxLayers });
        if (!next) return cur;
        win = { k0: win.k0, k1: win.k1 + next.layers.length - cur.layers.length };
        cur = next;
    }
}

// giga4.c pair 322-339: a floor-thick pair around a spacer of `spacer` floors
// at the lowest needle minimum in [k0, k1), refined; with fit only where the
// pair (two layers more than the needle) fits under the cap. mf Infinity with
// the design unchanged when there is no minimum or no room.
export function pair(ev, layers, { k0, k1, spacer, fit }) {
    const n = layers.length;
    const room = ev.maxLayers - n - 2;
    const [cand] = scanWindow(ev, layers, { ...clampWindow(n, k0, k1), fit, room, max: 1, minima: true });
    const paired = cand ? applyPair(layers, cand, spacer * ev.floor, pairOpts(ev)) : null;
    if (!paired || paired.length > ev.maxLayers) return { layers, mf: Infinity };
    const r = ev.refine(paired);
    return { layers: r.layers, mf: r.mf };
}

const REPAIR_FNS = {
    carve: (ev, held, item) => carve(ev, held.layers, held.mf, item),
    pair: (ev, held, item) => pair(ev, held.layers, item),
    refine: (ev, held) => held,
};

// giga4.c 105-108 and 354: with fit, a pair child whose destroyed design has
// more than maxLayers - 3 layers once merged has no room for a pair after a
// refinement, which keeps the layer count under a floor.
const pairWithoutRoom = (ev, item) => item.kind === 'pair' && item.fit && mergedCount(item.dst) > ev.maxLayers - 3;

// giga4.c child 343-371 (the worker body of a search child). item: { kind:
// 'carve' | 'pair' | 'refine', dst, k0, k1, spacer (floors), pre: the
// destroyed design already refined ({ layers, mf }) or null, fit }. The
// destroyed design refined, or pre, then repaired. Returns the child's design,
// its merit (Infinity for no move or a design over the cap) and ref, the
// refinement of dst when this child made it (null otherwise).
export function runChild(ev, item) {
    if (pairWithoutRoom(ev, item)) return { layers: item.dst, mf: Infinity, ref: null };
    const ref = item.pre ? null : ev.refine(item.dst);
    const start = item.pre ?? { layers: ref.layers, mf: ref.mf };
    const out = REPAIR_FNS[item.kind](ev, start, item);
    const mf = out.layers.length <= ev.maxLayers ? out.mf : Infinity;
    return { layers: out.layers, mf, ref: ref && { layers: ref.layers, mf: ref.mf } };
}
