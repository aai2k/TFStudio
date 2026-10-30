/**
 * The kernel packages one analytic Jacobian reads, memoized per (λ, pol, aoi)
 * within a memory budget.
 */

import { computeLayerJacobian } from './layerJacobian.js';
import { kernelPol } from '../evalCore/kernels.js';

// Memory one Jacobian keeps kernel packages in: about 32000 packages on 60
// layers of one coating. A dozen synthesis workers refining at once keep under
// 1 GB of them, whatever the Step.
const JACOBIAN_CACHE_BYTES = 64 * 2 ** 20;

// Bytes one kept package takes: three derivative rows for each coating it
// covers, each row 8 bytes a layer and about 220 more. Measured on what the
// WASM kernel returns from 10 to 120 layers; the packages of a back coating
// and of the full system, rebuilt as plain arrays, are smaller.
function packageBytes(cfg) {
    const row = layers => 8 * layers + 220;
    if (cfg.mode !== 'full') return 3 * row(cfg.N);
    return 3 * (row(cfg.ctx.frontThicks.length) + row(cfg.ctx.backThicks.length));
}

/**
 * (λ, polCode, aoi) → computeLayerJacobian package, for the computeLayerJacobian
 * config `cfg`.
 *
 * A band row asks for a package at every sample of its grid, which a fine Step
 * makes tens of thousands long; holding them all took 92 MB of heap, and 258 MB
 * with the kernel's arrays, for one DLS step on 60 layers at 0.01 nm over
 * 400-1600 nm. The rows read their samples one row after another, in the same
 * order, so the cache keeps the first packages that fit in
 * JACOBIAN_CACHE_BYTES, which every later row on the grid finds, and the
 * current wavelength's packages, which the two halves of an average, the rays
 * of a cone and a row reading the property after its derivative share.
 */
export function makePackageCache(cfg) {
    const kept = new Map();
    const current = new Map();
    const capacity = Math.max(1, Math.floor(JACOBIAN_CACHE_BYTES / packageBytes(cfg)));
    let currentLam;
    return (lam, polCode, aoi) => {
        const pc = kernelPol(aoi, polCode);
        const key = lam + '|' + pc + '|' + aoi;
        if (lam !== currentLam) { current.clear(); currentLam = lam; }
        let value = kept.get(key) ?? current.get(key);
        if (value === undefined) {
            value = computeLayerJacobian(lam, pc, aoi, cfg);
            (kept.size < capacity ? kept : current).set(key, value);
        }
        return value;
    };
}
