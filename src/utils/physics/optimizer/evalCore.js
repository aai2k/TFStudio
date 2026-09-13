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
 *   residualScale    per-type σ that puts mixed-unit residuals on one scale
 *   meritFunction    calcMF and calcOMF
 *   contributions    each row's share of the merit, and the weight denominator
 *   adaptiveSampling operand densification for sub-grid spectral features
 */

export { tmmJacEval, tmmHessEval, tmmNeedleScanEval } from './evalCore/kernels.js';

export { tmmProp, tmmFullSystem, isFullSystemEval, resolveEvalMode } from './evalCore/tmmEval.js';

export { MATH_REGISTRY, computeMathValue, mathResidual, mathResidualKind } from './evalCore/mathOperands.js';

export {
    evalOperand, makeRefResolver, OperandEvaluationError,
    ellipsometryThicknessPoint, phaseDispersionThicknessPoint, groupDelayFlatBandLevel,
} from './evalCore/operands/index.js';

export {
    buildEvalContext, evaluateOperands, operandEvaluationErrors, operandBandLevels,
} from './evalCore/evalContext.js';

export { ARGWAVE_RESIDUAL_SCALE_NM, operandResidualScale, _operandResidual } from './evalCore/residualScale.js';

export { calcMF, calcOMF } from './evalCore/meritFunction.js';

export { operandContributions, mfWeightDenominator } from './evalCore/contributions.js';

export {
    ADAPTIVE_SAMPLING_DEFAULTS, densifyOperandsForFeatures, collectDesignMaterialIds,
} from './evalCore/adaptiveSampling.js';
