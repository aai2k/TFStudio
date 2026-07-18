/**
 * Merit-function Z over two design parameters — reuses buildEvalContext +
 * evaluateOperands + calcMF, so it's the SAME MF the optimizer minimizes
 * (the "optimization landscape").
 */

import { buildEvalContext, evaluateOperands, calcMF } from '../optimizer.js';
import { collectLayerOverrides } from './layerOverrides.js';
import { overrideMaterial } from './materialOverride.js';

// In back_only mode axis tokens (thk:i, n:i, k:i) address the back stack.
function overrideBackLayer(evalCtx, backThicks, backMats, i, ov) {
    if (ov.thk != null) backThicks[i] = ov.thk;
    if ((ov.n != null || ov.k != null) && evalCtx.backMats[i]) {
        backMats[i] = overrideMaterial(evalCtx.backMats[i], ov, 550);
    }
}

function overrideFrontLayer(evalCtx, frontThicks, frontMats, i, ov) {
    if (ov.thk != null) frontThicks[i] = ov.thk;
    if (ov.n != null || ov.k != null) {
        frontMats[i] = overrideMaterial(evalCtx.frontMats[i], ov, 550);
    }
}

function applyLayerOverridesForMerit(evalCtx, byLayer, isBackOnly) {
    const frontThicks = evalCtx.frontThicks.slice();
    const frontMats   = evalCtx.frontMats.slice();
    const backThicks  = evalCtx.backThicks  ? evalCtx.backThicks.slice()  : [];
    const backMats    = evalCtx.backMats    ? evalCtx.backMats.slice()    : [];
    for (const key in byLayer) {
        const i = +key, ov = byLayer[key];
        if (isBackOnly) overrideBackLayer(evalCtx, backThicks, backMats, i, ov);
        else            overrideFrontLayer(evalCtx, frontThicks, frontMats, i, ov);
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
function meritSurfaceZ({ spec, evalCtx, operands, xv, yv, optical = false }) {
    const { byLayer } = collectLayerOverrides(spec, xv, yv);
    const isBackOnly = evalCtx.surfaceMode === 'back_only';
    const overrides = applyLayerOverridesForMerit(evalCtx, byLayer, isBackOnly);
    const ctx = buildMeritEvalCtx(evalCtx, overrides, isBackOnly);
    const computed = evaluateOperands(operands, ctx);
    return calcMF(operands, computed, optical ? { skipConstraints: true } : undefined);
}

/**
 * Compute the MF surface over `grid` = {x, y, rowFrom, rowTo, nPoints}.
 * Returns an error result (ok:false) if no merit operands are enabled.
 */
export function computeMeritSurface(spec, design, resolveMat, grid) {
    const { x, y, rowFrom, rowTo, nPoints } = grid;
    const operands = (design.meritOperands || []).filter(op => op && op.enabled);
    if (!operands.length) {
        return { ok: false, error: 'No enabled merit operands. Set up targets in the Merit Function Editor.', x: [], y: [], z: [] };
    }
    const evalCtx = buildEvalContext(design, resolveMat);
    const z = new Array(y.length);
    for (let j = rowFrom; j < rowTo; j++) {
        const row = new Array(x.length);
        for (let i = 0; i < x.length; i++) {
            row[i] = meritSurfaceZ({ spec, evalCtx, operands, xv: x[i], yv: y[j] });
        }
        z[j] = row;
    }
    return { ok: true, x, y, z, zLabel: 'Merit Function', nPoints };
}
