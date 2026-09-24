/**
 * Resolves a single-λ optical property through whichever optical model the
 * design's surface mode and merit eval mode demand: front surface only, back
 * surface only, or the full system (front coating, incoherent substrate bulk,
 * back coating). Every optical operand, every viewer and all synthesis funnel
 * through `tmmProp`, so cone-angle averaging and the memoization below apply
 * uniformly. Reference: Macleod, Thin-Film Optical Filters 5e §2.6.4.
 */

import { tmmOne, kernelPol } from './kernels.js';
import { coneIsActive, coneNodes } from '../coneAngle.js';

// ── Per-evaluateOperands memoization ──────────────────────────────────────────
//
// Within one evaluateOperands call the thicknesses and materials are fixed, so
// the full {R,T,A} at a given (λ, aoi, polCode) is invariant across operands.
// Paired R+T operands (every AR/HR/BS/edge generator emits them) otherwise
// each trigger an independent full TMM that discards two-thirds of its result.
// These caches return bit-identical numbers — pure speedup, no math change.

export function nkOf(ctx, mat, lam) {
    const c = ctx && ctx._nkCache;
    if (!c) return mat.getNK(lam);
    let m = c.get(mat);
    if (!m) { m = new Map(); c.set(mat, m); }
    let v = m.get(lam);
    if (v === undefined) { v = mat.getNK(lam); m.set(lam, v); }
    return v;
}

// The distinct materials of a stack and, per layer, its position among them,
// so the stack's indices at one λ take one lookup per material rather than one
// per layer (an H/L stack has two materials however many layers it has).
export function distinctMaterials(mats) {
    const materials = [];
    const index = new Array(mats.length);
    const at = new Map();
    for (let i = 0; i < mats.length; i++) {
        let k = at.get(mats[i]);
        if (k === undefined) { k = materials.length; materials.push(mats[i]); at.set(mats[i], k); }
        index[i] = k;
    }
    return { materials, index };
}

// Layers {n, d} of one stack at λ. The stack is fixed for one evaluateOperands
// call, so its distinct-material index is built once per call.
function layersAt(ctx, mats, thicknesses, lam) {
    const c = ctx && ctx._stackIndex;
    let di = c && c.get(mats);
    if (!di) {
        di = distinctMaterials(mats);
        if (c) c.set(mats, di);
    }
    const nks = di.materials.map(m => nkOf(ctx, m, lam));
    const layers = new Array(mats.length);
    for (let i = 0; i < mats.length; i++) layers[i] = { n: nks[di.index[i]], d: thicknesses[i] };
    return layers;
}

// Cached single-polarization TMM. Keyed on (pass, aoi, λ), where the pass is a
// `tag` distinguishing independent stacks/passes that share those coordinates
// (front forward vs. reverse vs. back in the full-system model) plus the
// polarization. Nested maps keep λ and aoi as numeric keys.
function tmmC(ctx, tag, lam, aoi, polCode, n0, ns, layers) {
    const c = ctx && ctx._tmmCache;
    if (!c) return tmmOne(lam, aoi, polCode, n0, ns, layers);
    const pc = kernelPol(aoi, polCode);
    const pass = tag + pc;
    let byAoi = c.get(pass);
    if (!byAoi) { byAoi = new Map(); c.set(pass, byAoi); }
    let byLam = byAoi.get(aoi);
    if (!byLam) { byLam = new Map(); byAoi.set(aoi, byLam); }
    let v = byLam.get(lam);
    if (v === undefined) { v = tmmOne(lam, aoi, pc, n0, ns, layers); byLam.set(lam, v); }
    return v;
}

// Select the R/T/A component named by `char` ('T'|'R' → T/R, else A) from a
// {T,R,A} result object.
const _rtaChar = (r, char) => (char === 'T' ? r.T : char === 'R' ? r.R : r.A);

