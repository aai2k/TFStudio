/**
 * Second-order (Newton) system assembly for the least-squares engine.
 *
 * Pure functions that build the merit-function Hessian used by
 * `LSQEngine._newtonSystem` / `_gaussNewtonSystem`, factored out of the engine:
 *  - `_jtjUpper` / `_mirrorUpper` — the Gauss-Newton JᵀJ (upper triangle) + Jᵀr.
 *  - `makeHessianSampler` — memoized comp value / first / second thickness
 *    derivatives over free variables (single-front direct; single-back reversed
 *    via `_remapHessianRev`).
 *  - `_curv*` — per-operand-type contributions to the second-order curvature S.
 *  - `_operandSupportsFullNewton` — full-Newton eligibility of one operand.
 *
 * Minimizing MF = √(SSR/ΣW) ≡ minimizing SSR = Σ rₚ²; the Newton system solves
 * H_SSR·Δ = −∇SSR with H_SSR = 2·(JᵀJ + S), S[a][b] = Σₚ rₚ·∂²rₚ/∂dₐ∂d_b (the
 * factor 2 cancels). Gauss-Newton keeps only JᵀJ (S→0 near the optimum).
 * Per-residual ∂²rₚ uses the analytic comp-Hessian tmmThicknessHessian
 * (FD-validated, tests/hessian_fd_validation.mjs). Reference:
 * Tikhonov–Tikhonravov–Trubetskov 1993; Nocedal & Wright 2e.
 */

import { tmmHessEval, operandResidualScale } from './evalCore.js';
import { resolveSourceSpec, resolveDetectorSpec } from '../spectralWeightings.js';
import { isMath, isArgwave, isTotalThickness, polFromType } from './operandModel.js';
import { charOf, operandSampleLambdas } from './sampling.js';

// Gauss-Newton core: JᵀJ (upper triangle only) and Jtr = Jᵀr for a residual
// vector r0 and Jacobian J (m × nFree).
export function _jtjUpper(J, r0, nFree, m) {
    const H   = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
    const Jtr = new Array(nFree).fill(0);
    for (let row = 0; row < m; row++) {
        const Jr = J[row], rr = r0[row];
        for (let a = 0; a < nFree; a++) {
            Jtr[a] += Jr[a] * rr;
            const Jra = Jr[a];
            for (let b = a; b < nFree; b++) H[a][b] += Jra * Jr[b];
        }
    }
    return { H, Jtr };
}

// Fill the lower triangle of an upper-triangular symmetric matrix in place.
export function _mirrorUpper(H, nFree) {
    for (let a = 0; a < nFree; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
}

// Merit-Hessian curvature-picker helpers: value / first / second thickness
// derivative of one characteristic from a tmmHessEval package.
function _hPickVal(Hk, ch) { return ch === 'T' ? Hk.T : ch === 'R' ? Hk.R : Hk.A; }
function _hPick1(Hk, ch) { return ch === 'T' ? Hk.dTdd : ch === 'R' ? Hk.dRdd : Hk.dAdd; }
function _hPick2(Hk, ch) { return ch === 'T' ? Hk.d2Tdd : ch === 'R' ? Hk.d2Rdd : Hk.d2Add; }

// Remap a reversed-stack Hessian package (back_only: light enters from the exit
// medium through the reversed stack) back to storage-layer order. ∂²/∂dᵢ∂dⱼ is
// symmetric, so read via at() which handles upper-only storage.
function _remapHessianRev(Hr, N) {
    const at = (M, p, q) => (p <= q ? M[p][q] : M[q][p]);
    const d1 = (arr) => { const o = new Array(N); for (let i = 0; i < N; i++) o[i] = arr[N - 1 - i]; return o; };
    const d2 = (M) => {
        const o = Array.from({ length: N }, () => new Array(N).fill(0));
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) o[i][j] = at(M, N - 1 - i, N - 1 - j);
        return o;
    };
    return { T: Hr.T, R: Hr.R, A: Hr.A,
             dTdd: d1(Hr.dTdd), dRdd: d1(Hr.dRdd), dAdd: d1(Hr.dAdd),
             d2Tdd: d2(Hr.d2Tdd), d2Rdd: d2(Hr.d2Rdd), d2Add: d2(Hr.d2Add) };
}

// Build the per-(λ,pol,char,aoi) comp value/first/second-derivative sampler over
// the FREE variables (honoring pol='avg' = ½(s+p)) used to assemble the analytic
// second-order curvature term. `cfg` bundles the engine fields getH needs:
//   { n0mat, nsmat, neMat, mats, thk, N, isSingleBack, freeIdx, nFree }.
export function makeHessianSampler(cfg) {
    const { n0mat, nsmat, neMat, mats, thk, N, isSingleBack, freeIdx, nFree } = cfg;
    const hcache = new Map();
    const getH = (lam, polCode, aoi) => {
        const key = lam + '|' + polCode + '|' + aoi;
        let v = hcache.get(key);
        if (v !== undefined) return v;
        const ns = nsmat.getNK(lam);
        if (isSingleBack) {
            const n0 = neMat.getNK(lam);
            const layersRev = [];
            for (let i = N - 1; i >= 0; i--) layersRev.push({ n: mats[i].getNK(lam), d: thk[i] });
            v = _remapHessianRev(tmmHessEval(lam, aoi, polCode, n0, ns, layersRev), N);
        } else {
            const n0 = n0mat.getNK(lam);
            const layers = thk.map((d, i) => ({ n: mats[i].getNK(lam), d }));
            v = tmmHessEval(lam, aoi, polCode, n0, ns, layers);
        }
        hcache.set(key, v);
        return v;
    };
    // { val, d1:[nFree], d2:[nFree][nFree] (upper) }
    const sample = (lam, pol, ch, aoi) => {
        const d1 = new Array(nFree).fill(0);
        const d2 = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
        let val = 0;
        const add = (w, polCode) => {
            const Hk = getH(lam, polCode, aoi);
            val += w * _hPickVal(Hk, ch);
            const D1 = _hPick1(Hk, ch), D2 = _hPick2(Hk, ch);
            for (let a = 0; a < nFree; a++) {
                d1[a] += w * D1[freeIdx[a]];
                const ra = D2[freeIdx[a]];
                for (let b = a; b < nFree; b++) d2[a][b] += w * ra[freeIdx[b]];
            }
        };
        if (pol === 'avg') { add(0.5, 's'); add(0.5, 'p'); } else add(1.0, pol);
        return { val, d1, d2 };
    };
    return { sample };
}

// H += coef · d2  (upper triangle).
export function _addS(H, nFree, coef, d2) {
    if (!coef) return;
    for (let a = 0; a < nFree; a++) for (let b = a; b < nFree; b++) H[a][b] += coef * d2[a][b];
}

// Per-operand contributions to the second-order curvature term S. Each mutates
// the upper triangle of H in `hc = { H, J, r0, nFree, sample, addS }`; `rp` is
// the residual-row index (aligned with r0/J).

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
