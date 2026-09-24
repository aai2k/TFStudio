/**
 * The wavelength grid a synthesis run scores on, as the design grows.
 *
 * A run launches with band sample counts set for its starting design
 * (densifyForRun). Needles and forced steps then add layers and optical
 * thickness, so the fringes get finer than the launch grid resolves and the
 * optimizer can start parking them between samples. At the top of every cycle
 * the runners re-sample for the design they are about to work on; when that
 * asks for more samples they switch grids, re-sample the worker material tables
 * onto it, and re-score the designs they compare against so every merit in the
 * comparison sits on the same grid. Counts only grow within a run.
 */

import {
    withDesignSampleCounts, requiredLambdas, collectDesignMaterialIds, buildPresampledTable,
    isPhaseDispersion, buildEvalContext, evaluateOperands, calcMF,
} from '../../../../utils/physics/optimizer.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';

/**
 * The operands re-sampled for `design` when any band operand needs more
 * samples than it carries, else null. `resolveMat` must resolve the pool
 * materials the run inserts as well as the design's own.
 */
export function regridForDesign(operands, design, resolveMat) {
    const grown = withDesignSampleCounts(operands, design, resolveMat);
    return grown === operands ? null : grown;
}

/** Merit of `design` on `operands`, the value a synthesis worker reports for it. */
export function meritOf(operands, design, resolveMat) {
    return calcMF(operands, evaluateOperands(operands, buildEvalContext(design, resolveMat)));
}

/**
 * Material tables for a synthesis worker pool: every material the launch
 * design and the candidate pool use, sampled on the operands' exact λ grid.
 */
export function presampleSynthesisMaterials(design, operands, pool) {
    const resolveMat = designMaterialLookup(design);
    const pairs = collectDesignMaterialIds(design).map(id => ({ id, mat: resolveMat(id) }))
        .concat(pool.map(p => ({ id: p.id, mat: p.mat })));
    return buildPresampledTable(requiredLambdas(operands), pairs, {
        includeOmegaResponses: operands.some(op => op.enabled && isPhaseDispersion(op.type)),
    });
}
