/**
 * Qualifier kinds, comparator kinds, the default equality tolerance per kind,
 * the step a peak or centre check searches at, and the side a thickness
 * budget or layer count adds up.
 */

import { EXTREMUM_FLAG_MAX, takesStepFlag } from '../../physics/optimizer.js';
import { minmaxType, argwaveType } from './channelTypes.js';

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
    'PPEF',              // peak-to-peak error against a measured curve, dB
];

export const QUALIFIER_CMPS = ['ge', 'le', 'eq', 'between'];

// Sensible `eq` tolerance default per kind, expressed in the kind's NATIVE unit
// (fraction for T/R/A specs, nm for wavelength/thickness, count for layer
// count, dB for a peak-to-peak error). A single 0.01 default is right for optical specs (= 1 %) but is
// nonsensically tight for nm kinds (0.01 nm on a central-wavelength spec), so
// the tolerance follows the kind.
const TOL_BY_KIND = {
    CENTRAL_LAMBDA:   1.0,   // nm
    FWHM:             2.0,   // nm
    EDGE_LAMBDA:      1.0,   // nm
    THICKNESS_BUDGET: 10.0,  // nm
    LAYER_COUNT:      0,     // exact integer count
    PPEF:             0.05,  // dB
};

export function defaultTolForKind(kind) {
    return TOL_BY_KIND[kind] ?? 0.01;  // fraction = 1 % for T/R/A
}

// The tolerance an equality check is held to: its tol when above 0, else none.
// The check (format.js) and the rows Generate MF writes for it (mfOperands.js)
// both read it here, so a negative entry is an exact target to both.
export function eqTolerance(qual) {
    return Number.isFinite(qual?.tol) && qual.tol > 0 ? qual.tol : 0;
}

// The Step a MIN_MAX or CENTRAL_LAMBDA check searches its band at, as the flag
// of a merit row of `type`: 1 to EXTREMUM_FLAG_MAX, a step of 10^(1 − flag) nm,
// and none the default 1 nm. Only a row that looks for a peak takes a flag
// (takesStepFlag); a dip is searched on the design's fringe grid. The check
// (evaluate.js) and the row Generate MF writes for it (mfOperands.js) both read
// it here, so the two search the same grid.
export function checkStepFlag(qual, type) {
    const flag = qual?.flag;
    const valid = Number.isInteger(flag) && flag >= 1 && flag <= EXTREMUM_FLAG_MAX;
    return valid && takesStepFlag({ type, pol: qual.pol }) ? { flag } : {};
}

// The kinds that add up the layers of one side of the part, or of both.
export const SIDE_KINDS = ['THICKNESS_BUDGET', 'LAYER_COUNT'];

// The side such a check adds up: 'front', 'back' or 'both'. A check saved
// without one reads both: the front and the back the design is evaluated with.
export function budgetSide(qual) {
    return qual?.side === 'front' || qual?.side === 'back' ? qual.side : 'both';
}

// The coating a design's TT row sums, as a side (evalCore/evalContext.js
// fullThicks): the front on a front-only or symmetric design, the back on a
// back-only one, both when both sides are given. A new thickness budget or
// layer count starts at it.
export function coatedSide(design) {
    const mode = design?.surfaceMode || 'front_only';
    if (mode === 'back_only') return 'back';
    return mode === 'both_independent' ? 'both' : 'front';
}

// The side field a check of `kind` starts with when it is added, or when a row
// is switched to that kind: the side `design` coats, for a thickness budget or
// layer count that names none yet (`current`).
export function startingSide(kind, design, current) {
    return SIDE_KINDS.includes(kind) && current == null ? { side: coatedSide(design) } : {};
}

// Whether a check has a Step to set: a MIN_MAX or CENTRAL_LAMBDA check whose
// row looks for a peak.
export function checkTakesStep(qual) {
    const ch = qual?.channel || 'T';
    const type = qual?.kind === 'MIN_MAX' ? minmaxType(ch, qual.direction)
        : qual?.kind === 'CENTRAL_LAMBDA' ? argwaveType(qual.direction, ch, qual.pol)
        : null;
    return !!type && takesStepFlag({ type, pol: qual.pol });
}
