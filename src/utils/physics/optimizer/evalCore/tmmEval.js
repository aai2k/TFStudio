/**
 * Resolves a single-λ optical property through whichever optical model the
 * design's surface mode and merit eval mode demand: front surface only, back
 * surface only, or the full system (front coating, incoherent substrate bulk,
 * back coating). Every optical operand, every viewer and all synthesis funnel
 * through `tmmProp`, so cone-angle averaging and the memoization below apply
 * uniformly. Reference: Macleod, Thin-Film Optical Filters 5e §2.6.4.
 */

import { rtaEval, kernelPol } from './kernels.js';
import { coneIsActive, coneNodes } from '../coneAngle.js';
import {
    nkOf, layersAt, _rtaChar, surfaceModel, substrateAngle, bulkTransmittance, combineFullSystem,
} from './surfaceModel.js';
import { coneAverage } from './coneRays.js';

export { nkOf, distinctMaterials } from './surfaceModel.js';

// ── Per-evaluateOperands memoization ──────────────────────────────────────────
//
// Within one evaluateOperands call the thicknesses and materials are fixed, so
// the full {R,T,A} at a given (λ, aoi, polCode) is invariant across operands.
// Paired R+T operands (every AR/HR/BS/edge generator emits them) otherwise
// each trigger an independent full TMM that discards two-thirds of its result.
// These caches return bit-identical numbers — pure speedup, no math change.

// Cached single-polarization TMM. Keyed on (pass, aoi, λ), where the pass is a
// `tag` distinguishing independent stacks/passes that share those coordinates
// (front forward vs. reverse vs. back in the full-system model) plus the
// polarization. Nested maps keep λ and aoi as numeric keys.
function tmmC(ctx, tag, lam, aoi, polCode, n0, ns, layers) {
    const c = ctx && ctx._tmmCache;
    if (!c) return rtaEval(lam, aoi, polCode, n0, ns, layers);
    const pc = kernelPol(aoi, polCode);
    const pass = tag + pc;
    let byAoi = c.get(pass);
    if (!byAoi) { byAoi = new Map(); c.set(pass, byAoi); }
    let byLam = byAoi.get(aoi);
    if (!byLam) { byLam = new Map(); byAoi.set(aoi, byLam); }
    let v = byLam.get(lam);
    if (v === undefined) { v = rtaEval(lam, aoi, pc, n0, ns, layers); byLam.set(lam, v); }
    return v;
}

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

