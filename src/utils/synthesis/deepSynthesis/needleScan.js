// The needle scan of the deep synthesis (needle.c scan, local_minima,
// keep_best): the needle function over a window of layers and its local
// minima along the depth.
//
// Positions (needle.c 26-34): every gap between layers and both outer
// interfaces, and points inside every layer spaced lambda_min / 32 in optical
// thickness at the densest pool material. A needle of the host's material, or
// of a neighbour's material at a gap, only changes a thickness and is not a
// candidate; a split must leave both parts of the host at least the floor.
//
// P is TFStudio's analytic needle function, dMF/dd per nm of new layer; for
// operands the analytic scan declines, the finite-difference scan with at
// most FD_INTRA_MAX points per layer.

import { scanNeedlesAnalytic, scanNeedlesFD } from '../../physics/optimizer/scanners.js';

export const MAX_CANDIDATES = 64;      // needle.c 459 MAXC, giga4.c 284
export const INTRA_PER_WAVE = 32;      // needle.c 206: points lambda_min / 32 apart in optical thickness
export const INTRA_MIN = 3;            // needle.c 207
export const INTRA_MAX = 8192;         // needle.c 208
export const FD_INTRA_MAX = 16;        // cap on the finite-difference scan, which costs one merit per point
export const NEEDLE_TINY = 1e-12;      // needle.c 218: P above -tiny * mf0 is rounding

// needle.c grid_scale 135-141: real index of the densest pool material at the
// shortest wavelength, at least 1.
function densestIndex(ev) {
    let nMax = 1;
    for (const id of ev.pool) {
        const n = ev.n(id, ev.lamMin);
        if (n > nMax) nMax = n;
    }
    return nMax;
}

// needle.c scan 203-209: points inside each layer. The thickest layer sets the
// spacing, of the window with fit and of the whole design otherwise; none on an
// empty design, or with fit when a split (two more layers) has no room.
export function intraCount(ev, layers, { k0 = 0, k1 = layers.length, fit = false, room = 2 } = {}) {
    if (layers.length === 0 || (fit && room < 2)) return 0;
    const nMax = densestIndex(ev);
    const span = fit ? layers.slice(k0, k1) : layers;
    let optMax = 0;
    for (const l of span) optMax = Math.max(optMax, nMax * l.thickness);
    const n = Math.ceil(optMax / (ev.lamMin / INTRA_PER_WAVE));
    return Math.min(INTRA_MAX, Math.max(INTRA_MIN, n));
}

// One scan of the whole design with nIntra points per layer. Returns the
// scanner's { candidates, mf0 } and the points per layer it used.
function runScan(ev, layers, nIntra) {
    const args = {
        operands: ev.operands, design: ev.designOf(layers), resolveMat: ev.resolveMat,
        candidateMats: ev.candidateMats, deltaNm: 0.5, side: ev.side, dMin: ev.floor, nIntra,
    };
    const analytic = scanNeedlesAnalytic(args);
    if (analytic) return { ...analytic, nIntra };
    const fdIntra = Math.min(nIntra, FD_INTRA_MAX);
    return { ...scanNeedlesFD({ ...args, nIntra: fdIntra }), nIntra: fdIntra };
}

// Depth index of a scanner candidate: gap k at k * (nIntra + 1), the r-th point
// inside layer k (r = 1..nIntra, frac r / (nIntra + 1)) at k * (nIntra + 1) + r.
function depthIndex(c, nIntra) {
    if (!c.intra) return c.pos * (nIntra + 1);
    return c.layerK * (nIntra + 1) + Math.round(c.frac * (nIntra + 1));
}

// needle.c scan 221-228: gaps k0..k1 whose material differs from both
// neighbours, splits of layers k0..k1-1 by another material. The floor rule on
// split halves is the scanner's (dMin).
function allowed(layers, c, k0, k1) {
    if (c.intra) return c.layerK >= k0 && c.layerK < k1 && layers[c.layerK].material !== c.materialId;
    if (c.pos < k0 || c.pos > k1) return false;
    return layers[c.pos - 1]?.material !== c.materialId && layers[c.pos]?.material !== c.materialId;
}

