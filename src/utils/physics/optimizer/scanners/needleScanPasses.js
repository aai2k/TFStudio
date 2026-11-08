/**
 * TMM needle-scan passes for the analytic P-function scan.
 *
 * Single-surface modes need one needleScan; full-system (symmetric /
 * both_independent) needs three passes (forward front, reverse front, back)
 * composed via Macleod §2.6.4. `_makeScanAt` memoizes the result per (λ,pol,aoi)
 * and computes the rays of a cone at one wavelength together, one kernel call
 * per pass.
 */

import { tmmNeedleScanEval, tmmNeedleScanRaysEval } from '../evalCore.js';
import { kernelPol, raysToCompute } from '../evalCore/kernels.js';
import { substrateAngle } from '../evalCore/surfaceModel.js';

// The stack a single-surface (front_only / back_only) scan reads at λ.
// back_only: light incident from the exit medium. backLayers are stored
// substrate→exit, so they are reversed so the TMM "sees" them in
// exit→substrate (light direction) order. Descriptor positions stay in storage
// order; readDeriv applies a mirror=true mapping when reading gradients out.
function singleSurfaceStack(cfg, lam) {
    const { surfaceMode, front, back, frontMats, backMats, n0mat, nsmat, neMat, candidateMats } = cfg;
    const ns = nsmat.getNK(lam);
    const candNs = candidateMats.map(c => c.mat.getNK(lam));
    if (surfaceMode === 'back_only') {
        const bLayersND = back.map((l, idx) => ({ n: backMats[idx].getNK(lam), d: l.thickness || 0 }));
        return { n0: neMat.getNK(lam), ns, candNs, layers: [...bLayersND].reverse() };
    }
    const layersND = front.map((l, idx) => ({ n: frontMats[idx].getNK(lam), d: l.thickness || 0 }));
    return { n0: n0mat.getNK(lam), ns, candNs, layers: layersND };
}

// A single-surface scan result from its one needleScan pass.
function singleSurfaceResult(cfg, res) {
    if (cfg.surfaceMode === 'back_only') return { mode: 'back_only', R: res.R, T: res.T, A: res.A, bck: res };
    return { mode: 'front_only', R: res.R, T: res.T, A: res.A, fwd: res };
}

// Single-surface (front_only / back_only) needle scan at one (λ,pol,aoi).
function _scanSingleSurface(cfg, lam, pol, aoi) {
    const { n0, ns, candNs, layers } = singleSurfaceStack(cfg, lam);
    return singleSurfaceResult(cfg, tmmNeedleScanEval(lam, aoi, pol, n0, ns, layers, candNs, cfg.fracs));
}

// The indices and stacks a full-system scan reads at λ.
function fullStacks(cfg, lam) {
    const { front, back, frontMats, backMats, n0mat, nsmat, neMat, candidateMats } = cfg;
    const fLayersND = front.map((l, idx) => ({ n: frontMats[idx].getNK(lam), d: l.thickness || 0 }));
    return {
        n0: n0mat.getNK(lam), ns: nsmat.getNK(lam), ne: neMat.getNK(lam),
        candNs: candidateMats.map(c => c.mat.getNK(lam)),
        fLayersND, fLayersRev: [...fLayersND].reverse(),
        bLayersND: back.map((l, idx) => ({ n: backMats[idx].getNK(lam), d: l.thickness || 0 })),
    };
}

