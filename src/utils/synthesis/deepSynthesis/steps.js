// Forced steps of gradual evolution (ge.c 123-197 and 244-260): every layer
// made thicker, and new layers at the gaps, each taken to the next local
// minimum of the merit as its thickness grows.
//
// A step is { k, pos, material }: layer k thickened (pos = -1, material null),
// or a new layer of `material` at gap pos (k = -1).

import { insertLayer } from './design.js';
import { goldenMinimum } from './needleHelpers.js';

export const STEP_PER_WAVE = 32;   // ge.c 146: steps of lambda_min / 32 in optical thickness

// ge.c forced_candidates 249-260: every layer thickened, then new layers in pool
// order, of a material other than both neighbours. New layers go at every gap
// when the design is empty or the pool has more than two materials; otherwise,
// with outer, only at the incident side (gap 0) and the substrate side (gap N),
// which is TFStudio's forced step.
export function forcedSteps(layers, pool, { outer }) {
    const N = layers.length;
    const steps = layers.map((_, k) => ({ k, pos: -1, material: null }));
    const inner = N === 0 || pool.length > 2;
    for (let pos = 0; pos <= N; pos++) {
        if (!inner && !(outer && (pos === 0 || pos === N))) continue;
        for (const material of pool) {
            if (layers[pos - 1]?.material === material || layers[pos]?.material === material) continue;
            steps.push({ k: -1, pos, material });
        }
    }
    return steps;
}

// ge.c place_step 193-197: the step applied at `thickness` nm.
export function placeStep(layers, step, thickness) {
    if (step.k < 0) return insertLayer(layers, step.pos, step.material, thickness);
    return layers.map((l, i) => ({ material: l.material, thickness: i === step.k ? thickness : l.thickness }));
}

// ge.c scan_step 219: a thickened layer starts from its thickness, a new layer
// from the floor (nm).
export function stepStart(ev, layers, step) {
    return step.k >= 0 ? layers[step.k].thickness : ev.floor;
}

// ge.c next_minimum 138-173: from t0, steps of lambda_min / 32 in optical
// thickness until the merit has fallen and turns up again, then golden
// section on the last two steps; the lowest of the step before the rise and
// the two golden points. Thicknesses in nm.
// A deviation from ge.c, which gives no step when the merit does not turn up
// within one wave of optical thickness at the longest wavelength past t0:
// here the step is then the lowest point sampled, so the method also runs on
// a merit that falls over the whole wave, such as a total thickness target of
// more than a wave. When the merit does not turn up within the wave, null
// unless some point sampled is below the start.
export function nextMinimum(ev, layers, step, t0) {
    const material = step.k >= 0 ? layers[step.k].material : step.material;
    const h = ev.lamMin / (STEP_PER_WAVE * ev.n(material, ev.lamMin));
    const tMax = t0 + ev.lamMax / ev.n(material, ev.lamMax);
    const f = t => ev.mf(placeStep(layers, step, t));
    let prev = { t: t0, mf: f(t0) };
    let low = prev;
    let falling = false;
    for (let t = t0 + h; t <= tMax; t += h) {
        const mf = f(t);
        if (mf < prev.mf) falling = true;
        else if (falling) {
            const best = goldenMinimum(f, Math.max(t0, prev.t - h), t, prev);
            return { thickness: best.t, mf: best.mf };
        }
        prev = { t, mf };
        if (mf < low.mf) low = prev;
    }
    return low.t > t0 ? { thickness: low.t, mf: low.mf } : null;
}
