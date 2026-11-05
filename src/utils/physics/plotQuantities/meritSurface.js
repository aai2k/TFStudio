/**
 * Merit-function Z over two design parameters — reuses buildEvalContext +
 * evaluateOperands + calcMF, so it's the SAME MF the optimizer minimizes
 * (the "optimization landscape").
 */

import { buildEvalContext, evaluateOperands, calcMF, withFringeSampleCounts } from '../optimizer.js';
import { collectLayerOverrides, overridesFrom } from './layerOverrides.js';

// In back_only mode axis tokens (thk:i) address the back stack. The thickness
// lists are copies, so the design's own stay as they are.
function applyLayerOverridesForMerit(evalCtx, byLayer, isBackOnly) {
    const frontThicks = evalCtx.frontThicks.slice();
    const backThicks  = evalCtx.backThicks  ? evalCtx.backThicks.slice()  : [];
    const thicks = isBackOnly ? backThicks : frontThicks;
    for (const key in byLayer) {
        if (byLayer[key].thk != null) thicks[+key] = byLayer[key].thk;
    }
    return { frontThicks, backThicks };
}

function buildMeritEvalCtx(evalCtx, overrides, isBackOnly) {
    const { frontThicks, backThicks } = overrides;
    const ctx = { ...evalCtx, frontThicks, backThicks, backMats: evalCtx.backMats || [] };
    if (evalCtx.surfaceMode === 'symmetric') {
        ctx.backThicks = [...frontThicks].reverse();
        ctx.backMats   = [...evalCtx.frontMats].reverse();
    }
    ctx.fullThicks = evalCtx.surfaceMode === 'both_independent'
        ? [...frontThicks, ...backThicks]
        : isBackOnly ? backThicks : frontThicks;
    return ctx;
}

// The MF with the layer overrides `byLayer` applied. `optical=true` gives the
// OMF (excludes MNT/MXT/TT thickness constraints).
function meritAt({ evalCtx, operands, byLayer, optical = false }) {
    const isBackOnly = evalCtx.surfaceMode === 'back_only';
    const overrides = applyLayerOverridesForMerit(evalCtx, byLayer, isBackOnly);
    const ctx = buildMeritEvalCtx(evalCtx, overrides, isBackOnly);
    const computed = evaluateOperands(operands, ctx);
    return calcMF(operands, computed, optical ? { skipConstraints: true } : undefined);
}

// What every point of an MF surface or curve shares, or null when no merit
// operand is enabled. Band operands are sampled for the design's fringes, as
// the Merit Function Editor samples them, and on that one grid at every point,
// as a run launched from the design keeps it, so a point at the design's own
// parameters reads the editor's MF.
function meritSetup(design, resolveMat) {
    const enabled = (design.meritOperands || []).filter(op => op && op.enabled);
    if (!enabled.length) return null;
    const evalCtx = buildEvalContext(design, resolveMat);
    return { evalCtx, operands: withFringeSampleCounts(enabled, evalCtx) };
}

/**
 * Compute the MF surface over `grid` = {x, y, rowFrom, rowTo, nPoints}.
 * Returns an error result (ok:false, errorKey) if no merit operands are enabled.
 */
export function computeMeritSurface(spec, design, resolveMat, grid) {
    const { x, y, rowFrom, rowTo, nPoints } = grid;
    const setup = meritSetup(design, resolveMat);
    if (!setup) {
        return { ok: false, errorKey: 'errNoOperands', x: [], y: [], z: [] };
    }
    const z = new Array(y.length);
    for (let j = rowFrom; j < rowTo; j++) {
        const row = new Array(x.length);
        for (let i = 0; i < x.length; i++) {
            row[i] = meritAt({ ...setup, byLayer: collectLayerOverrides(spec, x[i], y[j]).byLayer });
        }
        z[j] = row;
    }
    return { ok: true, x, y, z, zKey: 'MF', nPoints };
}

/**
 * The MF along one layer thickness, `sweep` a layer token (axisVars.js), at
 * each of `values`: the points an MF surface over that thickness reads. Returns
 * an error result (ok:false, errorKey) if no merit operands are enabled.
 */
export function computeMeritCurve(sweep, values, design, resolveMat) {
    const setup = meritSetup(design, resolveMat);
    if (!setup) return { ok: false, errorKey: 'errNoOperands', mf: [] };
    const mf = values.map(value => meritAt({ ...setup, byLayer: overridesFrom([[sweep, value]]).byLayer }));
    return { ok: true, mf };
}
