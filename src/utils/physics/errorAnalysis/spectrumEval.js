/**
 * Spectral characteristic evaluator + material-index perturbation, shared by
 * the theoretical run and every Monte Carlo trial. See ../errorAnalysis.js
 * for the full statistical model and references.
 */

import {
    evaluateSpectrum,
    evaluateSpectrumBack,
    evaluateSpectrumTotal,
} from '../thinFilmMath.js';

/**
 * Evaluate the chosen spectral characteristic on a *modified* design.
 *
 * `modLayers` may be different objects than `design.frontLayers` /
 * `design.backLayers` — we always pass them through the design's `evalMode`
 * routing (front / back / total) and recompute spectrally on the same grid.
 *
 * `getMatForLayer(side, layerIdx)` lets callers inject perturbed material
 * proxies (n,k variations). When not supplied, the original material from
 * the layer's `material` id is used via `resolveMat`.
 */
export function evaluateChar({ design, params, evalMode, resolveMat,
    frontLayers, backLayers, getMatForLayer }) {
    const incId = typeof design.incidentMedium === 'string'
        ? design.incidentMedium : (design.incidentMedium?.material ?? 'Air');
    const exitId = typeof design.exitMedium === 'string'
        ? design.exitMedium : (design.exitMedium?.material ?? 'Air');
    const subId = design.substrate?.material ?? 'BK7';
    const subThick = design.substrate?.thickness ?? 1.0;

    const incMat  = resolveMat(incId);
    const subMat  = resolveMat(subId);
    const exitMat = resolveMat(exitId);

    // H10: capture the ORIGINAL (unfiltered) layer index BEFORE dropping
    // zero-thickness layers, and hand THAT index to getMatForLayer. The trial's
    // perturbation arrays (dThk/dn/dk) and matsFront/matsBack are all on the
    // unfiltered index space, so a layer that is 0 nm nominally — or clamped to
    // 0 by this trial's draw — must not shift the material lookup for the layers
    // after it.
    const fLayers = (frontLayers || [])
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.thickness > 0)
        .map(({ l, i }) => ({
            material:  getMatForLayer ? getMatForLayer('front', i) : resolveMat(l.material),
            thickness: l.thickness,
        }));
    const bLayers = (backLayers || [])
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.thickness > 0)
        .map(({ l, i }) => ({
            material:  getMatForLayer ? getMatForLayer('back', i) : resolveMat(l.material),
            thickness: l.thickness,
        }));

    if (evalMode === 'back') {
        return evaluateSpectrumBack(params, exitMat, subMat, bLayers);
    }
    if (evalMode === 'total') {
        return evaluateSpectrumTotal(params, incMat, subMat, exitMat,
                                     fLayers, bLayers, subThick);
    }
    return evaluateSpectrum(params, incMat, subMat, fLayers);
}

/**
 * Build a material proxy with shifted n,k. Wraps the underlying material's
 * `getNK(λ)` so dispersion is preserved; the perturbation is a constant
 * additive offset (a per-layer absolute σ on Re(n) / Im(n)).
 *
 * `dn` adds to n; `dk` adds to k (k ≥ 0 absorbing convention). All other
 * material fields are kept; this proxy is intended for one Monte-Carlo trial
 * only.
 */
export function makeShiftedMaterial(baseMat, dn, dk) {
    if (!dn && !dk) return baseMat;
    return {
        ...baseMat,
        getNK: (lam) => {
            const [n, k] = baseMat.getNK(lam);
            return [n + dn, k + dk];
        },
    };
}
