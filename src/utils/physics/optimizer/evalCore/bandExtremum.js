/**
 * The true extremum of a band-extremum row over its band: the wavelength of
 * the band's maximum or minimum (MXW* / MNW*) and the worst case (TMN..AMX and
 * their dB and density forms).
 *
 * T, 1 − R and A share one denominator, (η0B + C)(η0B + C)* (Macleod,
 * Thin-Film Optical Filters 5th ed., eqs 2.123-2.126, p. 45), which varies only
 * on the fringe scale of the stack (Tikhonravov, Appl. Opt. 32, 5417 (1993)).
 * A narrow peak of T, 1 − R or A is a near-zero of that denominator, and close
 * to one 1/P is nearly a parabola in wavelength. The search therefore runs on
 * g = 1/P for a row that looks for a peak of P (a peak row) and on g = −1/P for
 * one that looks for a dip; both are monotone in the row's quantity.
 *
 * 1. A uniform grid over the band, low end first: the row's own grid, made
 *    finer where the design's fringes are finer than it, to three samples per
 *    fringe (extremumGrid.js). A run fixes the count at launch; elsewhere it
 *    comes from the design being evaluated.
 * 2. Every local minimum of g on the grid gets one evaluation at the vertex of
 *    the parabola through its three samples. Under the polarization average,
 *    off normal incidence or with a cone, so does every local minimum of each
 *    polarization's own g, since an s or a p resonance can hide in the average.
 * 3. Brent's method refines, inside the two cells around it, each minimum whose
 *    vertex value, less twice the parabola's misfit there, could still beat
 *    the best value found.
 * 4. A band end is the extremum unless g still falls just inside it.
 *
 * Two peaks closer than about two steps can read as one; the row's flag sets
 * the step. The extremum found is located to about 1e-6 nm. A sample with no
 * value (a material with no index there) leaves the extremum unknown: NaN.
 */

import { brentMinimum, localMinima, parabola } from '../../../math/lineMinimum.js';
import { coneIsActive } from '../coneAngle.js';
import { extremumRowSpec, extremumBaseLambdas, extremumGridCount, extremumSearchCount } from '../extremumGrid.js';
import { sampleCountOverride } from '../sampling.js';
import { tmmProp } from './tmmEval.js';
import { groupThicknessAt } from './fringeSampling.js';
import { settleConeWavelength } from './coneNodeCount.js';

// Location tolerance of the refinement, nm.
const LOCATE_TOL_NM = 1e-6;
const MAX_REFINE_EVALS = 60;
// How far below its vertex value a minimum may lie, in units of the parabola's
// misfit at the vertex. The misfit at one point understates it elsewhere in
// the two cells; counted once it lost a peak on a 100-layer stack.
const MISFIT_REACH = 2;

// The quantity whose narrow peaks are resonances: T, 1 − R or A.
const peakOf = (char, C) => (char === 'R' ? 1 - C : C);

// The sample count of the search grid: the count a run fixed on the row, or
// the one the design being evaluated needs.
function searchCount(op, ctx) {
    const fixed = sampleCountOverride(op);
    if (fixed != null) return fixed;
    return extremumSearchCount(op, groupThicknessAt(ctx, Math.min(op.lambdaStart, op.lambdaEnd)));
}

const searchGrid = (op, ctx) => extremumBaseLambdas(op, searchCount(op, ctx));

// The row's quantity C at λ. Under a cone the rays at a wavelength the
// evaluation did not settle are settled first, so the value and its derivative
// there average over the rays the cone needs at that wavelength.
function quantityAt(op, ctx, spec) {
    const channels = [{ pol: spec.pol, char: spec.char }];
    const cone = !!ctx.cone && coneIsActive(ctx.cone);
    return lam => {
        if (cone) settleConeWavelength(ctx, op.aoi, lam, channels);
        return tmmProp(lam, op.aoi, spec.pol, spec.char, ctx, ctx.frontThicks, ctx.frontMats);
    };
}

// The materials whose absorption an A row of this context counts: the layers
// light crosses and the medium it comes from on a single surface, everything
// for a full-system merit.
function absorbingCandidates(ctx) {
    const sm = ctx.surfaceMode || 'front_only';
    const full = ctx.evalFullSystem || sm === 'symmetric' || sm === 'both_independent';
    if (full) return [...(ctx.frontMats || []), ...(ctx.backMats || []), ctx.n0mat, ctx.nsmat, ctx.neMat];
    if (sm === 'back_only') return [...(ctx.backMats || []), ctx.neMat];
    return [...(ctx.frontMats || []), ctx.n0mat];
}

// An A row on a stack where nothing it counts absorbs at any grid wavelength
// reads zero everywhere (Macleod eq. 2.126 with Re(BC*) = Re(ηm) through
// lossless layers); what the kernel returns there is rounding.
function isLossless(ctx, lams) {
    const clear = mat => typeof mat?.getNK !== 'function' || lams.every(lam => mat.getNK(lam)[1] === 0);
    return absorbingCandidates(ctx).every(clear);
}

// Brent's method inside [a, b], started from the best point x and the next
// two, w and v, so its first step is the parabola through them.
const refine = (f, a, b, start) => brentMinimum(f, a, b, start, { tol: LOCATE_TOL_NM, maxEvals: MAX_REFINE_EVALS });

