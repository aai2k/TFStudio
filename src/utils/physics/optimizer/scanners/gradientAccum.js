/**
 * Per-operand MF-gradient accumulation for the analytic P-function scan.
 *
 * Each accumulator folds one operand's contribution into descs[].num (the
 * gradient numerator), using the memoized scan and the chain-rule sensitivity.
 * Every R/T/A read and its derivative are summed over cfg.raysAt(op.aoi, λ),
 * the cone's rays and weights at that wavelength (one ray of weight 1 without a
 * cone), polarizations averaged with equal weight.
 */

import { polFromType } from '../operandModel.js';
import { charOf, operandSampleLambdas, bandQuadratureWeights } from '../sampling.js';
import { _charDerivAt } from './chainRule.js';

// The cone- and polarization-averaged value of `char` at one wavelength and its
// needle derivative for every descriptor. `read` bundles { char, pols, aoi }.
function _pointValueAndGradient(cfg, read, lam, descs, scanAt) {
    const { char, pols, aoi } = read;
    const npol = pols.length;
    let val = 0;
    const g = new Float64Array(descs.length);
    for (const pl of pols) {
        for (const ray of cfg.raysAt(aoi, lam)) {
            const res = scanAt(lam, pl, ray.aoiDeg);
            const wr = ray.weight / npol;
            val += wr * res[char];
            for (let di = 0; di < descs.length; di++) g[di] += wr * _charDerivAt(cfg, res, char, descs[di]);
        }
    }
    return { val, g };
}

// Continuous per-λ target (TGT/RGT/AGT): the operand value is
// comp = √(Σ qₛ devₛ²), devₛ = val(λₛ) − targetₛ, qₛ the band grid's trapezoid
// weights. Its MF-gradient contribution is w·comp·∂comp/∂d = w·Σₛ qₛ·devₛ·gₛ
// (the 1/comp cancels), gₛ = ∂val(λₛ)/∂d. Reduces to the band-avg single-point
// form when nL=1, so mixed TAV+TGT stays consistent.
export function _accumRangeTarget(cfg, op, descs, scanAt) {
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol ?? 'avg';
    const read = { char, pols: pol === 'avg' ? ['s', 'p'] : [pol], aoi: op.aoi };
    const lams = operandSampleLambdas(op);
    const nL = lams.length;
    const t0 = op.target;
    const t1 = op.targetEnd != null ? op.targetEnd : op.target;
    const q = bandQuadratureWeights(nL);
    for (let s = 0; s < nL; s++) {
        const wn = op.weight * q[s];
        const { val, g } = _pointValueAndGradient(cfg, read, lams[s], descs, scanAt);
        const f   = nL > 1 ? s / (nL - 1) : 0;
        const dev = val - (t0 + (t1 - t0) * f);
        for (let di = 0; di < descs.length; di++) descs[di].num += wn * dev * g[di];
    }
}

// Single-λ / band-average (TAV/RAV/AAV): residual = Σ qₛ·char(λₛ) − target,
// qₛ the band grid's trapezoid weights (a single λ has q = 1).
export function _accumBandAvg(cfg, op, descs, scanAt) {
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol ?? 'avg';
    const pols = pol === 'avg' ? ['s', 'p'] : [pol];
    const lams = operandSampleLambdas(op);
    const nL = lams.length, npol = pols.length;
    const q = bandQuadratureWeights(nL);
    let qBase = 0;
    const dq = new Float64Array(descs.length);
    for (let s = 0; s < nL; s++) {
        const lam = lams[s];
        const wlp = q[s] / npol;
        const rays = cfg.raysAt(op.aoi, lam);
        for (const pl of pols) {
            for (const ray of rays) {
                const res = scanAt(lam, pl, ray.aoiDeg);
                const w = wlp * ray.weight;
                qBase += w * res[char];
                for (let di = 0; di < descs.length; di++) dq[di] += w * _charDerivAt(cfg, res, char, descs[di]);
            }
        }
    }
    const resid = qBase - op.target;
    for (let di = 0; di < descs.length; di++) descs[di].num += op.weight * resid * dq[di];
}
