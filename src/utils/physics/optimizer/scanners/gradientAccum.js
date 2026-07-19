/**
 * Per-operand MF-gradient accumulation for the analytic P-function scan.
 *
 * Each accumulator folds one operand's contribution into descs[].num (the
 * gradient numerator), using the memoized scan and the chain-rule sensitivity.
 */

import { polFromType } from '../operandModel.js';
import { charOf, operandSampleLambdas } from '../sampling.js';
import { _charDerivAt } from './chainRule.js';

// Continuous per-λ target (TGT/RGT/AGT): the operand value is
// comp = √((1/nL)Σ devₛ²), devₛ = val(λₛ) − targetₛ. Its MF-gradient contribution
// is w·comp·∂comp/∂d = (w/nL)·Σₛ devₛ·gₛ (the 1/comp cancels), gₛ = ∂val(λₛ)/∂d.
// Reduces to the band-avg single-point form when nL=1, so mixed TAV+TGT stays
// consistent.
export function _accumRangeTarget(cfg, op, descs, scanAt) {
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol ?? 'avg';
    const pols = pol === 'avg' ? ['s', 'p'] : [pol];
    const lams = operandSampleLambdas(op);
    const nL = lams.length, npol = pols.length;
    const t0 = op.target;
    const t1 = op.targetEnd != null ? op.targetEnd : op.target;
    const wn = op.weight / nL;
    for (let s = 0; s < nL; s++) {
        const lam = lams[s];
        let val = 0;
        const g = new Float64Array(descs.length);
        for (const pl of pols) {
            const res = scanAt(lam, pl, op.aoi);
            val += res[char] / npol;
            for (let di = 0; di < descs.length; di++) g[di] += _charDerivAt(cfg, res, char, descs[di]) / npol;
        }
        const f   = nL > 1 ? s / (nL - 1) : 0;
        const dev = val - (t0 + (t1 - t0) * f);
        for (let di = 0; di < descs.length; di++) descs[di].num += wn * dev * g[di];
    }
}

// Single-λ / band-average (TAV/RAV/AAV): residual = mean(char) − target.
export function _accumBandAvg(cfg, op, descs, scanAt) {
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol ?? 'avg';
    const pols = pol === 'avg' ? ['s', 'p'] : [pol];
    const lams = operandSampleLambdas(op);
    const nL = lams.length, npol = pols.length;
    const wlp = 1 / (nL * npol);
    let qBase = 0;
    const dq = new Float64Array(descs.length);
    for (const lam of lams) {
        for (const pl of pols) {
            const res = scanAt(lam, pl, op.aoi);
            qBase += wlp * res[char];
            for (let di = 0; di < descs.length; di++) dq[di] += wlp * _charDerivAt(cfg, res, char, descs[di]);
        }
    }
    const resid = qBase - op.target;
    for (let di = 0; di < descs.length; di++) descs[di].num += op.weight * resid * dq[di];
}
