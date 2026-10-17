import { isConstraint, isLinearThickness, isManufacturability, isMinmax, isMinType, isMeasuredCurve, isMath, isMathPairRef, isMathSingleRef, isInequality, isArgwave, isPPEF, isRamp, isGroupDelayFlat, isWrappedAngle, logSigma, logUnit } from '../operandModel.js';
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
//     RMS, TIW/RIW/AIW, TMN…AMX) → every PURE-OPTICAL merit function is
//     numerically UNCHANGED (no regression on existing designs).
//   • Math rows: the σ of the rows they read (residualScaleIn).
//   • Argwave (λ in nm): σ = ARGWAVE_RESIDUAL_SCALE_NM. With 500, a 5 nm peak/
//     edge miss weighs the same as a 1 % optical miss.
//   • dB and optical-density rows (TDB…ODMN): σ = 10/ln 10 dB and 1/ln 10, so
//     a miss scores ln of the ratio it stands for in T or R, the same number a
//     T row gives for a small miss near T = 1 (logReadings.js).
//   • Manufacturability operands (MNT/MXT/TT in nm, STR in N/m) DELIBERATELY
//     stay σ = 1 ("hard"): a violated manufacturing bound should dominate and
//     be fixed first, not be softened to optical scale.
//
// Applied in exactly two chokepoints — calcMF (the reported MF) and
// DLSOptimizer._residuals (the LM step). The analytic Jacobian stays consistent
// with it because every row builder divides its derivative by the same
// operandResidualScale(op): that is what lets the σ ≠ 1 operands with a worked-
// out chain rule (Ψ, Δ, phase, GD, GDD, TOD, MXW*/MNW*) take analytic rows. The
// operands with no chain rule, math rows and EFMX, force the FD fallback, which
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
// The dB and density rows: σ = 10/ln 10 ≈ 4.343 dB and 1/ln 10 ≈ 0.4343, which
// scores a miss as ln of the ratio it stands for in T or R (logReadings.js).
function _channelScale(channel) {
    const unit = logUnit(channel);
    return unit ? logSigma(unit) : PHASE_RESIDUAL_SCALE[channel] ?? 1;
}

export function operandResidualScale(op) {
    if (isArgwave(op.type)) return ARGWAVE_RESIDUAL_SCALE_NM;
    // A peak-to-peak error is in dB and takes the dB rows' scale.
    if (isPPEF(op.type)) return logSigma('dB');
    // A measured block scores in its channel's unit: degrees for a Ψ or Δ
    // snapshot, dB for a T-in-dB one, a fraction for a photometric one. Its
    // expansion carries the same scale per point, so the two forms stay equal.
    if (isMeasuredCurve(op.type)) return _channelScale(op.quantity);
    return _channelScale(op.type);
}

// A math row's σ is the scale of the unit its value is in, read through the
// rows it refers to, so a row reading one other row scores a miss exactly as
// that row would with the same target. OpticStudio's math operands behave the
// same way, there because every value keeps its own unit. DIFF and SUMM of two
// rows scored on the same σ take it; two different σ share no scale, and σ
// stays 1. PROD takes σ₁·σ₂, the scale of the product. A reference that cannot
// be followed, to a deleted row or round a loop, gives 1: such a row has no
// value anyway. `walk` holds the rows by id, the math rows being followed and
// the σ already found, so a chain that reads a row twice reads it once.
function _mathResidualScale(op, walk) {
    if (walk.found.has(op.id)) return walk.found.get(op.id);
    if (walk.path.has(op.id)) return 1;
    walk.path.add(op.id);
    const sigma = _ownMathScale(op, walk);
    walk.path.delete(op.id);
    walk.found.set(op.id, sigma);
    return sigma;
}

function _ownMathScale(op, walk) {
    if (isMathSingleRef(op.type)) return _singleRefScale(op, walk);
    if (!isMathPairRef(op.type)) return 1;
    const first = _scaleOfRow(op.refId1, walk);
    const second = _scaleOfRow(op.refId2, walk);
    if (op.type === 'PROD') return first * second;
    return first === second ? first : 1;
}

