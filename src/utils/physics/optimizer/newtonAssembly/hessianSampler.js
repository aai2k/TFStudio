/**
 * Memoized comp value / first / second thickness-derivative sampler over the
 * free variables, used to assemble the analytic second-order curvature term.
 *
 * Single-front is direct; single-back is evaluated on the reversed stack (light
 * enters from the exit medium) and remapped to storage-layer order. Per-residual
 * ∂²rₚ uses the analytic comp-Hessian tmmThicknessHessian (FD-validated,
 * tests/hessian_fd_validation.mjs). Reference: Tikhonov–Tikhonravov–Trubetskov
 * 1993; Nocedal & Wright 2e.
 */

import { tmmHessEval } from '../evalCore.js';

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
