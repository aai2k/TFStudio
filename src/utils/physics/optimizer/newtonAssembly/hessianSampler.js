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
import { kernelPol } from '../evalCore/kernels.js';

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

// Memory the sampler keeps kernel packages in: about 500 packages on 60 layers,
// 2800 on 20. A dozen synthesis workers refining at once keep under 1 GB of
// them, whatever the Step.
const HESSIAN_CACHE_BYTES = 64 * 2 ** 20;

// Bytes one kept package takes on N layers: three N×N second-derivative tables
// and three first-derivative rows, each row 8N bytes and about 220 more. Measured
// on what the WASM kernel returns from 10 to 120 layers; the JS kernel's
// packages and the back-side remap are smaller.
function packageBytes(N) {
    return 3 * (N + 1) * (8 * N + 220);
}

// The kernel package at one (λ, pol, aoi), in storage-layer order.
function _hessianAt(cfg, lam, polCode, aoi) {
    const { n0mat, nsmat, neMat, mats, thk, N, isSingleBack } = cfg;
    const ns = nsmat.getNK(lam);
    if (isSingleBack) {
        const n0 = neMat.getNK(lam);
        const layersRev = [];
        for (let i = N - 1; i >= 0; i--) layersRev.push({ n: mats[i].getNK(lam), d: thk[i] });
        return _remapHessianRev(tmmHessEval(lam, aoi, polCode, n0, ns, layersRev), N);
    }
    const n0 = n0mat.getNK(lam);
    const layers = thk.map((d, i) => ({ n: mats[i].getNK(lam), d }));
    return tmmHessEval(lam, aoi, polCode, n0, ns, layers);
}

// Memoized (λ,pol,aoi) → kernel package. A band row asks for a package at
// every sample of its grid, which a fine Step makes tens of thousands long;
// holding them all took 1.4 GB for one step on 60 layers at 0.1 nm over
// 400-1600 nm. The rows read their samples one row after another, in the same
// order, so the cache keeps the first packages that fit in HESSIAN_CACHE_BYTES,
// which every later row on the grid finds, and the latest package, which the s
// and p halves of an average at normal incidence share.
function _makePackageCache(cfg) {
    const cache = new Map();
    const capacity = Math.max(1, Math.floor(HESSIAN_CACHE_BYTES / packageBytes(cfg.N)));
    let latest = { key: null, value: null };
    return (lam, pol, aoi) => {
        const polCode = kernelPol(aoi, pol);
        const key = lam + '|' + polCode + '|' + aoi;
        const kept = latest.key === key ? latest.value : cache.get(key);
        if (kept !== undefined) return kept;
        const value = _hessianAt(cfg, lam, polCode, aoi);
        if (cache.size < capacity) cache.set(key, value);
        latest = { key, value };
        return value;
    };
}

// Build the per-(λ,pol,char,aoi) comp value/first/second-derivative sampler over
// the FREE variables (honoring pol='avg' = ½(s+p)) used to assemble the analytic
// second-order curvature term. `cfg` bundles the engine fields getH needs:
//   { n0mat, nsmat, neMat, mats, thk, N, isSingleBack, freeIdx, nFree }.
export function makeHessianSampler(cfg) {
    const { freeIdx, nFree } = cfg;
    const getH = _makePackageCache(cfg);
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