// Front-coating-only TMM evaluation (no back stack, ignores substrate bulk and exit medium).
// Used when ctx.surfaceMode === 'front_only'.
function tmmFrontOnly(lam, aoi, pol, char, ctx, thicknesses, mats) {
    const n0     = nkOf(ctx, ctx.n0mat, lam);
    const ns     = nkOf(ctx, ctx.nsmat, lam);
    const layers = layersAt(ctx, mats, thicknesses, lam);

    if (pol === 'avg') {
        const s = tmmC(ctx, 'f', lam, aoi, 's', n0, ns, layers);
        const p = tmmC(ctx, 'f', lam, aoi, 'p', n0, ns, layers);
        return (_rtaChar(s, char) + _rtaChar(p, char)) * 0.5;
    }
    return _rtaChar(tmmC(ctx, 'f', lam, aoi, pol, n0, ns, layers), char);
}

// Back-coating-only TMM evaluation — symmetric to tmmFrontOnly. Single surface
// from the back: light incident from the EXIT medium, semi-infinite substrate,
// front coating ignored. backLayers are stored substrate→exit, so they are
// reversed here so the per-layer TMM sees them in exit→substrate (incident →
// substrate) order, matching evaluateSpectrumBack in thinFilmMath.js (which is
// what the SpectralMonitor's "back" mode displays). Used when
// ctx.surfaceMode === 'back_only'.
function tmmBackOnly(lam, aoi, pol, char, ctx, thicknesses, mats) {
    const n0     = nkOf(ctx, ctx.neMat || ctx.n0mat, lam);
    const ns     = nkOf(ctx, ctx.nsmat, lam);
    const layers = layersAt(ctx, mats, thicknesses, lam).reverse();

    if (pol === 'avg') {
        const s = tmmC(ctx, 'b', lam, aoi, 's', n0, ns, layers);
        const p = tmmC(ctx, 'b', lam, aoi, 'p', n0, ns, layers);
        return (_rtaChar(s, char) + _rtaChar(p, char)) * 0.5;
    }
    return _rtaChar(tmmC(ctx, 'b', lam, aoi, pol, n0, ns, layers), char);
}

// Per-polarization full-system R/T/A for one incidence: coherent front and back
// coatings joined by an incoherent (intensity-summed) substrate bulk pass P.
// `s` carries the precomputed geometry/indices from tmmFullSystem.
function _fullSystemRTA(polCode, s) {
    const { ctx, lam, aoi, aoiSub, cosTs, n0, ns, ne, fLayers, bLayers } = s;
    // forward pass:   incident → front → substrate
    const fwd = tmmC(ctx, 'fwd', lam, aoi,    polCode, n0, ns, fLayers);
    // reverse pass:  substrate → front_reversed → incident   (R_f', T_f')
    const rev = tmmC(ctx, 'rev', lam, aoiSub, polCode, ns, n0, [...fLayers].reverse());
    // back coating from substrate side:  substrate → back → exit
    const bck = tmmC(ctx, 'bck', lam, aoiSub, polCode, ns, ne, bLayers);

    // Substrate bulk transmittance per pass: P = exp(−4π k d / (λ cosθ_sub))
    const k_sub    = ns[1];
    const d_sub_nm = (ctx.substrateThicknessMm || 1.0) * 1e6;
    const P = (k_sub > 0 && cosTs > 0)
        ? Math.exp(-4 * Math.PI * k_sub * d_sub_nm / (lam * cosTs))
        : 1.0;
    const P2 = P * P;

    const denom = 1 - rev.R * bck.R * P2;
    const T = denom > 0 ? (fwd.T * P * bck.T) / denom : 0;
    const R = denom > 0 ? fwd.R + (fwd.T * rev.T * P2 * bck.R) / denom : 1;
    const A = Math.max(0, 1 - R - T);
    return { R, T, A };
}

