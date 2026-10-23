/**
 * Qualifier kinds, comparator kinds, the default equality tolerance per kind,
 * the Step a check reads its band at, and the side a thickness budget or layer
 * count adds up.
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

// A check's Step as operand fields: its `flag`, 1 to EXTREMUM_FLAG_MAX, or
// none for the default.
function ownFlag(qual) {
    const flag = qual?.flag;
    return Number.isInteger(flag) && flag >= 1 && flag <= EXTREMUM_FLAG_MAX ? { flag } : {};
}

// A check's Step as the flag of the merit row of `type` it reads, the row
// Generate MF writes for it. On a row that looks for a peak it is the search
// step, 10^(1 − flag) nm, none being 1 nm; on a band row (an average or an
// integral) the coarsest step of its grid, none being the design's fringe
// grid. A row that looks for a dip takes none (takesStepFlag). The check
// (evaluate.js) and the row (mfOperands.js) both read it here, so the two read
// the same grid.
export function checkStepFlag(qual, type) {
    return takesStepFlag({ type, pol: qual?.pol }) ? ownFlag(qual) : {};
}

// The Step a FWHM or edge check scans its band at and searches its peak at, as
// operand fields; none is 1 nm. These checks have no merit row.
export function scanStepFlag(qual) {
    return ownFlag(qual);
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

// What a check's Step sets, or null for a check that has none: 'peak', the
// step a Min / Max or Central λ check on a peak searches at; 'scan', the step a
// FWHM or edge check scans at; 'band', the coarsest grid step of an average or
// integral check. A point, dip, thickness, layer count or PPEF check has none.
export function checkStepKind(qual) {
    const kind = qual?.kind;
    if (kind === 'FWHM' || kind === 'EDGE_LAMBDA') return 'scan';
    if (kind === 'INTEGRAL' || kind === 'T_AVG' || kind === 'R_AVG' || kind === 'A_AVG') return 'band';
    const ch = qual?.channel || 'T';
    const type = kind === 'MIN_MAX' ? minmaxType(ch, qual.direction)
        : kind === 'CENTRAL_LAMBDA' ? argwaveType(qual.direction, ch, qual.pol)
        : null;
    return type && takesStepFlag({ type, pol: qual.pol }) ? 'peak' : null;
}

// The flags a check's Step control offers beside none (checkStepKind): 1 to 4
// on an average or integral check, whose none is the design's fringe grid; 2
// to 4 on a peak, centre, FWHM or edge check, whose none is already the 1 nm
// of flag 1. None on a check that has no Step.
export function stepFlags(qual) {
    const kind = checkStepKind(qual);
    if (!kind) return [];
    return kind === 'band' ? [1, 2, 3, 4] : [2, 3, 4];
}

// Whether a check's own Step reads its band otherwise than its default step
// does: a peak, centre, FWHM or edge check finer than 1 nm, or an average or
// integral check with any Step, its default being the design's fringe grid.
export function hasOwnStep(qual) {
    const kind = checkStepKind(qual);
    const flag = ownFlag(qual).flag;
    return !!kind && flag != null && (kind === 'band' || flag > 1);
}
