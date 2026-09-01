/**
 * Single-wavelength signal sampler (storage order, top→substrate) and the
 * model-curve analysis (target level + extrema) used to derive the turning-
 * point / level-crossing cut targets.
 */

import { createGrowingLayerEvaluator, tmmTotalAvg } from '../../physics/thinFilmMath.js';

function pickChar(res, char, pol) {
    if (char === 'R') return pol === 's' ? res.Rs : pol === 'p' ? res.Rp : res.R;
    if (char === 'A') return pol === 's' ? res.As : pol === 'p' ? res.Ap : res.A;
    return pol === 's' ? res.Ts : pol === 'p' ? res.Tp : res.T;
}

/**
 * One-λ monitor signal over a layer stack on the witness chip. `sys` bundles
 * the fixed optical system: { theta, pol, char, incMat, subMat, subThickMM }.
 *
 * The chip is a plane-parallel slab in the chamber: the growing coating on its
 * front face, its bare back face returning light incoherently, and both faces
 * in the same medium. A transmittance monitor reads through both surfaces, so
 * the bare back face is part of the signal (a bare n = 1.52 chip reads 91.8 %,
 * not the 95.7 % of the coated surface alone).
 */
export function singleSignal(lam, mats, thicks, sys) {
    const { theta, pol, char, incMat, subMat, subThickMM } = sys;
    const lNDs = [];
    for (let i = 0; i < mats.length; i++) {
        if (thicks[i] > 0) lNDs.push({ n: mats[i].getNK(lam), d: thicks[i] });
    }
    const ambient = incMat.getNK(lam);
    const res = tmmTotalAvg(lam, theta,
        { incident: ambient, substrate: subMat.getNK(lam), exit: ambient },
        { front: lNDs, back: [] }, subThickMM ?? 1);
    return pickChar(res, char, pol);
}

/**
 * Batched sampler for one growing layer's signal at the monitor wavelength.
 * The layers beneath the growing one are fixed while it grows, so their matrix
 * product is built once and every thickness sampled costs one 2x2 multiply
 * (batched into a single WASM call when the kernel is available). Same signal
 * as singleSignal([curMat, ...matsBelow], [d, ...thicksBelow]), at linear
 * rather than quadratic cost over a grid.
 */
export function growingSignalSampler(lam, matsBelow, thicksBelow, sys) {
    const ev = createGrowingLayerEvaluator(sys.theta, sys.incMat, sys.subMat,
        matsBelow, thicksBelow, lam, sys.subThickMM ?? 1);
    return (curMat, dArr) => ev.sampleMany(sys.char, sys.pol, curMat, dArr);
}

/**
 * Model curve analysis (target level + extrema): samples the current layer's
 * signal on a fixed grid of candidate thicknesses [0, dHi] and returns the
 * theoretical level at d_target plus every local extremum found — used to
 * derive the turning-point / level-crossing cut targets. `model` bundles the
 * model-side stack: { matsBelow, thicksBelow, curMat }, where `matsBelow` are
 * the already-deposited layers beneath the growing one (storage order). The
 * growing layer leads the stack: it faces the incident medium.
 */
export function analyzeModelCurve(monLam, model, dTarget, sys) {
    const { matsBelow, thicksBelow, curMat } = model;
    const dHi = Math.max(2 * dTarget, dTarget + 50);
    const NP = 81;
    const ds = new Float64Array(NP);
    for (let s = 0; s < NP; s++) ds[s] = (s / (NP - 1)) * dHi;
    const sample = growingSignalSampler(monLam, matsBelow, thicksBelow, sys);
    const ys = sample(curMat, ds);
    const extrema = [];
    for (let s = 1; s < NP - 1; s++) {
        const a = ys[s - 1], b = ys[s], cv = ys[s + 1];
        if ((b > a && b >= cv) || (b < a && b <= cv)) {
            extrema.push({ d: ds[s], isMax: b > a });
        }
    }
    // The level a 'level' cut is terminated on is the signal at the target
    // thickness itself, not at the nearest grid sample: on a layer thinner
    // than the grid can center, the sample sits up to a percent of the layer
    // away, and the cut would converge to that wrong level exactly.
    const sAtTarget = sample(curMat, [dTarget])[0];
    return { sAtTarget, sStart: ys[0], extrema, dHi };
}
