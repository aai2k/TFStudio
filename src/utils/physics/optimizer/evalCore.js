/**
 * Optical evaluation core: the numerical heart shared by DLSOptimizer and the
 * needle/GE scanners. This file is the entry point and re-exports the whole
 * evaluation surface, so importers name one module regardless of how the parts
 * below are arranged. Reference: Macleod, Thin-Film Optical Filters 5e;
 * Sullivan & Dobrowolski Appl. Opt. 35 (1996).
 *
 *   kernels          TMM kernel entry points, WASM kernel with a JS fallback
 *   tmmEval          one (λ, angle, polarization) property through whichever
 *                    surface model the design's modes call for
 *   mathOperands     value and residual tables for the math operand kinds
 *   operands/        the per-kind operand evaluators and their dispatch
 *   evalContext      evaluation context construction and the evaluation pass
 *   coneNodeCount    the cone node count each wavelength is averaged with
 *   residualScale    per-type σ that puts mixed-unit residuals on one scale
 *   meritFunction    calcMF, calcOMF and the weight denominator
 *   contributions    each row's share of the merit
 *   adaptiveSampling operand densification for sub-grid spectral features
 *   fringeSampling   band sample counts from the coating's fringe spacing
 */

export { tmmJacEval, tmmHessEval, tmmNeedleScanEval } from './evalCore/kernels.js';

export { tmmProp, tmmFullSystem, isFullSystemEval, resolveEvalMode } from './evalCore/tmmEval.js';

export { MATH_REGISTRY, computeMathValue, mathResidual, mathResidualKind } from './evalCore/mathOperands.js';

export {
    evalOperand, makeRefResolver, OperandEvaluationError,
    ellipsometryThicknessPoint, phaseDispersionThicknessPoint, groupDelayFlatBandLevel,
} from './evalCore/operands/index.js';

export {
    buildEvalContext, effectiveBackLayers, evaluateOperands, operandEvaluationErrors,
    operandBandLevels, operandSampleDeviations, operandExtremumLambdas,
} from './evalCore/evalContext.js';

export { ARGWAVE_RESIDUAL_SCALE_NM, operandResidualScale, _operandResidual } from './evalCore/residualScale.js';

export { calcMF, calcOMF, mfWeightDenominator } from './evalCore/meritFunction.js';

export { operandContributions } from './evalCore/contributions.js';

export {
    ADAPTIVE_SAMPLING_DEFAULTS, densifyOperandsForFeatures, collectDesignMaterialIds,
} from './evalCore/adaptiveSampling.js';

export {
    groupThicknessAt, withFringeSampleCounts, withDesignSampleCounts,
} from './evalCore/fringeSampling.js';