function _scaleOfRow(id, walk) {
    const row = walk.rowsById.get(id);
    if (!row) return 1;
    return isMath(row.type) ? _mathResidualScale(row, walk) : operandResidualScale(row);
}

function _singleRefScale(op, walk) {
    // An OPGT or OPLT saved before references existed names the row it reads
    // by type, and is evaluated as that row.
    if (isInequality(op.type) && !op.refId && op.baseType) return operandResidualScale({ ...op, type: op.baseType });
    return _scaleOfRow(op.refId, walk);
}

/**
 * The unit scale σ of each row of `operands`, as `op => σ`. A math row's σ is
 * read through the rows it refers to, which is why it needs the whole list.
 */
export function residualScaleIn(operands) {
    let walk = null;
    return (op) => {
        if (!isMath(op.type)) return operandResidualScale(op);
        walk ??= { rowsById: new Map(operands.map(row => [row.id, row])), path: new Set(), found: new Map() };
        return _mathResidualScale(op, walk);
    };
}

// Comparison residual for the linear-thickness rows (TT in nm, STR in N/m):
// ≤/≥ give a penalty (0 when satisfied); default (eq) is a two-sided equality
// residual (value − target).
function _comparisonResidual(op, val) {
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

// Constraints and worst-case min/max: satisfied on the ≥ target side for MNT
// and a min type, on the ≤ target side otherwise.
function _boundResidual(op, val) {
    const lowerBound = op.type === 'MNT' || isMinType(op.type);
    return lowerBound ? Math.max(0, op.target - val) : Math.max(0, val - op.target);
}

// Per-kind residual, first match wins; anything else is _targetResidual.
const RESIDUAL_KINDS = [
    [op => isLinearThickness(op.type), _comparisonResidual],
    // A peak-to-peak error is a specification ceiling.
    [op => isPPEF(op.type), (op, val) => Math.max(0, val - op.target)],
    [op => isConstraint(op.type) || isMinmax(op.type), _boundResidual],
    [op => isMath(op.type), mathResidual],
    // Ramp (TGT/RGT/AGT), measured blocks and GD/GDD flatness already carry
    // their RMS deviation.
    [op => isRamp(op) || isMeasuredCurve(op.type) || isGroupDelayFlat(op.type), (op, val) => val],
];

// Per-operand merit residual (before unit normalization). Constraints (MNT/MXT)
// and worst-case min/max are one-sided penalties (0 when satisfied); math
// operands defer to mathResidual (one- or two-sided by kind); ramp AND group-
// delay-flatness operands already carry their RMS deviation (target baked in);
// phase shifts and Δ are taken the short way round the circle; everything else
// is two-sided (value − target). SINGLE SOURCE OF TRUTH for the residual —
// shared by calcMF (the reported/accepted merit) and the LSQ engine's residual
// vector (the step direction), so the two can never disagree.
export function _operandResidual(op, val) {
    const hit = RESIDUAL_KINDS.find(([test]) => test(op));
    return hit ? hit[1](op, val) : _targetResidual(op, val);
}

// opts.skipConstraints — exclude MNT/MXT penalties. Used by the needle/GE
// synthesis scans, whose virtual probe layers are intentionally sub-floor;
// the thickness bound is enforced by dMin insertion + post-insert DLS refine
// (which keeps the penalty) + cleanupLayers pruning, not by the scan gradient.
// Normalized per-operand merit residual, or null to skip (a constraint dropped
// by skipConstraints). MNT/MXT, TT and STR are manufacturability rows —
// excluded from the synthesis-scan / OMF merit so they never distort needle
// placement; active during DLS refinement only. Otherwise the raw residual is
// divided by the row's unit scale `sc` (residualScaleIn), which makes it
// dimensionless (σ = 1 for optical → no change; argwave nm residual ÷ σ_λ).
// It may return a non-finite value, which the caller guards.
export function _meritDiff(op, computedI, skipConstraints, sc) {
    if (skipConstraints && isManufacturability(op.type)) return null;
    let diff = _operandResidual(op, computedI);
    if (sc !== 1) diff /= sc;
    return diff;
}
