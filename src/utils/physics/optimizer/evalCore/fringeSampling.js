/**
 * Band sample counts set by the fringe spacing of the coating being evaluated.
 *
 * The phase thickness of a layer is δ = 2π n d cos θ / λ (Macleod, Thin-Film
 * Optical Filters 5e, §9.2, eq. 9.2), so the round-trip phase through a
 * coherent stack at normal incidence, Σ 4π n_j d_j / λ, advances by 2π over
 *
 *     Δλ = λ² / (2G),   G = Σ_j d_j n_g,j,   n_g = n − λ dn/dλ,
 *
 * which is the period of the stack's fringes in wavelength. The group index
 * n_g enters because n itself falls with λ in a normally dispersive film: the
 * built-in TiO2 has n = 2.77 and n_g = 4.38 at 400 nm. Where n rises with λ
 * (anomalous dispersion, as in metals and absorption bands) the phase index is
 * kept, so the count is never below the one the phase index gives. Oblique
 * incidence only lengthens the period (cos θ < 1), so normal incidence is the
 * densest case, and the period is shortest at the short end of a band.
 *
 * With both faces coated the full-system response multiplies the front and back
 * responses through the incoherent substrate (Macleod §2.6.4), and a product of
 * two oscillating responses carries the sum of their frequencies, so the two
 * coatings' G add.
 *
 * The count is fixed for the length of a run: the worker material tables are
 * sampled on the launch grid, and a grid that followed every thickness change
 * would make the merit function jump between neighbouring grids.
 */

import { fringeSampleCount } from '../operandModel.js';
import { hasBandDensityGrid, sampleCountField, sampleCountOverride } from '../sampling.js';
import { buildEvalContext } from './evalContext.js';

// Central-difference step for dn/dλ, as a fraction of λ.
const DN_DLAMBDA_REL_STEP = 1e-3;

// Group index of one material at λ (nm), never below its phase index.
function groupIndex(mat, lambdaNm) {
    const h = lambdaNm * DN_DLAMBDA_REL_STEP;
    const n = mat.getNK(lambdaNm)[0];
    const dnDl = (mat.getNK(lambdaNm + h)[0] - mat.getNK(lambdaNm - h)[0]) / (2 * h);
    return Math.max(n, n - lambdaNm * dnDl);
}

// Σ d·n_g over one stack (nm). `indexOf` memoizes the group index per material.
function stackGroupThickness(thicks, mats, indexOf) {
    let g = 0;
    for (let i = 0; i < thicks.length; i++) {
        if (thicks[i] > 0) g += thicks[i] * indexOf(mats[i]);
    }
    return g;
}

/**
 * Group optical thickness G (nm) at λ (nm) of the coating an evaluation context
 * scores: the front stack, the back stack, or both summed for a full-system
 * merit, following the same surface-mode rule tmmProp evaluates with.
 */
export function groupThicknessAt(ctx, lambdaNm) {
    const cache = new Map();
    const indexOf = (mat) => {
        let v = cache.get(mat);
        if (v === undefined) { v = groupIndex(mat, lambdaNm); cache.set(mat, v); }
        return v;
    };
    const front = () => stackGroupThickness(ctx.frontThicks || [], ctx.frontMats || [], indexOf);
    const back  = () => stackGroupThickness(ctx.backThicks  || [], ctx.backMats  || [], indexOf);
    const sm = ctx.surfaceMode || 'front_only';
    if (ctx.evalFullSystem || sm === 'symmetric' || sm === 'both_independent') return front() + back();
    return sm === 'back_only' ? back() : front();
}

/**
 * Operands with the sample count of every band average, integral, range target
 * and flatness row set from the fringe spacing of the design in `ctx` (an
 * evaluation context from buildEvalContext). An operand without its own count
 * gets the fringe count, which is below the design-free default on a thin
 * coating. One that carries a count keeps it unless the fringes need more, so
 * the count only grows when this is applied again to a design that has grown.
 * Returns the input array itself when nothing changes.
 */
export function withFringeSampleCounts(operands, ctx) {
    if (!Array.isArray(operands) || operands.length === 0) return operands;
    const gAt = new Map();
    let changed = false;
    const out = operands.map(op => {
        if (!op || op.enabled === false || !hasBandDensityGrid(op.type)) return op;
        const shortEnd = Math.min(op.lambdaStart, op.lambdaEnd ?? op.lambdaStart);
        let g = gAt.get(shortEnd);
        if (g === undefined) { g = groupThicknessAt(ctx, shortEnd); gAt.set(shortEnd, g); }
        const own = sampleCountOverride(op);
        const need = fringeSampleCount(op, g);
        const count = own == null ? need : Math.max(own, need);
        if (count === own) return op;
        changed = true;
        return { ...op, [sampleCountField(op.type)]: count };
    });
    return changed ? out : operands;
}

/**
 * withFringeSampleCounts for a design and material resolver. A design whose
 * materials do not resolve cannot be evaluated at all, so its operands are
 * returned as they are and the evaluation reports the failure itself.
 */
export function withDesignSampleCounts(operands, design, resolveMat) {
    let ctx;
    try { ctx = buildEvalContext(design, resolveMat); } catch { return operands; }
    return withFringeSampleCounts(operands, ctx);
}
