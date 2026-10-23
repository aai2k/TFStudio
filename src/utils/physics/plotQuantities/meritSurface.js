/**
 * Merit-function Z over two design parameters — reuses buildEvalContext +
 * evaluateOperands + calcMF, so it's the SAME MF the optimizer minimizes
 * (the "optimization landscape").
 */

import { buildEvalContext, evaluateOperands, calcMF, withFringeSampleCounts } from '../optimizer.js';
import { collectLayerOverrides } from './layerOverrides.js';
import { overrideMaterial, overrideReference } from './materialOverride.js';

// In back_only mode axis tokens (thk:i, n:i, k:i) address the back stack.
// `backMats` and `frontMats` are copies of the design's stacks, each layer
// overridden once, so layer i still holds the design's own material.
function overrideBackLayer(backThicks, backMats, i, ov, refLambda) {
    if (ov.thk != null) backThicks[i] = ov.thk;
    if ((ov.n != null || ov.k != null) && backMats[i]) {
        backMats[i] = overrideMaterial(backMats[i], ov, refLambda);
    }
}

function overrideFrontLayer(frontThicks, frontMats, i, ov, refLambda) {
    if (ov.thk != null) frontThicks[i] = ov.thk;
    if (ov.n != null || ov.k != null) {
        frontMats[i] = overrideMaterial(frontMats[i], ov, refLambda);
    }
}

function applyLayerOverridesForMerit(evalCtx, byLayer, isBackOnly, refLambda) {
    const frontThicks = evalCtx.frontThicks.slice();
    const frontMats   = evalCtx.frontMats.slice();
    const backThicks  = evalCtx.backThicks  ? evalCtx.backThicks.slice()  : [];
    const backMats    = evalCtx.backMats    ? evalCtx.backMats.slice()    : [];
    for (const key in byLayer) {
        const i = +key, ov = byLayer[key];
        if (isBackOnly) overrideBackLayer(backThicks, backMats, i, ov, refLambda);
        else            overrideFrontLayer(frontThicks, frontMats, i, ov, refLambda);
    }
    return { frontThicks, frontMats, backThicks, backMats };
}

function buildMeritEvalCtx(evalCtx, overrides, isBackOnly) {
    const { frontThicks, frontMats, backThicks, backMats } = overrides;
    const ctx = { ...evalCtx, frontThicks, frontMats, backThicks, backMats };
    if (evalCtx.surfaceMode === 'symmetric') {
        ctx.backThicks = [...frontThicks].reverse();
        ctx.backMats   = [...frontMats].reverse();
    }
    ctx.fullThicks = evalCtx.surfaceMode === 'both_independent'
        ? [...frontThicks, ...backThicks]
        : isBackOnly ? backThicks : frontThicks;
    return ctx;
}

// `optical=true` plots the OMF (excludes MNT/MXT/TT thickness constraints).
function meritSurfaceZ({ spec, evalCtx, operands, refLambda, xv, yv, optical = false }) {
    const { byLayer } = collectLayerOverrides(spec, xv, yv);
    const isBackOnly = evalCtx.surfaceMode === 'back_only';
    const overrides = applyLayerOverridesForMerit(evalCtx, byLayer, isBackOnly, refLambda);
    const ctx = buildMeritEvalCtx(evalCtx, overrides, isBackOnly);
    const computed = evaluateOperands(operands, ctx);
    return calcMF(operands, computed, optical ? { skipConstraints: true } : undefined);
}

/**
 * Compute the MF surface over `grid` = {x, y, rowFrom, rowTo, nPoints}.
 * Returns an error result (ok:false, errorKey) if no merit operands are enabled.
 *
 * Band operands are sampled for the design's fringes, as the Merit Function
 * Editor samples them, and on that one grid across the whole surface, as a run
 * launched from the design keeps it, so the surface at the design's own
 * parameters reads the editor's MF.
 */
export function computeMeritSurface(spec, design, resolveMat, grid) {
    const { x, y, rowFrom, rowTo, nPoints } = grid;
    const enabled = (design.meritOperands || []).filter(op => op && op.enabled);
    if (!enabled.length) {
        return { ok: false, errorKey: 'errNoOperands', x: [], y: [], z: [] };
    }
    const evalCtx = buildEvalContext(design, resolveMat);
    const operands = withFringeSampleCounts(enabled, evalCtx);
    const refLambda = overrideReference(design);
    const z = new Array(y.length);
    for (let j = rowFrom; j < rowTo; j++) {
        const row = new Array(x.length);
        for (let i = 0; i < x.length; i++) {
            row[i] = meritSurfaceZ({ spec, evalCtx, operands, refLambda, xv: x[i], yv: y[j] });
        }
        z[j] = row;
    }
    return { ok: true, x, y, z, zKey: 'MF', nPoints };
}
