/**
 * Single-wavelength signal sampler (storage order, top→substrate) and the
 * model-curve analysis (target level + extrema) used to derive the turning-
 * point / level-crossing cut targets.
 */

import { tmmAvg } from '../../physics/thinFilmMath.js';

function pickChar(res, char, pol) {
    if (char === 'R') return pol === 's' ? res.Rs : pol === 'p' ? res.Rp : res.R;
    if (char === 'A') return pol === 's' ? res.As : pol === 'p' ? res.Ap : res.A;
    return pol === 's' ? res.Ts : pol === 'p' ? res.Tp : res.T;
}

/**
 * One-λ TMM signal over a layer stack. `sys` bundles the fixed optical
 * system: { theta, pol, char, incMat, subMat }.
 */
export function singleSignal(lam, mats, thicks, sys) {
    const { theta, pol, char, incMat, subMat } = sys;
    const lNDs = [];
    for (let i = 0; i < mats.length; i++) {
        if (thicks[i] > 0) lNDs.push({ n: mats[i].getNK(lam), d: thicks[i] });
    }
    const res = tmmAvg(lam, theta, incMat.getNK(lam), subMat.getNK(lam), lNDs);
    return pickChar(res, char, pol);
}

/**
 * Model curve analysis (target level + extrema): samples the current layer's
 * signal on a fixed grid of candidate thicknesses [0, dHi] and returns the
 * theoretical level at d_target plus every local extremum found — used to
 * derive the turning-point / level-crossing cut targets. `model` bundles the
 * model-side stack: { prevMats, thicksPrev, curMat }.
 */
export function analyzeModelCurve(monLam, model, dTarget, sys) {
    const { prevMats, thicksPrev, curMat } = model;
    const dHi = Math.max(2 * dTarget, dTarget + 50);
    const NP = 81;
    const ds = new Float64Array(NP);
    const ys = new Float64Array(NP);
    for (let s = 0; s < NP; s++) {
        const d = (s / (NP - 1)) * dHi;
        ds[s] = d;
        ys[s] = singleSignal(monLam, prevMats.concat([curMat]), thicksPrev.concat([d]), sys);
    }
    const targetIdx = Math.max(1, Math.min(NP - 2, Math.round((dTarget / dHi) * (NP - 1))));
    const extrema = [];
    for (let s = 1; s < NP - 1; s++) {
        const a = ys[s - 1], b = ys[s], cv = ys[s + 1];
        if ((b > a && b >= cv) || (b < a && b <= cv)) {
            extrema.push({ d: ds[s], isMax: b > a });
        }
    }
    return { sAtTarget: ys[targetIdx], sStart: ys[0], extrema, dHi };
}