// Per-polarization full-system R/T/A for one incidence. `s` carries the
// precomputed geometry/indices from tmmFullSystem.
function _fullSystemRTA(polCode, s) {
    const { ctx, lam, aoi, aoiSub, cosTs, n0, ns, ne, fLayers, bLayers } = s;
    const fwd = tmmC(ctx, 'fwd', lam, aoi,    polCode, n0, ns, fLayers);
    const rev = tmmC(ctx, 'rev', lam, aoiSub, polCode, ns, n0, [...fLayers].reverse());
    const bck = tmmC(ctx, 'bck', lam, aoiSub, polCode, ns, ne, bLayers);
    return combineFullSystem(fwd, rev, bck, bulkTransmittance(ctx, lam, ns, cosTs));
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
    const { aoiSub, cosTs } = substrateAngle(aoi, n0, ns);

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
 * Run `fn` with the cone rays of the merit row `op` in force on `ctx`, and
 * return what it returns. Each row averages over a grid of angles of its own,
 * so its value does not depend on which other rows are in the merit function.
 * Rows are told apart by id; a read outside any row has a grid of its own too.
 */
export function inConeRow(ctx, op, fn) {
    const outer = ctx._coneRow;
    ctx._coneRow = op.id;
    try { return fn(); } finally { ctx._coneRow = outer; }
}

/**
 * The cone rays the context holds for one axis in the row in force
 * (inConeRow): `byLambda` maps a wavelength (nm) to the node set settled for
 * it and `countByLambda` to that set's node count (evalCore/coneNodeCount.js),
 * and `nodesFor(count)` returns the node set for a node count, built once per
 * count so wavelengths that settle on the same count share it.
 */
export function coneAxisRays(ctx, aoi) {
    if (!ctx._coneNodeCache) ctx._coneNodeCache = new Map();
    const byAxis = storedAt(ctx._coneNodeCache, ctx._coneRow, () => new Map());
    const axis = coneAxisKey(aoi);
    return storedAt(byAxis, axis, () => {
        const byCount = new Map();
        return {
            byLambda: new Map(),
            countByLambda: new Map(),
            nodesFor: count => storedAt(byCount, count, () => coneNodes(ctx.cone, axis, count)),
        };
    });
}

// The value `map` holds under `key`, made by `make` and stored on first use.
function storedAt(map, key, make) {
    let value = map.get(key);
    if (value === undefined) { value = make(); map.set(key, value); }
    return value;
}

/**
 * The { aoiDeg, weight } nodes the context averages over at wavelength `lam`
 * (nm) for a cone whose axis is at `aoi`, in the row in force (inConeRow).
 * evaluateOperands settles them per row, axis and wavelength before it
 * evaluates, and every value, derivative and needle function read for that
 * row on the same context then uses the same set. A wavelength nothing settled
 * gets the spec's own grid points. No active cone: the single node at `aoi`.
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
// weighted sum over the cone's quadrature nodes (coneNodesAt, coneSum). With no
// cone (the default) this is a single call to tmmPropSingle → bit-identical to
// before.
// Because EVERY optical operand (TGT/TAV/TMN/integral/argwave/…) funnels through
// here, cone averaging applies uniformly to the merit function, every viewer,
// and all synthesis (all T/R/A operands + synthesis).
export function tmmProp(lam, aoi, pol, char, ctx, thicknesses, mats) {
    const cone = ctx.cone;
    if (cone && coneIsActive(cone)) {
        const nodes = coneNodesAt(ctx, aoi, lam);
        if (nodes.length > 1) return coneSum(ctx, lam, nodes, { pol, char, thicknesses, mats });
    }
    return tmmPropSingle(lam, aoi, pol, char, ctx, thicknesses, mats);
}

/**
 * The weighted sum of tmmPropSingle over `nodes` ({ aoiDeg, weight }) at
 * wavelength `lam` (nm) for the read { pol, char, thicknesses, mats }. A mean
 * of s and p takes the rays together (coneRays.js), one kernel call per pass
 * that returns both polarizations. A read of one polarization takes them one
 * at a time, since that call would compute the other polarization for
 * nothing.
 */
export function coneSum(ctx, lam, nodes, read) {
    if (read.pol === 'avg') return coneAverage(ctx, lam, nodes, read);
    let acc = 0;
    for (let i = 0; i < nodes.length; i++) {
        acc += nodes[i].weight *
            tmmPropSingle(lam, nodes[i].aoiDeg, read.pol, read.char, ctx, read.thicknesses, read.mats);
    }
    return acc;
}

/**
 * The property at one angle of incidence `aoi` exactly, never cone-averaged,
 * through the same surface model and caches as tmmProp.
 */
export function tmmPropSingle(lam, aoi, pol, char, ctx, thicknesses, mats) {
    const model = surfaceModel(ctx);
    if (model === 'full') {
        // Full system: front = ctx.frontThicks/Mats, back = ctx.backThicks/Mats.
        // For front_only+total the back stack is the FIXED back coating (or bare
        // substrate if empty); for back_only+total the front is the fixed front.
        return tmmFullSystem(lam, aoi, pol, char, ctx,
            ctx.frontThicks || thicknesses, ctx.frontMats || mats,
            ctx.backThicks || [], ctx.backMats || []);
    }
    if (model === 'back') {
        // Single back-surface model: evalOperand passes ctx.frontThicks/Mats by
        // convention, but in back_only those are inactive — read the back stack
        // directly from ctx so the merit function and SpectralMonitor's "back"
        // mode agree by construction.
        return tmmBackOnly(lam, aoi, pol, char, ctx, ctx.backThicks || [], ctx.backMats || []);
    }
    // front_only, single-surface (legacy default)
    return tmmFrontOnly(lam, aoi, pol, char, ctx, thicknesses, mats);
}
