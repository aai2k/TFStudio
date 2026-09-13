import { isConstraint, isTotalThickness, isMinmax, isMinType, isMeasuredCurve, isMath, isArgwave, isPhase, isRamp, isGroupDelayFlat, isWrappedAngle } from '../operandModel.js';
import { mathResidual } from './mathOperands.js';
import { _normalizeDegrees } from './angles.js';

// ── Residual unit normalization (mixed-unit merit functions) ──────────────────
//
// Operands of different units share ONE weighted-RMS merit function. Optical
// T/R/A residuals are fractions in ~[0, 1]; argwave (MXW*/MNW*) residuals are
// in NANOMETRES. Without normalization a 10 nm wavelength miss (residual 10)
// dwarfs a 1 % optical miss (residual 0.01) no matter how the weights are set,
// so the optimizer effectively ignores the optical targets.
//
// Fix: divide each residual by a per-type characteristic scale σ before the
// weighted RMS, making the MF a dimensionless χ²-style sum (Press et al.,
// *Numerical Recipes*, §15.1 — normalized least squares) so `weight` is pure
// importance and units stop competing:
//
//     MF² = Σ wᵢ·(residualᵢ / σᵢ)² / Σ wᵢ
//
//   • σ = 1 for every fraction-unit operand (T/R/A, TAV/RAV/AAV, TGT/RGT/AGT
//     RMS, TIW/RIW/AIW, TMN…AMX, math) → every PURE-OPTICAL merit function is
//     numerically UNCHANGED (no regression on existing designs).
//   • Argwave (λ in nm): σ = ARGWAVE_RESIDUAL_SCALE_NM. With 500, a 5 nm peak/
//     edge miss weighs the same as a 1 % optical miss.
//   • Thickness operands (MNT/MXT/TT) DELIBERATELY stay σ = 1 (raw nm, "hard"):
//     a violated manufacturing bound should dominate and be fixed first, not be
//     softened to optical scale.
//
// Applied in exactly two chokepoints — calcMF (the reported MF) and
// DLSOptimizer._residuals (the LM step). The analytic Jacobian stays consistent
// with it because every row builder divides its derivative by the same
// operandResidualScale(op): that is what lets the σ ≠ 1 operands with a worked-
// out chain rule (Ψ, Δ, phase, GD, GDD, TOD) take analytic rows. The operands
// with no chain rule, argwave among them, force the FD fallback instead, which
// differences _residuals and therefore inherits σ automatically. Either way the
// gradient matches the residual. A new σ ≠ 1 operand needs its row builder to
// carry the same division.
//
// TO REVERT to the old raw-nm behavior: set ARGWAVE_RESIDUAL_SCALE_NM = 1
// (or make operandResidualScale always return 1 to disable normalization
// entirely). Nothing else depends on it.
export const ARGWAVE_RESIDUAL_SCALE_NM = 500;
// Per-type characteristic scale for the phase/field operands (mixed units — see
// the block above). Chosen so a "typical acceptable miss" weighs like a ~1 %
// optical miss when these are combined with T/R/A in one merit function; `weight`
// then stays pure importance. Tunable — none of the math depends on the exact
// numbers, and a phase-only merit (all one unit) is insensitive to them.
//   Ψ → 10 ; Δ → 20 : ten times what a spectroscopic ellipsometer repeats to,
//   about 0.01° in Ψ and 0.02° in Δ (Fujiwara, Spectroscopic Ellipsometry:
//   Principles and Applications, Wiley 2007), the way 1 % is about ten times
//   what a spectrophotometer repeats to. A fit to a measured Ψ/Δ pair and a
//   fit to a measured R curve of the same quality then score alike, and
//   neither buries the other when the two share a table. The ranges, 90° and
//   360°, are not the right scale: an instrument resolves a tiny fraction of
//   either, and a residual scaled by the range weighs a real Δ miss at half a
//   Ψ miss of the same size for no physical reason.
//   Phase → 180 ; tanΨ/cosΔ/|E|² are O(1) → 1 ; GD → 50 fs ; GDD → 50 fs².
const PHASE_RESIDUAL_SCALE = {
    PSI: 10, DEL: 20, TANPSI: 1, COSDEL: 1,
    PR: 180, PT: 180, DPR: 180, DPT: 180,
    GD: 50, GDT: 50, GDFLAT: 50, GDTFLAT: 50,
    GDD: 50, GDDT: 50, GDDFLAT: 50, GDDTFLAT: 50,
    TOD: 500, TODT: 500, TODFLAT: 500, TODTFLAT: 500,
    EFMX: 1,
};
export function operandResidualScale(op) {
    if (isArgwave(op.type)) return ARGWAVE_RESIDUAL_SCALE_NM;
    if (isPhase(op.type))   return PHASE_RESIDUAL_SCALE[op.type] ?? 1;
    // A measured block scores in its channel's unit: degrees for a Ψ or Δ
    // snapshot, a fraction for a photometric one. Its expansion carries the
    // same scale per point, so the two forms stay equal.
    if (isMeasuredCurve(op.type)) return PHASE_RESIDUAL_SCALE[op.quantity] ?? 1;
    return 1;
}

