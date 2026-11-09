/**
 * A row's Step, the editor's Flag column: the step a band row is sampled at and
 * a row that looks for a peak searches at.
 *
 * Flags 1 to EXTREMUM_FLAG_MAX are a step of 10^(1 − flag) nm: 1 nm, 0.1 nm,
 * 0.01 nm and 0.001 nm. A negative flag is a step typed in nm, −flag, as -2
 * for 2 nm or -0.25 for 0.25 nm, no finer than FINEST_STEP_NM. Step 0 on a
 * band row is its automatic grid, from the design's fringes and no coarser than
 * AVG_STEP_NM (operandModel.js). The finest step is the grid the design
 * contests check entries on for leaks (Tilsch and Hendrix, Appl. Opt. 47, C55
 * (2008)); one level finer would be ten thousand samples per nanometre of band.
 */

export const EXTREMUM_FLAG_MAX = 4;
export const FINEST_STEP_NM = 10 ** (1 - EXTREMUM_FLAG_MAX);

// The step, nm, a flag sets (above), or null for 0, none, or a flag that is
// none of these.
export function flagStepNm(flag) {
    if (Number.isInteger(flag) && flag >= 1 && flag <= EXTREMUM_FLAG_MAX) return 10 ** (1 - flag);
    return Number.isFinite(flag) && flag <= -FINEST_STEP_NM ? -flag : null;
}

// The step, nm, a band-extremum row that looks for a peak of T, 1 − R or A
// searches its band at: its flag's step, 1 nm without one. The step decides
// only whether peaks closer than a few steps are told apart: the peak found is
// located far finer than the step (evalCore/bandExtremum.js).
export function extremumStepNm(op) {
    return flagStepNm(op?.flag) ?? 1;
}

// The step, nm, a band row (isBandGridRow) is sampled at: exactly its flag's
// step; null at Step 0, whose grid comes from the design's fringes, no coarser
// than AVG_STEP_NM. A cavity's pass band is about a fringe divided by the
// cavity's finesse wide, so the fringe grid can step over it; a step is how a
// row asks for a grid finer than the pass band, or for a lighter one than the
// fringes of a thick coating, which the optimizer can then move between
// samples.
export function bandFlagStepNm(op) {
    return flagStepNm(op?.flag);
}

// Samples the band row's flag asks for over its band, 0 at Step 0.
export function bandFlagCount(op) {
    const step = bandFlagStepNm(op);
    if (step == null) return 0;
    const width = Math.abs((op.lambdaEnd ?? op.lambdaStart) - op.lambdaStart);
    return Math.ceil(width / step) + 1;
}

// The fewest samples a band row's own step allows: its count (bandFlagCount),
// and at least the band's two ends; 0 at Step 0, which has none.
export function bandStepFloor(op) {
    const count = bandFlagCount(op);
    return count > 0 ? Math.max(2, count) : 0;
}
