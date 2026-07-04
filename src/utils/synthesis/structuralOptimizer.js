/**
 * Structural optimizer — random structural perturbation + simulated annealing.
 *
 * This is the PURE, side-effect-free core of TFStudio's "Structural
 * Optimizer". It is *distinct* from needle / gradual-evolution synthesis (which
 * only ever GROW a stack one layer at a time, guided by the analytic P-function)
 * and from fixed-layer-count multi-start thickness perturbation (already
 * covered by Refinement's `dls-multi` / SA / DE engines).
 *
 * Instead it randomly mutates the layer *structure* — add / remove / split /
 * merge a layer, or jitter thicknesses — and accepts or rejects each mutation
 * (after a local refinement, run by the caller) with a Metropolis criterion.
 * This lets the design escape *structural* local minima that fixed-N refinement
 * and monotone needle growth cannot.
 *
 * References:
 *   - H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §9 (synthesis vs.
 *     refinement; cites simulated annealing & random structural search as global
 *     methods that reduce starting-design dependence).
 *   - S. Kirkpatrick, C. D. Gelatt, M. P. Vecchi, "Optimization by Simulated
 *     Annealing", *Science* 220, 671 (1983) — the Metropolis accept rule.
 *   - A. V. Tikhonravov & M. K. Trubetskov, *Appl. Opt.* 51, 7319 (2012) —
 *     stochastic optimization with layer-thickness constraints (context).
 *
 * DESIGN NOTES
 * ------------
 * • Everything here is deterministic given an injected RNG (`makeRng(seed)`):
 *   layer ids, material picks, fractions and accept rolls all draw from it. This
 *   keeps the engine unit-testable (see tests/structural_optimizer.mjs).
 * • Mutations operate on ONE side's layer array (the surface-mode "active"
 *   side); the window component handles symmetric mirroring and the worker
 *   refinement. Locked layers are NEVER moved, merged, split or removed; their
 *   thickness is never perturbed.
 * • The Metropolis criterion is **scale-invariant**: the merit function's
 *   absolute magnitude varies by orders of magnitude between problems
 *   (~40× scale differences observed), so acceptance uses the *relative*
 *   worsening (mfNew−mfOld)/|mfOld| against a dimensionless temperature. T0≈0.1
 *   therefore means the same thing on every design.
 */

import { cleanupLayers } from '../physics/optimizer/layerOps.js';

