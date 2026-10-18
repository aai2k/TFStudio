// Multi-start restarts: each restart perturbs the start design's free
// thicknesses from a random stream of its own, drawn from the run seed.

import { makeRng } from '../optimizers/base.js';
import { mirrorLayers } from '../physics/optimizer.js';

// The random stream of multi-start restart `restart` in a run seeded with
// `seed`. Each restart has a stream of its own, so it draws the same
// perturbation whichever worker takes it and in whatever order.
export function restartRng(seed, restart) {
    return makeRng((seed + Math.imul(restart, 0x9E3779B9)) >>> 0);
}

// Randomly scale each unlocked thickness by a factor in [1 − f, 1 + f], f a
// fraction, for a multi-start restart, drawing from `rng`. The range is
// relative to each layer, so a thick layer stays thick; only the optimizer's
// 1 nm floor applies.
export function jitterLayers(arr, f, rng) {
    const D_MIN = 1.0;
    return (arr || []).map(l => {
        if (l.locked) return { ...l };
        const tt = (l.thickness || 0) * (1 + f * (rng() * 2 - 1));
        return { ...l, thickness: Math.max(D_MIN, tt) };
    });
}

// Perturb a payload's optimization-variable thicknesses (surface-mode aware),
// for multi-start restarts, drawing from `rng`. restart 0 = unperturbed.
export function perturbPayload(payload, pct, restart, rng) {
    if (restart === 0) return payload;
    const f = Math.max(0, pct) / 100;
    const sm = payload.surfaceMode;
    if (sm === 'both_independent') return { ...payload, frontLayers: jitterLayers(payload.frontLayers, f, rng), backLayers: jitterLayers(payload.backLayers, f, rng) };
    if (sm === 'back_only')        return { ...payload, backLayers: jitterLayers(payload.backLayers, f, rng) };
    if (sm === 'symmetric')        { const fr = jitterLayers(payload.frontLayers, f, rng); return { ...payload, frontLayers: fr, backLayers: mirrorLayers(fr) }; }
    return { ...payload, frontLayers: jitterLayers(payload.frontLayers, f, rng) };
}
