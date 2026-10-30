/**
 * TMM needle-scan passes for the analytic P-function scan.
 *
 * Single-surface modes need one needleScan; full-system (symmetric /
 * both_independent) needs three passes (forward front, reverse front, back)
 * composed via Macleod §2.6.4. `_makeScanAt` memoizes the result per (λ,pol,aoi).
 */

import { tmmNeedleScanEval } from '../evalCore.js';
import { kernelPol } from '../evalCore/kernels.js';

// Single-surface (front_only / back_only) needle scan at one (λ,pol,aoi).
function _scanSingleSurface(cfg, lam, pol, aoi) {
    const { surfaceMode, front, back, frontMats, backMats, n0mat, nsmat, neMat, candidateMats, fracs } = cfg;
    const n0 = n0mat.getNK(lam);
    const ns = nsmat.getNK(lam);
    const candNs = candidateMats.map(c => c.mat.getNK(lam));
    if (surfaceMode === 'back_only') {
        // Single back-surface scan: light incident from the exit medium.
        // backLayers are stored substrate→exit, so reverse them so the TMM
        // "sees" them in exit→substrate (light direction) order. Descriptor
        // positions stay in storage order; readDeriv applies a mirror=true
        // mapping when reading gradients out.
        const ne = neMat.getNK(lam);
        const bLayersND = back.map((l, idx) => ({ n: backMats[idx].getNK(lam), d: l.thickness || 0 }));
        const bLayersRev = [...bLayersND].reverse();
        const res = tmmNeedleScanEval(lam, aoi, pol, ne, ns, bLayersRev, candNs, fracs);
        return { mode: 'back_only', R: res.R, T: res.T, A: res.A, bck: res };
    }
    const layersND = front.map((l, idx) => ({ n: frontMats[idx].getNK(lam), d: l.thickness || 0 }));
    const res = tmmNeedleScanEval(lam, aoi, pol, n0, ns, layersND, candNs, fracs);
    return { mode: 'front_only', R: res.R, T: res.T, A: res.A, fwd: res };
}

// Full-system (symmetric / both_independent) needle scan at one (λ,pol,aoi):
// three TMM passes (forward front, reverse front, back) composed via Macleod
// §2.6.4, keeping the intermediate R/T/P/D fields the chain rule needs.
function _scanFull(cfg, lam, pol, aoi) {
    const { front, back, frontMats, backMats, n0mat, nsmat, neMat, candidateMats, fracs, subThickMm } = cfg;
    const n0 = n0mat.getNK(lam);
    const ns = nsmat.getNK(lam);
    const candNs = candidateMats.map(c => c.mat.getNK(lam));
    const ne = neMat.getNK(lam);
    const sin0 = Math.sin(aoi * Math.PI / 180);
    const sinSub = ns[0] > 0 ? Math.min(1, n0[0] * sin0 / ns[0]) : 0;
    const cosSub = Math.sqrt(1 - sinSub * sinSub);
    const aoiSub = Math.asin(sinSub) * 180 / Math.PI;

    const fLayersND = front.map((l, idx) => ({ n: frontMats[idx].getNK(lam), d: l.thickness || 0 }));
    const fLayersRev = [...fLayersND].reverse();
    const bLayersND = back.map((l, idx) => ({ n: backMats[idx].getNK(lam), d: l.thickness || 0 }));

    // Forward and back passes always run; reverse front pass only needed when
    // there's a front insertion (front_only is already short-circuited by the
    // caller, so for back_only we technically could skip rev, but keeping it
    // keeps the cache shape uniform and is a single TMM per (λ,pol,aoi) — cheap).
    const fwd = tmmNeedleScanEval(lam, aoi,    pol, n0, ns, fLayersND,  candNs, fracs);
    const rev = tmmNeedleScanEval(lam, aoiSub, pol, ns, n0, fLayersRev, candNs, fracs);
    const bck = tmmNeedleScanEval(lam, aoiSub, pol, ns, ne, bLayersND,  candNs, fracs);

    const Rf  = fwd.R, Tf  = fwd.T;
    const Rfp = rev.R, Tfp = rev.T;
    const Rb  = bck.R, Tb  = bck.T;

    const k_sub    = ns[1];
    const d_sub_nm = subThickMm * 1e6;
    const P = (k_sub > 0 && cosSub > 0)
        ? Math.exp(-4 * Math.PI * k_sub * d_sub_nm / (lam * cosSub))
        : 1.0;
    const P2 = P * P;
    const D  = 1 - Rfp * Rb * P2;
    const R  = Rf + (Tf * Tfp * P2 * Rb) / D;
    const T  = (Tf * P * Tb) / D;
    const A  = Math.max(0, 1 - R - T);

    return { mode: 'full', R, T, A, P, P2, D, Rf, Tf, Rfp, Tfp, Rb, Tb, fwd, rev, bck };
}

// Memory the scan keeps kernel results in: about 400 results on 30 layers with
// two candidate materials and 16 positions in a layer, 200 on 60. Rows scored
// on the same grid, such as an average of T and one of R over one band, share
// the results it holds, and a dozen synthesis workers scanning at once keep
// under 1 GB of them, whatever the Step.
const SCAN_CACHE_BYTES = 64 * 2 ** 20;

// Bytes one result takes: about 104 per derivative (one per insertion position
// and candidate material) and 113 per position, measured on the shapes
// needleScan returns. A full-system result holds two passes over the front
// and one over the back.
function resultBytes(cfg) {
    const positions = n => (n + 1) + n * cfg.nIntra;
    const scanned = cfg.isFull
        ? 2 * positions(cfg.front.length) + positions(cfg.back.length)
        : positions(cfg.surfaceMode === 'back_only' ? cfg.back.length : cfg.front.length);
    return scanned * (113 + 104 * cfg.candidateMats.length);
}

// Memoized (λ,pol,aoi) → scan-result factory; for full-system a result bundles
// three needleScan passes plus the composed R/T/A and P. A band row asks for
// a result at every sample of its grid, which a fine Step makes tens of
// thousands long; holding them all took 4.9 GB for one band row at 0.01 nm over
// 400-700 nm on 30 layers. The rows read their samples one row after another,
// in the same order, so the cache keeps the first results that fit in
// SCAN_CACHE_BYTES, which every later row on the grid finds, and the latest
// result, which the reads of one sample share. Under a cone each wavelength has
// up to a few hundred rays, so only the current wavelength's results are kept.
export function _makeScanAt(cfg) {
    const cache = new Map();
    const capacity = Math.max(1, Math.floor(SCAN_CACHE_BYTES / resultBytes(cfg)));
    let cachedLam;
    let latest = { key: null, value: null };
    return (lam, polIn, aoi) => {
        const pol = kernelPol(aoi, polIn);
        const key = lam + '|' + pol + '|' + aoi;
        const kept = latest.key === key ? latest.value : cache.get(key);
        if (kept) return kept;
        if (cfg.coneActive && lam !== cachedLam) cache.clear();
        cachedLam = lam;
        const value = cfg.isFull ? _scanFull(cfg, lam, pol, aoi) : _scanSingleSurface(cfg, lam, pol, aoi);
        if (cfg.coneActive || cache.size < capacity) cache.set(key, value);
        latest = { key, value };
        return value;
    };
}
