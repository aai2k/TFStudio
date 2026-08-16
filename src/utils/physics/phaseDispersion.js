/**
 * Phase dispersion — analytic group delay, GDD, and TOD of a multilayer.
 *
 * The characteristic matrix is evaluated in third-order Taylor arithmetic with
 * angular frequency as the differentiation variable, following the analytic
 * matrix-differentiation method of Birge and Kärtner, Applied Optics 45,
 * 1478-1483 (2006), https://doi.org/10.1364/AO.45.001478. The reported orders
 * are then imaginary parts of logarithmic derivatives of the coefficient. No
 * phase unwrapping and no wavelength finite-difference stencil participates, so
 * a value at one wavelength does not depend on any neighbouring sample.
 *
 * Layout:
 *   coefficientJets.js    jet-valued characteristic matrix, r and t, and their
 *                         exact layer-thickness derivatives
 *   phaseDerivatives.js   GD, GDD, and TOD read off a coefficient jet
 *   stackEvaluator.js     one wavelength of a resolved stack, plus substrate
 *                         transit, with material-model and continuity metadata
 *   designEvaluator.js    design-level entry points used by the GD/GDD window
 *                         and the optimizer operands
 *
 * The underlying Taylor arithmetic lives in ../taylorJet.js, which is also used
 * to differentiate material dispersion formulas.
 *
 * Units: GD in fs, GDD in fs^2, TOD in fs^3, wavelength and thickness in nm.
 */

export {
    tmmCoefficientJets, tmmCoefficientThicknessJets,
} from './phaseDispersion/coefficientJets.js';

export {
    coefficientPhaseDispersion, coefficientPhaseThicknessDerivatives,
} from './phaseDispersion/phaseDerivatives.js';

export {
    evaluateStackPhaseDispersion, evaluateSubstratePropagation,
} from './phaseDispersion/stackEvaluator.js';

export {
    createDesignPhaseDispersionEvaluator, evaluateDesignPhaseDispersion,
    evaluateTotalTransmissionDispersion,
} from './phaseDispersion/designEvaluator.js';