// Full-system R/T/A combining front coating + (incoherent) substrate bulk + back coating.
// Reference: Macleod §2.6.4 "Substrate with thin films on both sides".
//   T = T_f · P · T_b / (1 − R_f' · R_b · P²)
//   R = R_f + T_f · T_f' · P² · R_b / (1 − R_f' · R_b · P²)
// Substrate is treated as optically thick (incoherent intensity sum).
export function tmmFullSystem(lam, aoi, pol, char, ctx, frontThicks, frontMats, backThicks, backMats) {
    const n0 = nkOf(ctx, ctx.n0mat, lam);
    const ns = nkOf(ctx, ctx.nsmat, lam);
    const ne = nkOf(ctx, (ctx.neMat || ctx.n0mat), lam);

    const fLayers = layersAt(ctx, frontMats, frontThicks, lam).filter(l => l.d > 0);
    const bLayers = layersAt(ctx, backMats,  backThicks,  lam).filter(l => l.d > 0);

    // Angle inside substrate via real-part Snell's law
    const sinT0  = Math.sin(aoi * Math.PI / 180);
    const sinTs  = (ns[0] > 0) ? Math.min(1, n0[0] * sinT0 / ns[0]) : 0;
    const cosTs  = Math.sqrt(1 - sinTs * sinTs);
    const aoiSub = Math.asin(sinTs) * 180 / Math.PI;

    const s = { ctx, lam, aoi, aoiSub, cosTs, n0, ns, ne, fLayers, bLayers };

    if (pol === 'avg') {
        const rs = _fullSystemRTA('s', s);
        const rp = _fullSystemRTA('p', s);
        return (_rtaChar(rs, char) + _rtaChar(rp, char)) * 0.5;
    }
    return _rtaChar(_fullSystemRTA(pol, s), char);
}

// Does this (surfaceMode, mfEvalMode) pair score the merit function against the
// FULL system (front + substrate + back) rather than a single surface?
//   symmetric / both_independent → always full system (two-sided by definition)
//   front_only / back_only       → full system iff the user picked 'total'
//                                   (mfEvalMode='total'); 'side' (default) keeps
//                                   the legacy single-surface evaluation.
// This DECOUPLES "which layers are optimized" (surfaceMode) from "how the MF is
// scored" (mfEvalMode): you can optimize only the front yet judge it against the
// whole filter including a fixed back coating.
export function isFullSystemEval(surfaceMode, mfEvalMode) {
    if (surfaceMode === 'symmetric' || surfaceMode === 'both_independent') return true;
    return mfEvalMode === 'total';
}

// Single source of truth for "which spectrum is the physical answer" — derived
// purely from the design's surfaceMode + mfEvalMode. Every viewer / analysis
// window (Optical Evaluation, Color, Error Analysis, …) reads THIS instead of an
// independently-toggled local mode, so what you see, what specs score, and what
// tolerances perturb can never disagree.
//   front_only + side  → 'front'   (front coating on semi-infinite substrate)
//   back_only  + side  → 'back'    (back coating on semi-infinite substrate)
//   anything full-system → 'total' (front + substrate + back, incoherent series)
export function resolveEvalMode(design) {
    const sm = design?.surfaceMode || 'front_only';
    const me = design?.mfEvalMode  || 'side';
    if (isFullSystemEval(sm, me)) return 'total';
    return sm === 'back_only' ? 'back' : 'front';
}

// Key a cone axis is cached under on the evaluation context.
export const coneAxisKey = aoi => Number(aoi) || 0;

/**
 * The cone rays the context holds for one axis: `byLambda` maps a wavelength
 * (nm) to the node set settled for it and `countByLambda` to that set's node
 * count (evalCore/coneNodeCount.js), and `nodesFor(count)` returns the node set
 * for a node count, built once per count so wavelengths that settle on the
 * same count share it.
 */
