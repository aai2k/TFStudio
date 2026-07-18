/**
 * Qualifier kinds, comparator kinds, and the default equality tolerance
 * per kind.
 */

export const QUALIFIER_KINDS = [
    'T_AT',              // T at single λ
    'T_AVG',             // avg T over band
    'R_AT',
    'R_AVG',
    'A_AT',
    'A_AVG',
    'MIN_MAX',           // true min/max of T/R/A over band (T(λ) drawing spec)
    'CENTRAL_LAMBDA',    // λ of band-extremum (peak or notch)
    'FWHM',              // full width at half max (configurable level)
    'EDGE_LAMBDA',       // λ at which T crosses a level (LP/SP edge)
    'INTEGRAL',          // weighted integral (Tvis, Tsol, Tuser, …)
    'THICKNESS_BUDGET',  // total physical thickness, nm
    'LAYER_COUNT',       // number of layers
];

export const QUALIFIER_CMPS = ['ge', 'le', 'eq', 'between'];

// Sensible `eq` tolerance default per kind, expressed in the kind's NATIVE unit
// (fraction for T/R/A specs, nm for wavelength/thickness, count for layer
// count). A single 0.01 default is right for optical specs (= 1 %) but is
// nonsensically tight for nm kinds (0.01 nm on a central-wavelength spec), so
// the tolerance follows the kind.
const TOL_BY_KIND = {
    CENTRAL_LAMBDA:   1.0,   // nm
    FWHM:             2.0,   // nm
    EDGE_LAMBDA:      1.0,   // nm
    THICKNESS_BUDGET: 10.0,  // nm
    LAYER_COUNT:      0,     // exact integer count
};

export function defaultTolForKind(kind) {
    return TOL_BY_KIND[kind] ?? 0.01;  // fraction = 1 % for T/R/A
}
