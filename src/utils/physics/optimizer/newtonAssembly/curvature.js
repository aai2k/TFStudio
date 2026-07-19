/**
 * Per-operand contributions to the second-order curvature term S.
 *
 * Each `_curv*` mutates the upper triangle of H in `hc = { H, J, r0, nFree,
 * sample, addS }`; `rp` is the residual-row index (aligned with r0/J).
 * `_operandSupportsFullNewton` reports whether an operand is eligible for the
 * full analytic Newton Hessian at all.
 */

import { operandResidualScale } from '../evalCore.js';
import { resolveSourceSpec, resolveDetectorSpec } from '../../spectralWeightings.js';
import { isMath, isArgwave, isTotalThickness, polFromType } from '../operandModel.js';
import { charOf, operandSampleLambdas } from '../sampling.js';

// Range-target (TGT/RGT/AGT): comp = √((1/n)Σ devₛ²). The row's JᵀJ already
// added sw²·∂cₐ∂c_b; the full curvature collapses to
//   sw²/n·Σ(gₛₐgₛ_b + devₛ·∂²valₛ), so we add that and undo the row's JᵀJ.
export function _curvRangeTarget(op, rp, hc) {
    const { H, J, nFree, sample } = hc;
    const sw = Math.sqrt(op.weight);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n = lams.length;
    const t0 = op.target;
    const t1 = op.targetEnd != null ? op.targetEnd : op.target;
    const gg  = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
    const dv2 = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
    for (let s = 0; s < n; s++) {
        const fr  = n > 1 ? s / (n - 1) : 0;
        const ti  = t0 + (t1 - t0) * fr;
        const smp = sample(lams[s], pol, char, op.aoi);
        const dev = smp.val - ti;
        for (let a = 0; a < nFree; a++) {
            const ga = smp.d1[a];
            for (let b = a; b < nFree; b++) {
                gg[a][b]  += ga * smp.d1[b];
                dv2[a][b] += dev * smp.d2[a][b];
            }
        }
    }
    const c2 = (sw * sw) / n;
    for (let a = 0; a < nFree; a++)
        for (let b = a; b < nFree; b++)
            H[a][b] += c2 * (gg[a][b] + dv2[a][b]) - J[rp][a] * J[rp][b];
}

// Weighted-integral: ∂²r = sw·Σ wᵢ·∂²comp ; S = r·∂²r.
export function _curvIntegral(op, rp, hc) {
    const { r0, nFree, sample, addS } = hc;
    const sw = Math.sqrt(op.weight);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n = lams.length;
    const S = resolveSourceSpec(op.source || { id: 'E' });
    const D = resolveDetectorSpec(op.detector || { id: 'flat' });
    let den = 0; const wts = new Array(n);
    for (let s = 0; s < n; s++) { const w = S.sampler(lams[s]) * D.sampler(lams[s]); wts[s] = w; den += w; }
    if (den <= 1e-30) return;
    const invDen = 1 / den;
    const d2acc = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
    for (let s = 0; s < n; s++) {
        const wi = wts[s] * invDen;
        if (!(wi > 0)) continue;
        const smp = sample(lams[s], pol, char, op.aoi);
        for (let a = 0; a < nFree; a++) for (let b = a; b < nFree; b++) d2acc[a][b] += wi * smp.d2[a][b];
    }
    addS(r0[rp] * sw, d2acc);
}

// Band mean (TAV/RAV/AAV): ∂²r = sw/n·Σ ∂²comp.
export function _curvRangeAvg(op, rp, hc) {
    const { r0, nFree, sample, addS } = hc;
    const sw = Math.sqrt(op.weight);
    const char = charOf(op.type);
    const pol  = polFromType(op.type) ?? op.pol;
    const lams = operandSampleLambdas(op);
    const n = lams.length;
    const d2acc = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
    for (let s = 0; s < n; s++) {
        const smp = sample(lams[s], pol, char, op.aoi);
        for (let a = 0; a < nFree; a++) for (let b = a; b < nFree; b++) d2acc[a][b] += smp.d2[a][b];
    }
    addS((r0[rp] * sw) / n, d2acc);
}

// Whether one operand is compatible with the FULL analytic Newton Hessian.
// Math/argwave/total-thickness curvature isn't worked out, and σ-normalization
// ≠ 1 means the Jacobian is FD (so the analytic curvature would not match).
export function _operandSupportsFullNewton(op) {
    if (!op.enabled) return true;
    if (isMath(op.type) || isArgwave(op.type) || isTotalThickness(op.type)) return false;
    return operandResidualScale(op) === 1;
}