export function coneAxisRays(ctx, aoi) {
    if (!ctx._coneNodeCache) ctx._coneNodeCache = new Map();
    const axis = coneAxisKey(aoi);
    let rays = ctx._coneNodeCache.get(axis);
    if (!rays) {
        const byCount = new Map();
        rays = {
            byLambda: new Map(),
            countByLambda: new Map(),
            nodesFor(count) {
                let nodes = byCount.get(count);
                if (!nodes) { nodes = coneNodes(ctx.cone, axis, count); byCount.set(count, nodes); }
                return nodes;
            },
        };
        ctx._coneNodeCache.set(axis, rays);
    }
    return rays;
}

/**
 * The { aoiDeg, weight } nodes the context averages over at wavelength `lam`
 * (nm) for a cone whose axis is at `aoi`. evaluateOperands settles them per
 * axis and wavelength before it evaluates, and every value, derivative and
 * needle function read on the same context then uses the same set. A
 * wavelength nothing settled gets the spec's own grid points. No active cone:
 * the single node at `aoi`.
 */
export function coneNodesAt(ctx, aoi, lam) {
    const cone = ctx && ctx.cone;
    if (!(cone && coneIsActive(cone))) return [{ aoiDeg: aoi, weight: 1 }];
    const rays = coneAxisRays(ctx, aoi);
    return rays.byLambda.get(lam) || rays.nodesFor(cone.gridPoints);
}

// Resolve a single-λ optical property through whichever model the surface mode
// + eval mode demand, AVERAGED over the illumination cone when one is active.
//
// Cone-angle averaging wraps the single-angle evaluation: when
// ctx.cone is active, `aoi` is treated as the cone AXIS and the property is the
// weighted sum over the cone's quadrature nodes (coneNodesAt). With no cone (the
// default) this is a single call to tmmPropSingle → bit-identical to before.
// Because EVERY optical operand (TGT/TAV/TMN/integral/argwave/…) funnels through
// here, cone averaging applies uniformly to the merit function, every viewer,
// and all synthesis (all T/R/A operands + synthesis).
export function tmmProp(lam, aoi, pol, char, ctx, thicknesses, mats) {
    const cone = ctx.cone;
    if (cone && coneIsActive(cone)) {
        const nodes = coneNodesAt(ctx, aoi, lam);
        if (nodes.length > 1) {
            let acc = 0;
            for (let i = 0; i < nodes.length; i++) {
                acc += nodes[i].weight *
                    tmmPropSingle(lam, nodes[i].aoiDeg, pol, char, ctx, thicknesses, mats);
            }
            return acc;
        }
    }
    return tmmPropSingle(lam, aoi, pol, char, ctx, thicknesses, mats);
}

/**
 * The property at one angle of incidence `aoi` exactly, never cone-averaged,
 * through the same surface model and caches as tmmProp.
 */
export function tmmPropSingle(lam, aoi, pol, char, ctx, thicknesses, mats) {
    const sm = ctx.surfaceMode || 'front_only';
    const fullSystem = ctx.evalFullSystem
        || sm === 'symmetric' || sm === 'both_independent';
    if (fullSystem) {
        // Full system: front = ctx.frontThicks/Mats, back = ctx.backThicks/Mats.
        // For front_only+total the back stack is the FIXED back coating (or bare
        // substrate if empty); for back_only+total the front is the fixed front.
        return tmmFullSystem(lam, aoi, pol, char, ctx,
            ctx.frontThicks || thicknesses, ctx.frontMats || mats,
            ctx.backThicks || [], ctx.backMats || []);
    }
    if (sm === 'back_only') {
        // Single back-surface model: evalOperand passes ctx.frontThicks/Mats by
        // convention, but in back_only those are inactive — read the back stack
        // directly from ctx so the merit function and SpectralMonitor's "back"
        // mode agree by construction.
        return tmmBackOnly(lam, aoi, pol, char, ctx, ctx.backThicks || [], ctx.backMats || []);
    }
    // front_only, single-surface (legacy default)
    return tmmFrontOnly(lam, aoi, pol, char, ctx, thicknesses, mats);
}
