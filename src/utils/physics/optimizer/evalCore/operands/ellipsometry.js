/**
 * Ellipsometric operands: Ψ, Δ, tan Ψ and cos Δ of the front stack, their exact
 * thickness derivatives, and the per-context batching that lets every point
 * expanded from a measured block share one kernel pass.
 */

import { computeEllipsometry, evaluateEllipsometrySpectrum, evaluateEllipsometryThicknessJacobian } from '../../../thinFilmMath.js';
import { nkOf } from '../tmmEval.js';
import { _assertFrontEllipsometry } from './errors.js';
import { _frontStackAt } from './stack.js';

// The per-context memo tables the ellipsometry paths share. Created on demand
// because the Jacobian assembles on a context evaluateOperands was not run on
// (it is handed a precomputed comp vector instead), and reset there so a reused
// context object can never serve a stale batch.
const ELLIPSOMETRY_CACHES = ['_ellipsometryBatches', '_ellipsometryJacobians', '_blockGrids'];

// Clear every ellipsometry memo. Kept beside the list it clears so a cache
// added here cannot be left out of the reset.
export function resetEllipsometryCaches(ctx) {
    for (const name of ELLIPSOMETRY_CACHES) ctx[name] = new Map();
}

// A point expanded from a measured block reads the block's batched pass, which
// its siblings share.
function _measuredBlockPoint(op, ctx) {
    const grid = _blockGrid(op, ctx, null);
    if (!grid) return null;
    return _ellipsometryBatch(ctx, op.aoi ?? 0, grid.lambdas, grid.key).get(op.lambdaStart) || null;
}

function _ellipsometryCache(ctx, name) {
    let cache = ctx[name];
    if (!cache) {
        cache = new Map();
        ctx[name] = cache;
    }
    return cache;
}

// A batch is memoized under its angle and wavelength list, so two blocks on
// the same grid, the Ψ half and the Δ half of one measurement, run one kernel
// pass between them.
export function _gridKey(aoi, lambdas) {
    return `${aoi}|${lambdas.join(',')}`;
}

// The grid of the measured block a point was expanded from, with its key,
// gathered once per context so a 500-point block does not rebuild a 500-number
// key once per point. `operands` is the list a Jacobian is being assembled
// for; an evaluation passes none and the context's own operand index is used.
// Both hold the same siblings, so both give the same grid. Null for a
// hand-typed operand, and where neither source of siblings is at hand.
export function _blockGrid(op, ctx, operands) {
    const blockId = op.measuredCurveBlockId;
    if (!blockId) return null;
    const cache = _ellipsometryCache(ctx, '_blockGrids');
    const cached = cache.get(blockId);
    if (cached) return cached;
    const siblings = operands || ctx._operandsById?.values();
    if (!siblings) return null;
    const lambdas = [];
    for (const sibling of siblings) {
        if (sibling.measuredCurveBlockId === blockId) lambdas.push(sibling.lambdaStart);
    }
    const grid = { lambdas, key: _gridKey(op.aoi ?? 0, lambdas) };
    cache.set(blockId, grid);
    return grid;
}

// The four quantities an ellipsometry operand can ask for, from the two angles,
// so a batched sample answers everything a point evaluation does.
function _ellipsometrySample(psi, delta) {
    const toRad = Math.PI / 180;
    return { psi, delta, tanPsi: Math.tan(psi * toRad), cosDelta: Math.cos(delta * toRad) };
}

// Ψ(λ) and Δ(λ) of the front stack over one wavelength list at one angle,
// through the batched kernel, memoized for the duration of an evaluateOperands
// call. The Ψ block and the Δ block of one measurement, and every point they
// expand into, share a single pass, so the finite-difference Jacobian costs one
// kernel call per block and perturbation rather than one per point.
export function _ellipsometryBatch(ctx, aoi, lambdas, key) {
    const cache = _ellipsometryCache(ctx, '_ellipsometryBatches');
    let batch = cache.get(key);
    if (batch) return batch;
    const n0List = lambdas.map(lam => nkOf(ctx, ctx.n0mat, lam));
    const nsList = lambdas.map(lam => nkOf(ctx, ctx.nsmat, lam));
    const layerNK = ctx.frontMats.map(mat => lambdas.map(lam => nkOf(ctx, mat, lam)));
    const { psi, delta } = evaluateEllipsometrySpectrum(
        lambdas, aoi, n0List, nsList, layerNK, ctx.frontThicks);
    batch = new Map();
    for (let index = 0; index < lambdas.length; index++) {
        batch.set(lambdas[index], _ellipsometrySample(psi[index], delta[index]));
    }
    cache.set(key, batch);
    return batch;
}