// P per pool material along the depth, +Infinity where not allowed.
function depthTable(ev, layers, scan, { k0, k1 }) {
    const M = (layers.length + 1) + layers.length * scan.nIntra;
    const table = new Map(ev.pool.map(id => [id, new Float64Array(M).fill(Infinity)]));
    for (const c of scan.candidates) {
        const row = table.get(c.materialId);
        if (row && allowed(layers, c, k0, k1)) row[depthIndex(c, scan.nIntra)] = c.grad;
    }
    return table;
}

function candAt(i, nIntra, material, P) {
    const k = Math.floor(i / (nIntra + 1)), r = i % (nIntra + 1);
    if (r === 0) return { pos: k, layer: -1, frac: 0, material, P };
    return { pos: -1, layer: k, frac: r / (nIntra + 1), material, P };
}

// Depth indices 0..M-1 with the gaps first, then the points inside layers.
function gapsThenSplits(M, nIntra) {
    const all = Array.from({ length: M }, (_, i) => i);
    const isGap = i => i % (nIntra + 1) === 0;
    return all.filter(isGap).concat(all.filter(i => !isGap(i)));
}

// needle.c scan 232-244: the allowed positions below -tiny, gaps first (by gap,
// then pool order), then splits (by layer, point, pool order).
function belowTiny(pool, table, nIntra, tiny) {
    const M = table.get(pool[0])?.length ?? 0;
    const out = [];
    for (const i of gapsThenSplits(M, nIntra))
        for (const id of pool) {
            const P = table.get(id)[i];
            if (P < -tiny) out.push(candAt(i, nIntra, id, P));
        }
    return out;
}

// needle.c keep_best 143-148: the most negative P first, ties in listed order.
function bestFirst(cands, max) {
    const byP = (a, b) => ((a.c.P > b.c.P) - (a.c.P < b.c.P)) || a.i - b.i;
    return cands.map((c, i) => ({ c, i })).sort(byP).slice(0, Math.max(0, max)).map(e => e.c);
}

// needle.c local_minima 154-185 on synthetic values: depth index i in
// 0..M-1, M = (nLayers + 1) + nLayers * nIntra, runs gap 0, the nIntra points
// inside layer 0, gap 1, ..., gap nLayers. value(material, i) is P there,
// +Infinity where no needle may go. A position is kept when P < -tiny, lower
// than the position above it and no higher than the one below. Output in
// material order, then depth order.
export function depthMinima({ materials, nLayers, nIntra, value, tiny }) {
    const M = (nLayers + 1) + nLayers * nIntra;
    const out = [];
    for (const material of materials) {
        const v = Array.from({ length: M }, (_, i) => value(material, i));
        for (let i = 0; i < M; i++) if (isDepthMinimum(v, i, tiny)) out.push(candAt(i, nIntra, material, v[i]));
    }
    return out;
}

function isDepthMinimum(v, i, tiny) {
    if (!(v[i] < -tiny)) return false;
    if (i > 0 && !(v[i] < v[i - 1])) return false;
    return i + 1 >= v.length || v[i] <= v[i + 1];
}

// needle.c scan 197-259 (needle_scan_range, needle_scan_fit): the needle
// candidates at positions in the window [k0, k1], the most negative P first,
// at most `max`. With fit the design has `room` more layers: none without a
// scan when room < 1, only gaps when room < 2. With minima, only the local
// minima of P along the depth, positions outside the window counting as
// +Infinity.
export function scanWindow(ev, layers, opts = {}) {
    const { k0 = 0, k1 = layers.length, fit = false, room = 2, minima = false, max = MAX_CANDIDATES } = opts;
    if (fit && room < 1) return [];
    const scan = runScan(ev, layers, intraCount(ev, layers, { k0, k1, fit, room }));
    const table = depthTable(ev, layers, scan, { k0, k1 });
    const tiny = NEEDLE_TINY * scan.mf0;
    const cands = minima
        ? depthMinima({ materials: ev.pool, nLayers: layers.length, nIntra: scan.nIntra,
            value: (id, i) => table.get(id)[i], tiny })
        : belowTiny(ev.pool, table, scan.nIntra, tiny);
    return bestFirst(cands, max);
}