// One-sided total-thickness residual: ≤/≥ give a penalty (0 when satisfied);
// default (eq) is a two-sided equality residual (total − target, nm).
function _ttResidual(op, val) {
    if (op.cmp === 'le') return Math.max(0, val - op.target);
    if (op.cmp === 'ge') return Math.max(0, op.target - val);
    return val - op.target;
}

// Two-sided miss against the operand's target; phase shifts and Δ are taken the
// short way round the circle.
function _targetResidual(op, val) {
    if (isWrappedAngle(op.type)) return _normalizeDegrees(val - op.target);
    return val - op.target;
}

// Per-operand merit residual (before unit normalization). Constraints (MNT/MXT)
// and worst-case min/max are one-sided penalties (0 when satisfied); math
// operands defer to mathResidual (one- or two-sided by kind); ramp AND group-
// delay-flatness operands already carry their RMS deviation (target baked in);
// phase shifts and Δ are taken the short way round the circle; everything else
// is two-sided (value − target). SINGLE SOURCE OF TRUTH for the residual —
// shared by calcMF (the reported/accepted merit) and the LSQ engine's residual
// vector (the step direction), so the two can never disagree.
export function _operandResidual(op, val) {
    if (isTotalThickness(op.type)) return _ttResidual(op, val);
    if (isConstraint(op.type) || isMinmax(op.type)) {
        // Satisfied on the ≥target side for MNT / min-type, ≤target side otherwise.
        const lowerBound = op.type === 'MNT' || isMinType(op.type);
        return lowerBound ? Math.max(0, op.target - val) : Math.max(0, val - op.target);
    }
    if (isMath(op.type)) return mathResidual(op, val);
    // Ramp (TGT/RGT/AGT) and GD/GDD flatness already carry their RMS deviation.
    if (isRamp(op) || isMeasuredCurve(op.type) || isGroupDelayFlat(op.type)) return val;
    return _targetResidual(op, val);
}

// opts.skipConstraints — exclude MNT/MXT penalties. Used by the needle/GE
// synthesis scans, whose virtual probe layers are intentionally sub-floor;
// the thickness bound is enforced by dMin insertion + post-insert DLS refine
// (which keeps the penalty) + cleanupLayers pruning, not by the scan gradient.
// Normalized per-operand merit residual, or null to skip (a constraint dropped
// by skipConstraints). TT and MNT/MXT are manufacturability constraints —
// excluded from the synthesis-scan / OMF merit so they never distort needle
// placement; active during DLS refinement only. Otherwise the raw residual is
// normalized to dimensionless units (σ = 1 for optical → no change; argwave nm
// residual ÷ σ_λ; see operandResidualScale). May return a non-finite value —
// the caller guards it.
export function _meritDiff(op, computedI, skipConstraints) {
    if (skipConstraints && (isTotalThickness(op.type) || isConstraint(op.type))) return null;
    let diff = _operandResidual(op, computedI);
    const sc = operandResidualScale(op);
    if (sc !== 1) diff /= sc;
    return diff;
}
