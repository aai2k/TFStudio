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
 * @returns {Array<{ctx: object, weight: number, index: number, operands: Array|null,
 *   incidentMedium: string, exitMedium: string, substrate: object}>}
 *   `operands` is the environment's own operand set, or null when the env
 *   defines none (callers then fall back to the shared operand set).
 *   `incidentMedium`/`exitMedium`/`substrate` are the environment's EFFECTIVE
 *   media (env override ?? design default), so callers that rebuild a design
 *   per environment (e.g. the analytic needle scan) do not need to re-derive
 *   them from the resolved ctx.
 */
export function buildEnvironmentSpecs(design, resolveMat) {
    const envs = design.meritEnvironments;

    // No environments defined → single environment using design's own media
    if (!envs || envs.length === 0) {
        return [{
            ctx: buildEvalContext(design, resolveMat),
            weight: 1.0,
            index: 0,
            operands: null,
            incidentMedium: design.incidentMedium,
            exitMedium: design.exitMedium,
            substrate: design.substrate
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
            index: i,
            operands: env.operands ?? null,
            incidentMedium: clonedDesign.incidentMedium,
            exitMedium: clonedDesign.exitMedium,
            substrate: clonedDesign.substrate
        };
    });
}

/**
 * Multi-environment weighted merit function.
 *
 * Denominator semantics (oracle #8): the weighted RMS is computed over the
 * POOLED per-environment accumulations —
 *
 *   MF_total = sqrt( Σ_e W_e·sumWRes2_e / Σ_e W_e·sumWopt_e )
 *
 * i.e. operand-count-weighted normalization: each environment's residual
 * sum-of-squares and optical-weight denominator are scaled by the environment
 * weight and combined into ONE RMS. This is the exact multi-environment
 * generalization of calcMF (a single environment reduces to
 * sqrt(sumWRes2/sumWopt), bit-identical to calcMF), and it keeps the result
 * identical to the pre-P3 behavior when no environment defines its own
 * operands (backward compatibility). The alternative — normalizing each
 * environment's MF first and then RMS-averaging the per-env MFs — was
 * considered and rejected because it changes the shared-operand result.
 *
 * @param {Array} specs - Environment specs from buildEnvironmentSpecs
 * @param {Array} operands - Shared operand array (fallback when a spec has no
 *   per-environment operands; each spec may carry its own `operands` instead)
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
        // Per-environment operand set when the env defines one, else the
        // shared operand set (backward compatible).
        const ops = spec.operands || operands;
        const values = evaluateOperands(ops, spec.ctx);
        const { sumWRes2, sumWopt, sumWcon } =
            getMeritAccumulation(ops, values, skipConstraints);

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