// ── Seedable RNG (mulberry32) ───────────────────────────────────────────────────
// Small, fast, well-distributed 32-bit PRNG. Deterministic for a given seed so
// tests are reproducible; the window seeds it from Date.now() at run start.
export function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function rng() {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const MUTATION_KINDS = ['add', 'remove', 'split', 'merge', 'perturb'];

// Default relative selection weights for the mutation kinds. Growth/diversity
// ops (add/split) and the cheap thickness jitter are favored slightly over the
// shrink ops (remove/merge), so a run trends toward exploring richer structures
// while still being able to prune. Callers can override.
export const DEFAULT_MUTATION_WEIGHTS = {
    add: 1.0, split: 1.0, perturb: 1.0, remove: 0.7, merge: 0.7,
};

// ── Numeric helpers ─────────────────────────────────────────────────────────────

export function clampThickness(t, dMin, dMax) {
    if (!Number.isFinite(t)) return dMin;
    return Math.min(dMax, Math.max(dMin, t));
}

function mkId(rng) {
    return 'm' + Math.floor(rng() * 0xFFFFFFFF).toString(36) + Math.floor(rng() * 0xFFFF).toString(36);
}

function pickIndexWeighted(rng, weights) {
    const sum = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
    if (!(sum > 0)) return Math.floor(rng() * weights.length);
    let r = rng() * sum;
    for (let i = 0; i < weights.length; i++) {
        r -= (weights[i] > 0 ? weights[i] : 0);
        if (r <= 0) return i;
    }
    return weights.length - 1;
}

function unlockedIndices(layers) {
    const out = [];
    for (let i = 0; i < layers.length; i++) if (!layers[i].locked) out.push(i);
    return out;
}

// Pick a pool material, preferring one whose id differs from `avoidIds` (the
// neighbour materials) so the mutation actually introduces an optical contrast.
// Falls back to any pool material if every candidate is in `avoidIds`.
function pickMaterial(rng, pool, avoidIds = []) {
    if (!pool.length) return null;
    const avoid = new Set(avoidIds.filter(Boolean));
    const pref = pool.filter(p => !avoid.has(p.id));
    const from = pref.length ? pref : pool;
    return from[Math.floor(rng() * from.length)];
}

// ── Mutation operators (pure: layers → { layers, mutation }) ─────────────────────
// Each returns null when it is not applicable to the given stack.

function opAdd(layers, ctx) {
    const { rng, pool, dMin, dMax, addMaxNm } = ctx;
    if (!pool.length) return null;
    const pos = Math.floor(rng() * (layers.length + 1));
    const neigh = [layers[pos - 1]?.material, layers[pos]?.material];
    const mat = pickMaterial(rng, pool, neigh);
    if (!mat) return null;
    const thickness = clampThickness(dMin + rng() * Math.max(0, addMaxNm - dMin), dMin, dMax);
    const layer = { id: mkId(rng), material: mat.id, thickness, locked: false };
    const out = [...layers.slice(0, pos), layer, ...layers.slice(pos)];
    return { layers: out, mutation: { kind: 'add', pos, materialId: mat.id, insertMat: mat.id, thickness } };
}

function opRemove(layers, ctx) {
    const { rng, dMin } = ctx;
    const idx = unlockedIndices(layers);
    if (idx.length === 0) return null;
    // Weight toward removing thinner layers (cheapest structural simplification).
    const weights = idx.map(i => 1 / ((layers[i].thickness || 0) + dMin));
    const pick = idx[pickIndexWeighted(rng, weights)];
    const removed = layers[pick];
    const out = [...layers.slice(0, pick), ...layers.slice(pick + 1)];
    return { layers: out, mutation: { kind: 'remove', pos: pick, materialId: removed.material, thickness: removed.thickness } };
}

function opSplit(layers, ctx) {
    const { rng, pool, dMin, dMax, addMaxNm } = ctx;
    if (!pool.length) return null;
    // Need an unlocked layer thick enough that both halves clear dMin.
    const idx = unlockedIndices(layers).filter(i => (layers[i].thickness || 0) >= 2 * dMin);
    if (idx.length === 0) return null;
    const host = layers[idx[Math.floor(rng() * idx.length)]];
    const i = layers.indexOf(host);
    const dk = host.thickness || 0;
    const frac = 0.3 + 0.4 * rng();                       // split point 30–70 %
    const d1 = clampThickness(frac * dk, dMin, dMax);
    const d2 = clampThickness((1 - frac) * dk, dMin, dMax);
    const mat = pickMaterial(rng, pool, [host.material]);
    const insThk = clampThickness(dMin + rng() * Math.min(addMaxNm, dk * 0.5), dMin, dMax);
    const part1  = { ...host, id: mkId(rng), thickness: d1 };
    const needle = { id: mkId(rng), material: mat.id, thickness: insThk, locked: false };
    const part2  = { ...host, id: mkId(rng), thickness: d2 };
    const out = [...layers.slice(0, i), part1, needle, part2, ...layers.slice(i + 1)];
    return { layers: out, mutation: { kind: 'split', pos: i, materialId: mat.id, insertMat: mat.id, thickness: insThk } };
}

function opMerge(layers, ctx) {
    const { rng, dMin, dMax } = ctx;
    // Adjacent unlocked pairs.
    const pairs = [];
    for (let i = 0; i < layers.length - 1; i++) {
        if (!layers[i].locked && !layers[i + 1].locked) pairs.push(i);
    }
    if (pairs.length === 0) return null;
    const i = pairs[Math.floor(rng() * pairs.length)];
    const a = layers[i], b = layers[i + 1];
    // Keep the thicker layer's material; sum the thicknesses.
    const keepMat = (a.thickness || 0) >= (b.thickness || 0) ? a.material : b.material;
    const thickness = clampThickness((a.thickness || 0) + (b.thickness || 0), dMin, dMax);
    const merged = { id: mkId(rng), material: keepMat, thickness, locked: false };
    const out = [...layers.slice(0, i), merged, ...layers.slice(i + 2)];
    return { layers: out, mutation: { kind: 'merge', pos: i, materialId: keepMat, thickness } };
}

function opPerturb(layers, ctx) {
    const { rng, dMin, dMax, jitterPct } = ctx;
    if (unlockedIndices(layers).length === 0) return null;
    const out = layers.map(l => {
        if (l.locked) return { ...l };
        const f = 1 + jitterPct * (2 * rng() - 1);
        return { ...l, thickness: clampThickness((l.thickness || 0) * f, dMin, dMax) };
    });
    return { layers: out, mutation: { kind: 'perturb', jitterPct } };
}

const OPS = { add: opAdd, remove: opRemove, split: opSplit, merge: opMerge, perturb: opPerturb };

/**
 * Propose a single random structural mutation of `layers`.
 *
 * @param {Array}  layers  active-side layer array (each { id, material, thickness, locked })
 * @param {object} ctx
 *   - rng        : () => [0,1)         injected PRNG (required)
 *   - pool       : [{ id, name }]      candidate materials for add/split (required for those)
 *   - dMin,dMax  : thickness bounds, nm (default 1, 2000)
 *   - addMaxNm   : max thickness of an added/inserted layer, nm (default 120)
 *   - jitterPct  : perturb fraction (default 0.15)
 *   - kinds      : enabled mutation kinds (default all five)
 *   - weights    : { kind: number } relative selection weights
 * @returns {{ layers, mutation } | null}  null if no enabled mutation applies
 */
export function proposeMutation(layers, ctx) {
    const cfg = {
        dMin: 1, dMax: 2000, addMaxNm: 120, jitterPct: 0.15,
        kinds: MUTATION_KINDS, weights: DEFAULT_MUTATION_WEIGHTS,
        ...ctx,
    };
    const { rng } = cfg;
    const enabled = (cfg.kinds || MUTATION_KINDS).filter(k => OPS[k]);
    // Try kinds in a weighted-random order until one produces a result; this way
    // an inapplicable pick (e.g. merge on a single-layer stack) falls through to
    // another kind instead of wasting a generation.
    const remaining = enabled.slice();
    while (remaining.length) {
        const w = remaining.map(k => cfg.weights[k] ?? 1);
        const pickPos = pickIndexWeighted(rng, w);
        const kind = remaining.splice(pickPos, 1)[0];
        const res = OPS[kind](layers, cfg);
        if (res) return res;
    }
    return null;
}

// ── Simulated-annealing accept rule ──────────────────────────────────────────────

/**
 * Metropolis acceptance, scale-invariant in the merit function.
 *
 * A strictly-or-equal improvement is always accepted. A worsening move is
 * accepted with probability exp(−relΔ / T), where relΔ = (mfNew−mfOld)/|mfOld|
 * is the *relative* increase in merit. Using a relative Δ makes T dimensionless
 * and comparable across designs whose absolute MF differs by orders of magnitude.
 *
 * @param {number} mfOld  current merit
 * @param {number} mfNew  candidate merit (after refinement)
 * @param {number} T      dimensionless temperature (>0)
 * @param {function} rng  () => [0,1)
 */
export function metropolisAccept(mfOld, mfNew, T, rng) {
    if (!Number.isFinite(mfNew)) return false;   // NaN/Inf candidate → always reject
    if (!(mfNew > mfOld)) return true;          // equal or better → always accept
    if (!(T > 0)) return false;                 // frozen → reject all uphill moves
    const denom = Math.max(Math.abs(mfOld), 1e-12);
    const relWorse = (mfNew - mfOld) / denom;
    const p = Math.exp(-relWorse / T);
    return rng() < p;
}

/**
 * Geometric cooling schedule: T0 at frac=0 → Tend at frac=1.
 * @param {number} frac  progress in [0,1] (iteration / maxIterations)
 */
export function temperatureAt(frac, T0, Tend) {
    const f = Math.min(1, Math.max(0, frac));
    if (!(T0 > 0)) return 0;
    const end = Math.max(Tend, 1e-9);
    return T0 * Math.pow(end / T0, f);
}

// ── Deep / exhaustive search policy ───────────────────────────────────
// The single-shot search cools `temperatureAt(it/maxIter)` once and quits on
// `maxIter` or a patience early-stop. "Deep" mode instead runs an Iterated Local
// Search / Basin Hopping loop: keep a global best, and on stagnation *reheat and
// kick* instead of finalizing, looping until the user Stops (or a wallclock
// bound). These three pure helpers carry the policy so the run loop in the window
// stays thin and the behavior is unit-testable without React/workers.

/**
 * Temperature inside ONE cooling cycle of a reheat loop. Identical to a geometric
 * `temperatureAt` over [0, coolPeriod]: it returns T0 at cycleIter=0 and decays to
 * Tend by cycleIter≥coolPeriod, so each reheat (cycleIter reset to 0) restores the
 * full annealing temperature. In single-shot mode the caller just uses
 * `temperatureAt(it/maxIter, …)` directly; this is the deep-mode replacement.
 *
 * @param {number} cycleIter  iterations elapsed since the last reheat (≥0)
 * @param {number} coolPeriod iterations per cool-down cycle (>0)
 * @param {number} T0         start temperature of the cycle
 * @param {number} Tend       floor temperature at the end of the cycle
 */
export function deepTemperature(cycleIter, coolPeriod, T0, Tend) {
    const period = coolPeriod > 0 ? coolPeriod : 1;
    return temperatureAt(cycleIter / period, T0, Tend);
}

/**
 * What to do when no NEW global best has appeared for `noImprove` iterations.
 *   - 'continue' : still within patience — keep searching.
 *   - 'stop'     : single-shot mode has stagnated → finalize (best kept).
 *   - 'reheat'   : deep mode has stagnated → basin-hop (raise T, kick from best).
 *
 * @param {object} o
 *   - deepMode  : boolean — open-ended reheat loop vs single-shot
 *   - noImprove : iterations since the last new best
 *   - patience  : stagnation threshold
 */
export function stagnationAction({ deepMode, noImprove, patience }) {
    if (noImprove < patience) return 'continue';
    return deepMode ? 'reheat' : 'stop';
}

/**
 * Basin-hopping kick: apply a few amplified structural mutations to `layers` to
 * jump out of the current local basin, used on reheat in deep mode. Growth/shape
 * ops come from the enabled `kinds`; the thickness jitter is amplified (×3, capped
 * at 60 %) so the kick is a genuine escape, not a nudge. Pure given `rng`; locked
 * layers are preserved by the underlying operators. Returns a NEW layer array
 * (falls back to a shallow copy if no mutation applied).
 *
 * @param {Array}  layers
 * @param {object} ctx  same fields as proposeMutation, plus optional
 *   - maxKick : max number of stacked mutations (default 3; actual = 1..maxKick)
 */
export function basinKick(layers, ctx) {
    const { rng } = ctx;
    const maxKick = Math.max(1, ctx.maxKick || 3);
    const jitter = Math.min(0.6, (ctx.jitterPct ?? 0.15) * 3);
    const n = 1 + Math.floor(rng() * maxKick);
    let work = layers.map(l => ({ ...l }));
    let applied = 0;
    for (let i = 0; i < n; i++) {
        const res = proposeMutation(work, { ...ctx, jitterPct: jitter });
        if (res) { work = res.layers; applied++; }
    }
    return applied ? work : layers.map(l => ({ ...l }));
}

// ── Convenience: normalize/clean a proposed stack ────────────────────────────────
// After a mutation the caller refines then prunes; this mirrors the needle/GE
// post-step cleanup (merge same-material neighbours, drop sub-dMin layers) so a
// structural proposal handed straight to display/refine is already tidy. Pure
// re-export of the validated cleanupLayers with the engine's dMin default.
export function tidyLayers(layers, dMin = 1) {
    return cleanupLayers(layers, dMin);
}
