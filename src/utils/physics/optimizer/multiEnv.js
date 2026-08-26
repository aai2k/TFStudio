/**
 * Multi-environment joint optimization support.
 *
 * Enables optimizing the same coating design across multiple incident/emergent
 * media environments simultaneously. The merit function is a weighted RMS
 * across all environments.
 *
 * Reference: 膜系的多环境优化.md (Phase 2 implementation plan)
 */

import { buildEvalContext, evaluateOperands, getMeritAccumulation } from './evalCore.js';

/**
 * Build environment specs from a design's meritEnvironments array.
 * When meritEnvironments is empty, returns a single spec using the design's
 * own media (backward-compatible single-environment mode).
 *
 * @param {object} design - Design object with optional meritEnvironments array
 * @param {function} resolveMat - Material resolution function
 * @returns {Array<{ctx: object, weight: number, index: number}>}
 */
export function buildEnvironmentSpecs(design, resolveMat) {
    const envs = design.meritEnvironments;

    // No environments defined → single environment using design's own media
    if (!envs || envs.length === 0) {
        return [{
            ctx: buildEvalContext(design, resolveMat),
            weight: 1.0,
            index: 0
        }];
    }

    // Multi-environment: clone design for each env, overriding media
    return envs.map((env, i) => {
        const clonedDesign = {
            ...design,
            incidentMedium: env.incidentMedium ?? design.incidentMedium,
            exitMedium: env.exitMedium ?? design.exitMedium,
            substrate: env.substrate
                ? { ...design.substrate, ...env.substrate }
                : design.substrate,
            // Layers, surfaceMode, mfEvalMode, cone stay the same
            frontLayers: design.frontLayers,
            backLayers: design.backLayers,
            surfaceMode: design.surfaceMode,
            mfEvalMode: design.mfEvalMode,
            cone: design.cone
        };
        return {
            ctx: buildEvalContext(clonedDesign, resolveMat),
            weight: env.weight ?? 1.0,
            index: i
        };
    });
}

/**
 * Multi-environment weighted merit function.
 *
 * MF_total = sqrt( sum_e(W_e * sumWRes2_e) / sum_e(W_e * sumWopt_e) )
 *
 * @param {Array} specs - Environment specs from buildEnvironmentSpecs
 * @param {Array} operands - Operand array
 * @param {object} opts - Options (skipConstraints, getMeritAccumulation)
 * @returns {{mf: number, perEnvMf: number[], totalSumWRes2: number, totalSumWopt: number, totalSumWcon: number}}
 */
export function calcMFMultiEnv(specs, operands, opts = {}) {
    const { skipConstraints = false, getMeritAccumulation } = opts;
    let totalSumWRes2 = 0;
    let totalSumWopt = 0;
    let totalSumWcon = 0;
    const perEnvMf = [];

    for (const spec of specs) {
        const values = evaluateOperands(operands, spec.ctx);
        const { sumWRes2, sumWopt, sumWcon } =
            getMeritAccumulation(operands, values, skipConstraints);

        totalSumWRes2 += spec.weight * sumWRes2;
        totalSumWopt  += spec.weight * sumWopt;
        totalSumWcon  += spec.weight * sumWcon;

        // Per-environment MF (for UI display)
        const denom = sumWopt > 0 ? sumWopt : sumWcon;
        perEnvMf.push(denom > 0 ? Math.sqrt(sumWRes2 / denom) : 0);
    }

    const denom = totalSumWopt > 0 ? totalSumWopt : totalSumWcon;
    const mf = denom > 0 ? Math.sqrt(totalSumWRes2 / denom) : 0;

    return { mf, perEnvMf, totalSumWRes2, totalSumWopt, totalSumWcon };
}
