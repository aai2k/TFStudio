/**
 * Systematic Deviations — apply global / per-material perturbations to the
 * design (thickness scale factor + Δn + Δk) and re-evaluate the spectrum, or
 * sweep one perturbation parameter over a range to produce a 2-D map.
 *
 * Pure compose-on-top of the validated `evaluateSpectrum…` family — no new
 * TMM. Layer-thickness multipliers are applied physically (dᵢ' = dᵢ · s_d);
 * Δn / Δk are applied through `wrapMaterial` (same path the Variator uses).
 *
 * Use case: simulate the spectrum of a coating built by a deposition process
 * that systematically over-/under-shoots thickness or has a material-index
 * offset vs nominal.
 */

export {
    emptyDeviation, THICKNESS_OFFSET_UNITS, cloneDeviation, isIdentityDeviation,
} from './systematicDeviations/deviationSpec.js';
export { enumerateUniqueMaterials } from './systematicDeviations/materials.js';
export { perturbLayers, perturbMedium, deviatedDesignForSpec } from './systematicDeviations/perturb.js';
export { computeDeviatedSpectrum } from './systematicDeviations/spectrum.js';
export { applyParamValue, paramLabel } from './systematicDeviations/sweepParams.js';

import { cloneDeviation } from './systematicDeviations/deviationSpec.js';
import { computeDeviatedSpectrum } from './systematicDeviations/spectrum.js';
import { applyParamValue } from './systematicDeviations/sweepParams.js';

// ── Parameter sweep ──────────────────────────────────────────────────────────

/**
 * Run a sweep: vary `sweep.param` linearly across [from, to] in `steps`
 * uniformly-spaced points, recording T/R/A vs λ at each.
 *
 * Returns 2-D arrays of shape [steps × nLambda], indexed [paramIndex][λIndex].
 *
 * @param {object} req
 * @param {object} req.design
 * @param {object} req.params
 * @param {object} req.baseDev   baseline deviation (not mutated)
 * @param {{param:string, from:number, to:number, steps:number}} req.sweep
 * @param {string} req.evalMode
 * @param {function} req.resolveMat
 * @returns {{paramValues:number[], lambda:number[], T2D:number[][], R2D:number[][], A2D:number[][]}}
 */
export function runDeviationSweep({ design, params, baseDev, sweep, evalMode, resolveMat }) {
    const nSteps = Math.max(2, Math.floor(sweep?.steps || 11));
    const from   = Number.isFinite(sweep?.from) ? sweep.from : 0;
    const to     = Number.isFinite(sweep?.to)   ? sweep.to   : 1;

    const paramValues = [];
    for (let i = 0; i < nSteps; i++) {
        const t = nSteps === 1 ? 0 : i / (nSteps - 1);
        paramValues.push(from + (to - from) * t);
    }

    let lambda = null;
    const T2D = [], R2D = [], A2D = [];

    for (const v of paramValues) {
        const dev = cloneDeviation(baseDev);
        applyParamValue(dev, sweep.param, v);
        const sp = computeDeviatedSpectrum(design, params, dev, evalMode, resolveMat);
        if (!lambda) lambda = sp.lambda;
        T2D.push(sp.T); R2D.push(sp.R); A2D.push(sp.A);
    }
    return { paramValues, lambda, T2D, R2D, A2D };
}