// Full-system scan result from its three passes { fwd, rev, bck } (forward
// front, reverse front, back) composed via Macleod §2.6.4, keeping the
// intermediate R/T/P/D fields the chain rule needs. `cosSub` is the cosine of
// the angle inside the substrate and `ns` the substrate index.
function fullResult(cfg, lam, { fwd, rev, bck }, { ns, cosSub }) {
    const Rf  = fwd.R, Tf  = fwd.T;
    const Rfp = rev.R, Tfp = rev.T;
    const Rb  = bck.R, Tb  = bck.T;

    const k_sub    = ns[1];
    const d_sub_nm = cfg.subThickMm * 1e6;
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

// Full-system (symmetric / both_independent) needle scan at one (λ,pol,aoi).
// Forward and back passes always run; the reverse front pass is only needed
// for a front insertion, but keeping it keeps the cache shape uniform and is a
// single TMM per (λ,pol,aoi).
function _scanFull(cfg, lam, pol, aoi) {
    const { n0, ns, ne, candNs, fLayersND, fLayersRev, bLayersND } = fullStacks(cfg, lam);
    const { aoiSub, cosTs } = substrateAngle(aoi, n0, ns);
    const fwd = tmmNeedleScanEval(lam, aoi,    pol, n0, ns, fLayersND,  candNs, cfg.fracs);
    const rev = tmmNeedleScanEval(lam, aoiSub, pol, ns, n0, fLayersRev, candNs, cfg.fracs);
    const bck = tmmNeedleScanEval(lam, aoiSub, pol, ns, ne, bLayersND,  candNs, cfg.fracs);
    return fullResult(cfg, lam, { fwd, rev, bck }, { ns, cosSub: cosTs });
}

// Ray i of a needle scan over angles (tmmNeedleScanRaysEval), in the nested
// shape tmmNeedleScanEval returns: gaps[pos][c] and intra[k][fi].perCand[c],
// each { dR, dT, dA }.
function needleRayOf(grid, i, nCand, fracs) {
    const N = grid.N, nFrac = fracs.length;
    const triple = (block, o) => ({ dR: block.dR[o], dT: block.dT[o], dA: block.dA[o] });
    const gaps = new Array(N + 1);
    for (let pos = 0; pos <= N; pos++) {
        const row = new Array(nCand);
        for (let c = 0; c < nCand; c++) row[c] = triple(grid.gaps, (i * (N + 1) + pos) * nCand + c);
        gaps[pos] = row;
    }
    const intra = [];
    for (let k = 0; nFrac > 0 && k < N; k++) {
        const rowK = [];
        for (let fi = 0; fi < nFrac; fi++) {
            const perCand = new Array(nCand);
            for (let c = 0; c < nCand; c++) perCand[c] = triple(grid.intra, ((i * N + k) * nFrac + fi) * nCand + c);
            rowK.push({ frac: fracs[fi], perCand });
        }
        intra.push(rowK);
    }
    return { R: grid.R[i], T: grid.T[i], A: grid.A[i], gaps, intra, N };
}

// The scan results at (λ, pol) for every angle in `angles`, each pass over all
// of them in one kernel call; each bit-identical to the one-angle scan.
function scanRays(cfg, lam, pol, angles) {
    const { fracs } = cfg;
    const nCand = cfg.candidateMats.length;
    const rays = (grid, i) => needleRayOf(grid, i, nCand, fracs);
    if (!cfg.isFull) {
        const { n0, ns, candNs, layers } = singleSurfaceStack(cfg, lam);
        const grid = tmmNeedleScanRaysEval(lam, angles, pol, { n0, ns, layers }, { candNs, fracs });
        return angles.map((_, i) => singleSurfaceResult(cfg, rays(grid, i)));
    }
    const { n0, ns, ne, candNs, fLayersND, fLayersRev, bLayersND } = fullStacks(cfg, lam);
    const needles = { candNs, fracs };
    const inside = angles.map(aoi => substrateAngle(aoi, n0, ns));
    const subAngles = inside.map(at => at.aoiSub);
    const fwd = tmmNeedleScanRaysEval(lam, angles,    pol, { n0, ns, layers: fLayersND }, needles);
    const rev = tmmNeedleScanRaysEval(lam, subAngles, pol, { n0: ns, ns: n0, layers: fLayersRev }, needles);
    const bck = tmmNeedleScanRaysEval(lam, subAngles, pol, { n0: ns, ns: ne, layers: bLayersND }, needles);
    return inside.map(({ cosTs }, i) => fullResult(cfg, lam,
        { fwd: rays(fwd, i), rev: rays(rev, i), bck: rays(bck, i) }, { ns, cosSub: cosTs }));
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

/**
 * The memoized scan results for the scan config `cfg`; for full-system a
 * result bundles three needleScan passes plus the composed R/T/A and P:
 *   at(λ, pol, aoi)     the result at one ray
 *   fill(λ, pols, rays) compute together the results not held yet of a cone's
 *                       rays ({ aoiDeg }) in each polarization of `pols`, one
 *                       kernel call per pass and polarization; a single ray
 *                       is left to at()
 *
 * A band row asks for a result at every sample of its grid, which a fine Step
 * makes tens of thousands long; holding them all took 4.9 GB for one band row
 * at 0.01 nm over 400-700 nm on 30 layers. The rows read their samples one row
 * after another, in the same order, so the cache keeps the first results that
 * fit in SCAN_CACHE_BYTES, which every later row on the grid finds, and the
 * latest result, which the reads of one sample share. Under a cone each
 * wavelength has up to a few hundred rays, so only the current wavelength's
 * results are kept.
 */
export function _makeScanAt(cfg) {
    const cache = new Map();
    const capacity = Math.max(1, Math.floor(SCAN_CACHE_BYTES / resultBytes(cfg)));
    let cachedLam;
    let latest = { key: null, value: null };
    const keyOf = (lam, pol, aoi) => lam + '|' + pol + '|' + aoi;
    const atWavelength = lam => {
        if (cfg.coneActive && lam !== cachedLam) cache.clear();
        cachedLam = lam;
    };
    const at = (lam, polIn, aoi) => {
        const pol = kernelPol(aoi, polIn);
        const key = keyOf(lam, pol, aoi);
        const kept = latest.key === key ? latest.value : cache.get(key);
        if (kept) return kept;
        atWavelength(lam);
        const value = cfg.isFull ? _scanFull(cfg, lam, pol, aoi) : _scanSingleSurface(cfg, lam, pol, aoi);
        if (cfg.coneActive || cache.size < capacity) cache.set(key, value);
        latest = { key, value };
        return value;
    };
    const fill = (lam, pols, rays) => {
        if (rays.length < 2) return;
        atWavelength(lam);
        const isHeld = (pol, aoi) => cache.has(keyOf(lam, pol, aoi));
        for (const [pol, angles] of raysToCompute(rays, pols, isHeld)) {
            scanRays(cfg, lam, pol, angles).forEach((value, i) => cache.set(keyOf(lam, pol, angles[i]), value));
        }
    };
    return { at, fill };
}
