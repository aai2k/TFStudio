/**
 * Phase dispersion — analytic group delay, GDD, and TOD of a design.
 *
 * The jet-valued characteristic matrix and the phase formulas live in tmmcore,
 * alongside the ordinary transfer matrix; this folder adds what tmmcore
 * deliberately has no opinion about: resolving a design's materials to index
 * jets, choosing a side, and reporting which material model produced a number.
 *
 * The method is the analytic matrix differentiation of Birge and Kärtner,
 * Applied Optics 45, 1478-1483 (2006), https://doi.org/10.1364/AO.45.001478.
 * The reported orders are imaginary parts of logarithmic derivatives of the
 * coefficient. No phase unwrapping and no wavelength finite-difference stencil
 * participates, so a value at one wavelength does not depend on any neighbouring
 * sample.
 *
 * Layout:
 *   stackEvaluator.js     one wavelength of a resolved stack, plus substrate
 *                         transit, with material-model and continuity metadata
 *   designEvaluator.js    design-level entry points used by the GD/GDD window
 *                         and the optimizer operands
 *
 * Units: GD in fs, GDD in fs^2, TOD in fs^3, wavelength and thickness in nm.
 * tmmcore itself is unit-agnostic and takes the angular frequency that fixes
 * them; `stackEvaluator.js` is where fs is chosen.
 */

export {
    tmmCoefficientJets, tmmCoefficientThicknessJets,
    coefficientPhaseDispersion, coefficientPhaseThicknessDerivatives,
} from '../../tmmcore.js';

export {
    evaluateStackPhaseDispersion, evaluateSubstratePropagation,
} from './phaseDispersion/stackEvaluator.js';

export {
    createDesignPhaseDispersionEvaluator, evaluateDesignPhaseDispersion,
    evaluateTotalTransmissionDispersion,
} from './phaseDispersion/designEvaluator.js';