// A band end that is a grid minimum: the end itself, unless g still falls one
// probe inside it, in which case the minimum in the end cell.
function refineEnd(search, i) {
    const { lams, gv, gAt } = search;
    const inward = i === 0 ? 1 : -1;
    const j = i + inward;
    const probe = lams[i] + inward * 1e-3 * Math.abs(lams[j] - lams[i]);
    const gp = gAt(probe);
    if (gp >= gv[i]) return null;
    return refine(gAt, Math.min(lams[i], lams[j]), Math.max(lams[i], lams[j]),
        { x: probe, fx: gp, w: lams[i], fw: gv[i], v: lams[j], fv: gv[j] });
}

// One evaluation of the row's g at the vertex of the parabola through samples
// i − 1, i, i + 1 of `gs` (the row's g or one polarization's), with the misfit
// of the row's own parabola there.
function vertexProbe(search, i, gs) {
    const { lams, gv, gAt } = search;
    const own = parabola(lams, gs, i);
    const row = gs === gv ? own : parabola(lams, gv, i);
    const u = own.convex ? own.vertex() : lams[i];
    if (!(u > lams[i - 1] && u < lams[i + 1]) || u === lams[i]) return { i, x: lams[i], g: gv[i], misfit: 0 };
    const gu = gAt(u);
    return { i, u, gu, x: gu < gv[i] ? u : lams[i], g: Math.min(gu, gv[i]), misfit: Math.abs(row.at(u) - gu) };
}

// Brent inside the two cells around a probe, started from its best three
// samples, or null when the best of them is a cell end: no minimum inside.
function refineProbe(search, probe) {
    const { lams, gv, gAt } = search;
    const i = probe.i;
    const pts = [[lams[i - 1], gv[i - 1]], [lams[i], gv[i]], [lams[i + 1], gv[i + 1]]];
    if (probe.u !== undefined) pts.push([probe.u, probe.gu]);
    pts.sort((p, q) => p[1] - q[1]);
    const a = Math.min(lams[i - 1], lams[i + 1]), b = Math.max(lams[i - 1], lams[i + 1]);
    const [x, w, v] = pts;
    if (!(x[0] > a && x[0] < b)) return null;
    return refine(gAt, a, b, { x: x[0], fx: x[1], w: w[0], fw: w[1], v: v[0], fv: v[1] });
}

// Whether s and p differ on the rays a row averages: off normal incidence, or
// on the oblique rays of a cone.
function polarizationsSplit(op, ctx) {
    return Number(op.aoi || 0) !== 0 || (!!ctx.cone && coneIsActive(ctx.cone));
}

// Probes at the row's interior grid minima and, where s and p differ under the
// polarization average, at each polarization's: a narrow s resonance on the
// flank of a broad p one shows in the row's samples only as a shoulder.
function vertexProbes(search, minima, spec, op, ctx) {
    const { lams, g } = search;
    const n = lams.length;
    const interior = i => i > 0 && i < n - 1;
    const out = minima.filter(interior).map(i => vertexProbe(search, i, search.gv));
    if (spec.pol !== 'avg' || !polarizationsSplit(op, ctx)) return out;
    for (const pc of ['s', 'p']) {
        const gp = lams.map(lam => g(tmmProp(lam, op.aoi, pc, spec.char, ctx, ctx.frontThicks, ctx.frontMats)));
        for (const i of localMinima(gp).filter(interior)) out.push(vertexProbe(search, i, gp));
    }
    return out;
}

// The lowest g found: on the grid, at the band ends, and by the probes and
// their refinement, most promising first. { x, g }.
function searchMinimum(search, spec, op, ctx) {
    const { lams, gv } = search;
    let best = { x: lams[0], g: gv[0] };
    const consider = (x, value) => { if (value < best.g) best = { x, g: value }; };
    lams.forEach((lam, i) => consider(lam, gv[i]));
    if (lams.length < 3) return best;
    const minima = localMinima(gv);
    for (const i of [0, lams.length - 1]) {
        const r = minima.includes(i) ? refineEnd(search, i) : null;
        if (r) consider(r.x, r.fx);
    }
    const reach = p => p.g - MISFIT_REACH * p.misfit;
    const probes = vertexProbes(search, minima, spec, op, ctx).sort((p, q) => reach(p) - reach(q));
    for (const p of probes) consider(p.x, p.g);
    for (const p of probes) {
        if (reach(p) > best.g) break;
        const r = refineProbe(search, p);
        if (r) consider(r.x, r.fx);
    }
    return best;
}

/** The step, nm, of the grid the row's search starts from on this design. */
export function extremumSearchStep(op, ctx) {
    const n = extremumGridCount(op, searchCount(op, ctx));
    return n > 1 ? Math.abs(op.lambdaEnd - op.lambdaStart) / (n - 1) : 0;
}

/**
 * The row's extremum over its band: { lambda, C } with C the row's linear
 * quantity (T, R or A) there, or { lambda: NaN, C: NaN } when a sample has no
 * value.
 */
export function findBandExtremum(op, ctx) {
    const spec = extremumRowSpec(op);
    const lams = searchGrid(op, ctx);
    const C = quantityAt(op, ctx, spec);
    if (spec.char === 'A' && isLossless(ctx, lams)) return { lambda: lams[0], C: 0 };
    const sign = spec.peak ? 1 : -1;
    const g = c => sign / Math.max(peakOf(spec.char, c), 1e-300);
    const gAt = lam => g(C(lam));
    const gv = lams.map(gAt);
    if (!gv.every(Number.isFinite)) return { lambda: NaN, C: NaN };
    const best = searchMinimum({ lams, gv, g, gAt }, spec, op, ctx);
    return { lambda: best.x, C: C(best.x) };
}