// Ψ, Δ and their thickness derivatives over the front stack at one angle and
// one wavelength list, memoized like _ellipsometryBatch and under the same key:
// a hand-typed operand asks for its own wavelength, the points expanded from a
// measured block share the block's whole grid in one kernel crossing.
function _ellipsometryJacobianBatch(ctx, aoi, lambdas, key) {
    const cache = _ellipsometryCache(ctx, '_ellipsometryJacobians');
    let batch = cache.get(key);
    if (batch) return batch;
    const n0List = lambdas.map(lam => nkOf(ctx, ctx.n0mat, lam));
    const nsList = lambdas.map(lam => nkOf(ctx, ctx.nsmat, lam));
    const layerNK = ctx.frontMats.map(mat => lambdas.map(lam => nkOf(ctx, mat, lam)));
    const points = evaluateEllipsometryThicknessJacobian({
        lambdas, theta_deg: aoi, n0List, nsList, layerNK, thick: ctx.frontThicks,
    });
    batch = new Map();
    for (let index = 0; index < lambdas.length; index++) batch.set(lambdas[index], points[index]);
    cache.set(key, batch);
    return batch;
}

// Chain rule from Ψ and Δ in degrees to the operand's own quantity, per nm.
function _ellipsometryQuantity(type, point) {
    const toRad = Math.PI / 180;
    if (type === 'PSI') return { value: point.psi, front: point.dPsi };
    if (type === 'DEL') return { value: point.delta, front: point.dDelta };
    if (type === 'TANPSI') {
        const tan = Math.tan(point.psi * toRad);
        return { value: tan, front: point.dPsi.map(slope => (1 + tan * tan) * slope * toRad) };
    }
    const rad = point.delta * toRad;   // COSDEL
    return { value: Math.cos(rad), front: point.dDelta.map(slope => -Math.sin(rad) * slope * toRad) };
}

// Front-layer derivatives placed on the optimizer's thickness vector. Ψ and Δ
// are evaluated on the front stack alone, so a back-side variable gets zero,
// and in back_only mode, where the front stack is fixed, so does every entry.
function _frontDerivativeVector(ctx, front) {
    const size = ctx.fullThicks?.length ?? ctx.frontThicks.length;
    const out = new Array(size).fill(0);
    if ((ctx.surfaceMode || 'front_only') === 'back_only') return out;
    const count = Math.min(front.length, ctx.frontThicks.length, size);
    for (let index = 0; index < count; index++) out[index] = front[index];
    return out;
}

/**
 * Value and exact thickness derivative of an ellipsometry operand (Ψ, Δ, tan Ψ
 * or cos Δ) over the optimizer's thickness vector. `operands` is the list the
 * Jacobian is assembled for, so a point expanded from a measured block can
 * share one batched kernel pass with its siblings. Null where a reflection
 * amplitude vanishes, so the engine falls back to finite differences.
 */
export function ellipsometryThicknessPoint(op, ctx, operands = null) {
    const aoi = op.aoi ?? 0;
    const own = [op.lambdaStart];
    const grid = _blockGrid(op, ctx, operands) || { lambdas: own, key: _gridKey(aoi, own) };
    const point = _ellipsometryJacobianBatch(ctx, aoi, grid.lambdas, grid.key).get(op.lambdaStart);
    if (!point) return null;
    const { value, front } = _ellipsometryQuantity(op.type, point);
    return { value, derivative: _frontDerivativeVector(ctx, front) };
}

// Ellipsometric Ψ/Δ (deg) or the ellipsometer-native tanΨ/cosΔ at op.lambdaStart.
// Ψ, Δ use BOTH polarizations (ρ = r_p/r_s), so op.pol is not consulted.
export function _evalEllipsometry(op, ctx) {
    if (op.measurementSide) _assertFrontEllipsometry(op, ctx);
    const lam = op.lambdaStart;
    let e = _measuredBlockPoint(op, ctx);
    if (!e) {
        const { n0, ns, layers } = _frontStackAt(ctx, lam);
        e = computeEllipsometry(lam, op.aoi, n0, ns, layers);
    }
    switch (op.type) {
        case 'PSI':    return e.psi;
        case 'DEL':    return e.delta;
        case 'TANPSI': return e.tanPsi;
        default:       return e.cosDelta;   // COSDEL
    }
}
