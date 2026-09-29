// Needle insertion of the deep synthesis (needle.c needle_apply,
// best_thickness, deep_candidate, needle_pair_apply; giga4.c floor_bound): a
// needle inserted at a set or at its best thickness, the floor-thick pair, and
// the layers held at the floor.
//
// Insertions act on Layers and split exactly, as design.c does: TFStudio's
// insertNeedle and insertNeedleIntra act on a whole design, draw layer ids at
// random and hold split halves at 1e-3 nm.

import { insertLayer, splitLayer } from './design.js';

export const MIN_NEW_NM = 1e-3;        // needle.c 102: a new layer thinner than this is no layer, nm
export const HELD_TOL = 1e-9;          // giga4.c 415, needle.c 441: at the floor when d <= floor * (1 + HELD_TOL)
export const GOLDEN = 0.6180339887498949;      // needle.c 293, ge.c 156
export const LINE_REL = 1e-3;          // needle.c 296, ge.c 160: bracket width to stop at, relative
export const LINE_ABS = 1e-6;          // the same, nm
export const SPACERS = Object.freeze([1, 1.5, 2]);   // needle.c 430, giga4.c 516: pair spacers, in floors

// needle.c needle_apply 127-131: the candidate inserted `thickness` nm thick.
export function applyNeedle(layers, cand, thickness) {
    if (cand.layer >= 0) return splitLayer(layers, cand.layer, { frac: cand.frac, material: cand.material, thickness });
    return insertLayer(layers, cand.pos, cand.material, thickness);
}

// needle.c spacer_material 368-371: the host inside a layer; at a gap the
// layer on the substrate side, or at the substrate the layer above. The lab's
// index 0 faces the incident medium, so the substrate side of gap pos is
// layer pos; with substrateAt0 (a back side stack, index 0 at the substrate)
// it is layer pos - 1, and the substrate end is gap 0.
function spacerMaterial(layers, cand, substrateAt0) {
    if (cand.layer >= 0) return layers[cand.layer].material;
    const k = substrateAt0 ? cand.pos - 1 : cand.pos;
    return layers[Math.min(Math.max(k, 0), layers.length - 1)].material;
}

// needle.c needle_pair_apply 373-378: at the candidate's site a floor-thick
// (floorNm) layer of its material, a spacer of spacerNm, another floor-thick
// layer of its material. null on an empty design, which has no spacer
// material (the lab never pairs there: joint_step 436).
export function applyPair(layers, cand, spacerNm, { floorNm, substrateAt0 = false }) {
    if (layers.length === 0) return null;
    const at = cand.layer >= 0 ? cand.layer + 1 : cand.pos;
    const withNeedle = applyNeedle(layers, cand, floorNm);
    const withSpacer = insertLayer(withNeedle, at + 1, spacerMaterial(layers, cand, substrateAt0), spacerNm);
    return insertLayer(withSpacer, at + 2, cand.material, floorNm);
}

// applyPair's options for a run: the floor, and whether the run's Layers
// start at the substrate (the back side, in backLayers order).
export function pairOpts(ev) {
    return { floorNm: ev.floor, substrateAt0: ev.side === 'back' };
}

// giga4.c floor_bound 408-422: the layers held at the floor, the largest
// dMF/dd first (the one the merit most wants thinner), ties to the lower index.
export function floorHeld(ev, layers) {
    if (!(ev.floor > 0) || layers.length === 0) return [];
    const g = ev.grad(layers);
    const limit = ev.floor * (1 + HELD_TOL);
    const held = [];
    layers.forEach((l, k) => { if (!(l.thickness > limit)) held.push(k); });
    return held.sort((a, b) => ((g[a] < g[b]) - (g[a] > g[b])) || a - b);
}

// needle.c thickness_cap 320-324: one wave of optical thickness at the longest
// wavelength, nm, beyond which a single layer only repeats itself.
export function thicknessCap(ev, material) {
    return ev.lamMax / ev.n(material, ev.lamMax);
}

// Golden section of f on [lo, hi] down to LINE_REL relative and LINE_ABS nm;
// returns the lowest of `best` ({ t, mf }) and the last two points
// (needle.c best_thickness 292-301, ge.c next_minimum 155-166).
export function goldenMinimum(f, lo, hi, best) {
    let a = lo, c = hi;
    let x1 = c - GOLDEN * (c - a), x2 = a + GOLDEN * (c - a);
    let f1 = f(x1), f2 = f(x2);
    while (c - a > LINE_REL * 0.5 * (x1 + x2) + LINE_ABS) {
        if (f1 < f2) { c = x2; x2 = x1; f2 = f1; x1 = c - GOLDEN * (c - a); f1 = f(x1); }
        else { a = x1; x1 = x2; f1 = f2; x2 = a + GOLDEN * (c - a); f2 = f(x2); }
    }
    let out = best;
    if (f1 < out.mf) out = { t: x1, mf: f1 };
    if (f2 < out.mf) out = { t: x2, mf: f2 };
    return out;
}

// needle.c 274-280: the floor, or with no floor 1 nm halved until the layer
// lowers the merit below mf0 (null when none down to minNew does).
function firstTrial(f, { lo, hi, minNew, mf0 }) {
    let t = lo > 0 ? lo : Math.min(1, hi);
    let mf = f(t);
    if (lo > 0) return { t, mf };
    while (!(mf < mf0) && t > minNew) { t *= 0.5; mf = f(t); }
    return mf < mf0 ? { t, mf } : null;
}

// needle.c 281-289: doubling from the first trial until the merit rises, so
// the minimum lies in [a, c.t]; b is the lowest point so far.
function bracketUp(f, first, lo, hi) {
    let a = lo, b = first;
    let c = { t: Math.min(2 * b.t, hi) };
    c.mf = f(c.t);
    while (c.mf < b.mf && c.t < hi) {
        a = b.t;
        b = c;
        const t = Math.min(2 * c.t, hi);
        c = { t, mf: f(t) };
    }
    return { a, b, c };
}

// needle.c best_thickness 270-307: the thickness in [lo, hi] (nm) of the new
// layer that minimizes the merit. { thickness, mf }, or null when no thickness
// tried lowers the merit below mf0.
export function bestThickness(ev, layers, cand, { lo, hi, minNew = MIN_NEW_NM, mf0 }) {
    const f = t => ev.mf(applyNeedle(layers, cand, t));
    const first = firstTrial(f, { lo, hi, minNew, mf0 });
    if (!first) return null;
    const { a, b, c } = bracketUp(f, first, lo, hi);
    const best = c.mf < b.mf ? c : goldenMinimum(f, a, c.t, b);
    return best.mf < mf0 ? { thickness: best.t, mf: best.mf } : null;
}

// needle.c deep_candidate 338-352 (insert=optimal): the candidate at its best
// thickness between the floor and one wave; when none lowers the merit and
// there is a floor, at the floor, since candidates are judged after
// refinement. null when no thickness is left.
export function insertOptimal(ev, layers, cand, mf0) {
    const lo = ev.floor > 0 ? ev.floor : 0;
    const best = bestThickness(ev, layers, cand, { lo, hi: thicknessCap(ev, cand.material), minNew: MIN_NEW_NM, mf0 });
    const thickness = best ? best.thickness : (ev.floor > 0 ? ev.floor : 0);
    return thickness > 0 ? applyNeedle(layers, cand, thickness) : null;
}
