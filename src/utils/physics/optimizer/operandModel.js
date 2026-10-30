/**
 * Operand data model — type lists, type predicates, and operand factories.
 *
 * This module is a
 * dependency-free leaf: no imports, no coupling to the numerical core
 * (evaluation / DLS / scanners). `optimizer.js` re-exports the whole surface so
 * every existing importer is unchanged.
 *
 * Reference: H.A. Macleod, Thin-Film Optical Filters, 5th ed., Ch.13
 */

import {
    GENERATED_ONLY_OPERAND_TYPES, MEASURED_CURVE_OPERAND_TYPES, MEASURED_CURVE_QUANTITIES,
    hasFreeLevel, isEllipsometricMeasuredCurve, isEllipsometricQuantity, isMeasuredCurve,
    measuredCurveChannel, seedMeasuredCurve,
} from './measuredCurveType.js';

import {
    LOG_MINMAX_OPERAND_TYPES, LOG_OPERAND_TYPES, isLogOperand, logOperand,
} from './logReadings.js';

export {
    GENERATED_ONLY_OPERAND_TYPES, MEASURED_CURVE_OPERAND_TYPES, MEASURED_CURVE_QUANTITIES,
    hasFreeLevel, isEllipsometricMeasuredCurve, isEllipsometricQuantity, isMeasuredCurve,
    measuredCurveChannel,
};
export {
    LOG_MINMAX_OPERAND_TYPES, LOG_OPERAND_TYPES, LOG_READING_FLOOR, fractionFromLog,
    isLogOperand, isLogPoint, logOperand, logSigma, logSlopeOverSigma, logUnit, logValue,
    rowReading, rowReadingSlopeOverSigma,
} from './logReadings.js';

// ── Operand type lists ────────────────────────────────────────────────────────

// Polarization is chosen via the Pol column (op.pol = avg/s/p), NOT baked into
// the type code — so only base T/R/A (single-λ) + TAV/RAV/AAV (band average)
// remain. (The old s/p-suffixed variants TS/TP/RS/RP/AS/AP were removed; they
// still EVALUATE for backward compatibility with saved designs — polFromType
// reads their suffix — but they are no longer offered in the type dropdown.)
export const OPTICAL_OPERAND_TYPES    = ['T', 'TAV', 'R', 'RAV', 'A', 'AAV'];
// Continuous spectral-target operands: a per-wavelength target (flat or a
// linear ramp from `target` at λStart to `targetEnd` at λEnd) enforced as the
// RMS deviation of the spectrum from that target line, sampled at `rampPoints`.
// This is the dedicated home for "true continuous targets" (beamsplitter flat
// 50%, gradient ramps) — distinct from TAV/RAV/AAV, which are pure single-value
// BAND AVERAGES (one target = the average over the band). Code: {T|R|A}GT.
export const RANGE_TARGET_OPERAND_TYPES = ['TGT', 'RGT', 'AGT'];
// Total-thickness operand: value = Σ layer thicknesses (nm) over the active
// stack(s). Target is in nm; residual is two-sided (value − target).
export const TOTAL_THICKNESS_OPERAND_TYPES = ['TT'];
// Film-stress operand: value = Σ σ_l d_l over the coatings the evaluation mode
// holds, in N/m (= MPa·µm); with both faces coated the back one subtracts, and
// a coating on one face alone reads as it would on the front. That is the bending force
// per unit width of Klein 2001 Eq. (14); a target of 0 is his Eq. (34), the
// zero-deflection condition. Per-layer stress comes off the material record,
// never off the operand row.
export const STRESS_OPERAND_TYPES = ['STR'];
// Blank/comment operand — inert (contributes nothing to the merit function).
// Carries a free-text `comment`; used to annotate the MF table.
export const BLANK_OPERAND_TYPES = ['BLNK'];
// Weighted-integral operands: T̄_w / R̄_w / Ā_w = Σ w_i·C_i / Σ w_i, where
// w(λ) = Source(λ) · Detector(λ). Operand carries `source` and `detector` specs
// (see spectralWeightings.js). Target is the spec value the average should hit.
export const INTEGRAL_OPERAND_TYPES   = ['TIW', 'RIW', 'AIW'];
// Worst-case (minmax) operands: the true extremum over the band's sample grid,
// scored one-sided against the target.
// TMN/RMN/AMN: lowest value over the band, for "T ≥ target" worst-case specs.
// TMX/RMX/AMX: highest value over the band, for "R ≤ target" worst-case specs.
export const MINMAX_OPERAND_TYPES     = ['TMN', 'RMN', 'AMN', 'TMX', 'RMX', 'AMX'];
// T or R in dB and T as optical density (logReadings.js): TDB at one
// wavelength, and TDBMN, TDBMX, RDBMX and ODMN, which are worst-case rows like
// the ones above read on a logarithmic scale.
// Peak-to-peak error function against a measured-curve block, in dB: the
// spread of target dB − design dB over the block's points
// (evalCore/operands/ppef.js). It names its block by id in `refId` and is held
// at or below its target.
export const PPEF_OPERAND_TYPES = ['PPEF'];
export function isPPEF(type) { return type === 'PPEF'; }
// ── Phase / field operands ────────────────────────────────────────────────────
// Quantities derived from the complex amplitude coefficients or the internal
// field values are not fractions in [0,1]. They get a per-type residual scale
// (operandResidualScale) rather than σ=1. Phase, GD, GDD, and TOD have exact
// thickness derivatives; ellipsometry and EFMX retain the finite-difference
// fallback.
// Reference: Macleod, Thin-Film Optical Filters 5th ed., Ch.11 (ultrafast /
// GD/GDD) and Ch.16 (ellipsometry Ψ, Δ).
//   PSI/DEL     — ellipsometric Ψ, Δ (degrees), from ρ = r_p/r_s = tanΨ·e^{iΔ}.
//   TANPSI/COSDEL — the ellipsometer-native pair tanΨ, cosΔ (dimensionless).
//   GD/GDD      — reflection group delay (fs) / group-delay dispersion (fs²) at
//                 a single wavelength (op.lambdaStart).
//   GDFLAT/GDDFLAT — RMS deviation of GD/GDD from a flat target level across the
//                 band [λStart, λEnd] (chirped-mirror "GDD = const" spec).
//   EFMX        — peak normalized |E|² anywhere in the coating (laser-damage
//                 field control); minimized toward the target.
export const ELLIPSOMETRY_OPERAND_TYPES = ['PSI', 'DEL', 'TANPSI', 'COSDEL'];
export const PHASE_SHIFT_OPERAND_TYPES = ['PR', 'PT', 'DPR', 'DPT'];
export const GROUPDELAY_OPERAND_TYPES = [
    'GD', 'GDT', 'GDD', 'GDDT', 'TOD', 'TODT',
    'GDFLAT', 'GDTFLAT', 'GDDFLAT', 'GDDTFLAT', 'TODFLAT', 'TODTFLAT',
];
export const EFIELD_OPERAND_TYPES        = ['EFMX'];
export const PHASE_OPERAND_TYPES = [
    ...ELLIPSOMETRY_OPERAND_TYPES, ...PHASE_SHIFT_OPERAND_TYPES,
    ...GROUPDELAY_OPERAND_TYPES, ...EFIELD_OPERAND_TYPES,
];
export const CONSTRAINT_OPERAND_TYPES = ['MNT', 'MXT'];
// ── Zemax-style math operands ────────────────────────────────────────────────
// Reference: Zemax OpticStudio merit-function operand catalog (see
// `reference/zemax math operands.txt`).  Each math operand REFERENCES other
// rows in the MF table by their stable `id` (not by row number) so insert /
// delete preserves the link.  Targets are in the units of the *referenced*
// operand (T/R/A in [0,1] for optical, nm for argwave/constraint, etc.).
//
// Single-ref operands carry op.refId : string id of the referenced row.
// Two-ref operands carry op.refId1, op.refId2.
// Constants carry no ref.
//
// Residual semantics:
//   OPGT — one-sided: max(0, target − ref)              ("ref ≥ target")
//   OPLT — one-sided: max(0, ref − target)              ("ref ≤ target")
//   OPVA — two-sided equality: ref − target
//   ABGT — one-sided: max(0, target − |ref|)            ("|ref| ≥ target")
//   ABLT — one-sided: max(0, |ref| − target)            ("|ref| ≤ target")
//   ABSO / DIFF / SUMM / PROD — two-sided equality on the computed value
//
// Single-ref legacy shim: operands written by an earlier build with
// `op.baseType` (and embedded lambdaStart/End/aoi/pol) are still understood;
// they evaluate against a virtual operand built from those fields. New
// operands always use refId.
export const INEQUALITY_OPERAND_TYPES = ['OPGT', 'OPLT'];
// Other Zemax math operands (the full catalog also includes trig, log,
// range ops, factor ops).
export const MATH_OPERAND_TYPES       = ['OPVA', 'ABSO', 'ABGT', 'ABLT', 'DIFF', 'SUMM', 'PROD'];
// Argmax/argmin-wavelength operands. Sample C(λ) ∈ {T,R,A} over [λStart, λEnd]
// and return the λ (in nm) at which the band-max (MXW*) or band-min (MNW*)
// occurs, refined by a 3-point parabolic interpolation around the discrete
// extremum for sub-sample accuracy. Code layout: M{X|N}W{T|R|A}[S|P].
// Pol-suffix S/P is the existing s/p convention; no suffix = avg.
// Polarization is chosen via the operand's `pol` field (avg/s/p) using the MF
// table's Pol dropdown — NOT baked into the type code. (The old S/P-suffixed
// variants MXWTS/MXWTP/… were removed: one base type per channel + the Pol
// column covers every case without tripling the type list.)
export const ARGWAVE_OPERAND_TYPES    = [
    'MXWT', 'MXWR', 'MXWA',
    'MNWT', 'MNWR', 'MNWA',
];
export const OPERAND_TYPES = [
    ...OPTICAL_OPERAND_TYPES,
    ...RANGE_TARGET_OPERAND_TYPES,
    ...MEASURED_CURVE_OPERAND_TYPES,
    ...INTEGRAL_OPERAND_TYPES,
    ...MINMAX_OPERAND_TYPES,
    ...LOG_OPERAND_TYPES,
    ...PPEF_OPERAND_TYPES,
    ...PHASE_OPERAND_TYPES,
    ...INEQUALITY_OPERAND_TYPES,
    ...MATH_OPERAND_TYPES,
    ...ARGWAVE_OPERAND_TYPES,
    ...TOTAL_THICKNESS_OPERAND_TYPES,
    ...STRESS_OPERAND_TYPES,
    ...CONSTRAINT_OPERAND_TYPES,
    ...BLANK_OPERAND_TYPES,
];
export const OPERAND_POLS  = ['avg', 's', 'p'];

// Every type this build evaluates: the offered ones, the inert DMFS marker, and
// the s/p-suffixed TS to AP rows of older designs, which
// are no longer offered but still read their polarization from the suffix. A
// row of any other type, such as one saved by a newer TFStudio, is refused
// rather than scored by the first letter of its type.
const EVALUATED_OPERAND_TYPES = new Set([
    ...OPERAND_TYPES, 'DMFS', 'TS', 'TP', 'RS', 'RP', 'AS', 'AP',
]);
export function isKnownOperandType(type) { return EVALUATED_OPERAND_TYPES.has(type); }

export function isConstraint(type) { return type === 'MNT' || type === 'MXT'; }
export function isDmfs(type)       { return type === 'DMFS'; }
export function isBlank(type)      { return type === 'BLNK'; }
export function isTotalThickness(type) { return type === 'TT'; }
export function isStress(type)     { return type === 'STR'; }
// Manufacturability rows: what the coater can build rather than what the
// coating does optically. Their weight stays out of the merit's normalization
// denominator, they are dropped from the OMF and from the synthesis scans, and
// their value is linear in the layer thicknesses. One predicate so a new member
// cannot reach some of those places and miss the others.
export function isManufacturability(type) {
    return isConstraint(type) || isTotalThickness(type) || isStress(type);
}
// Rows whose value is a plain linear function of the layer thicknesses, scored
// against a target through a ≤ / ≥ / = comparison. Their analytic Jacobian row
// is the coefficient vector and their curvature is zero.
export function isLinearThickness(type) {
    return isTotalThickness(type) || isStress(type);
}
export function isRangeTarget(type) { return RANGE_TARGET_OPERAND_TYPES.indexOf(type) >= 0; }
export function isBandAverage(type) { return type === 'TAV' || type === 'RAV' || type === 'AAV'; }
export function isIntegral(type)   { return type === 'TIW' || type === 'RIW' || type === 'AIW'; }
// A worst-case row over a band, read linearly or on a logarithmic scale.
export function isMinmax(type) {
    return MINMAX_OPERAND_TYPES.includes(type) || LOG_MINMAX_OPERAND_TYPES.includes(type);
}
// A worst-case row taking the lowest value of its own scale, held at or above
// its target. For ODMN that is the lowest density, where T is highest.
export function isMinType(type) {
    return type === 'TMN' || type === 'RMN' || type === 'AMN' || logOperand(type)?.extremum === 'min';
}
export function isEllipsometry(type) { return ELLIPSOMETRY_OPERAND_TYPES.indexOf(type) >= 0; }
export function isPhaseShift(type) { return PHASE_SHIFT_OPERAND_TYPES.indexOf(type) >= 0; }
// Angles whose residual is taken the short way round the circle: a value of
// 359° against a target of 1° is two degrees off, not 358. Ψ cannot leave
// 0° to 90°, and tanΨ and cosΔ are plain numbers, so they are not here.
export function isWrappedAngle(type) { return isPhaseShift(type) || type === 'DEL'; }
export function isGroupDelay(type)   { return GROUPDELAY_OPERAND_TYPES.indexOf(type) >= 0; }
export function isPhaseDispersion(type) { return isPhaseShift(type) || isGroupDelay(type); }
// GD/GDD flatness operands whose value is already an RMS deviation from the flat
// target (residual = value, like a range-target ramp).
export function isGroupDelayFlat(type) { return type.endsWith('FLAT') && isGroupDelay(type); }
// Rows that sum or compare their samples over a band grid of their own:
// band averages, integrals, range targets and group-delay flatness rows. Their
// flag sets the coarsest step that grid may take (bandFlagStepNm).
export function isBandGridRow(type) {
    return isBandAverage(type) || isIntegral(type) || isRangeTarget(type) || isGroupDelayFlat(type);
}
export function isEField(type)       { return type === 'EFMX'; }
export function isPhase(type)        { return isEllipsometry(type) || isPhaseShift(type) || isGroupDelay(type) || isEField(type); }
export function isInequality(type) { return type === 'OPGT' || type === 'OPLT'; }
export function isArgwave(type)    { return ARGWAVE_OPERAND_TYPES.indexOf(type) >= 0; }
export function isArgwaveMin(type) { return type.startsWith('MNW'); }
const BAND_FAMILIES = [
    isBandAverage, isRangeTarget, isMinmax, isIntegral, isArgwave,
    isGroupDelayFlat, isMeasuredCurve,
];
// Does the operand read λEnd, i.e. does it span a wavelength band? Every other
// spectral operand is evaluated at λStart alone and ignores whatever λEnd it
// carries, so a row that changed type keeps a λEnd nothing looks at.
export function readsWavelengthBand(type) {
    return BAND_FAMILIES.some(inFamily => inFamily(type));
}
// Math operand = any operand that REFERENCES another row instead of
// evaluating a TMM characteristic directly.  Includes OPGT/OPLT and the
// broader Zemax math family (OPVA / ABSO / ABGT / ABLT / DIFF / SUMM /
// PROD).  See MATH_REGISTRY below for per-operand semantics.
export function isMath(type)       { return isInequality(type) || MATH_OPERAND_TYPES.indexOf(type) >= 0; }
// Operands that take a SINGLE referenced row (op.refId).
const SINGLE_REF_MATH_TYPES = new Set(['OPGT', 'OPLT', 'OPVA', 'ABSO', 'ABGT', 'ABLT']);
export function isMathSingleRef(type) { return SINGLE_REF_MATH_TYPES.has(type); }
// Operands that take TWO referenced rows (op.refId1, op.refId2).
export function isMathPairRef(type) {
    return type === 'DIFF' || type === 'SUMM' || type === 'PROD';
}
// Operand types whose VALUE is a fraction in [0, 1] (i.e. T/R/A). The UI
// scales these to percent for display + editing. Used to pick the right
// display unit for a math operand's `target` (math operands inherit the
// unit of their referenced row — an OPGT pointing at TAV stores its target
// as a fraction 0.99, but should READ "99 %" in the table to stay
// consistent with the TAV row it references).
// True for T/R/A optical, TAV/RAV/AAV, TGT/RGT/AGT, TMN…; false for the types
// below, whose values are in other units, inherited, or absent.
const NON_FRACTIONAL_TYPES = [
    isManufacturability,   // MNT/MXT/TT in nm, STR in N/m
    isArgwave, isPhase,    // MXWT/MNWT (nm), Ψ/Δ (deg), GD (fs), |E|²
    isLogOperand, isPPEF,  // dB, optical density
    isMath,                // math = inherit (resolved separately)
    isDmfs, isBlank,       // placeholders
];
export function isFractionalUnit(type) {
    return !!type && !NON_FRACTIONAL_TYPES.some(test => test(type));
}
// Does a math operand's target display in percent? True iff every one of
// its referenced rows has a fractional value. operandsById is a Map
// from id → operand. Falls back to false (raw) when refs can't be
// resolved or are themselves math (avoids deep chasing for a v1 fix).
export function mathTargetInPercent(op, operandsById) {
    if (!op || !isMath(op.type) || !operandsById) return false;
    const refOptical = (refId) => {
        const ref = operandsById.get?.(refId) ?? operandsById[refId];
        return !!(ref && isFractionalUnit(ref.type));
    };
    if (isMathSingleRef(op.type)) return refOptical(op.refId);
    if (isMathPairRef(op.type))   return refOptical(op.refId1) && refOptical(op.refId2);
    return false;
}
// Optical character (T|R|A) from an argwave type code.  Position 3 (zero-based)
// is the optical char by construction (M{X|N}W{T|R|A}[S|P]).
export function argwaveOpticalChar(type) { return type[3]; }
// Pol from an argwave type code's S/P suffix; null = use op.pol.
export function argwavePolCode(type) {
    if (type.endsWith('S')) return 's';
    if (type.endsWith('P')) return 'p';
    return null;
}

const TYPES_WITHOUT_POL_SUFFIX = [
    isManufacturability, isDmfs, isBlank, isIntegral, isMinmax, isMath, isLogOperand, isPPEF,
];

export function polFromType(type) {
    // Skip the 'S'/'P' suffix interpretation for compound type codes whose
    // last letter is incidental (MNT/MXT/TMN/TMX/RMN/RMX/AMN/AMX/TIW/RIW/AIW
    // /math operands) or for argwave types (handled separately via argwavePolCode).
    if (TYPES_WITHOUT_POL_SUFFIX.some(test => test(type))) return null;
    if (isArgwave(type)) return argwavePolCode(type);
    if (type.endsWith('S')) return 's';
    if (type.endsWith('P')) return 'p';
    return null;
}

// Fewest samples on a band row's grid (averages, integrals, range targets and
// flatness rows), whichever rule below sets it. On a thin coating the fringe
// grid alone gives 6 to 18 points, and a low reflectance averaged over so few
// reads several percent high: a 4-layer TiO2/MgF2 AR over 420-680 nm reads
// R avg 0.2477 % on 13 points and 0.2336 % on 101, against 0.2334 % dense. The
// trapezoid error falls as the square of the step, and 101 points keep a
// smooth band within about a thousandth of its value.
export const BAND_MIN_POINTS = 101;
// Fewest samples a band-extremum row starts its search from: the grid a row
// that looks for a dip searches, made finer on a thick coating
// (extremumGrid.js). The search refines the extremum it finds, so its grid
// only has to show it.
export const EXTREMUM_MIN_POINTS = 13;
// Nominal spacing (nm) for band averages, integrals and range targets when no
// design is at hand to set it: a 300 nm band gets 151 points. A run and the
// merit table replace it with fringeSampleCount for the design they evaluate
// (evalCore/fringeSampling.js).
export const AVG_STEP_NM = 2;
// Design-free default sample count: round(width / AVG_STEP_NM) + 1, never below
// BAND_MIN_POINTS, and never coarser than the row's flag asks (bandFlagCount).
// `op.bandPoints` / `op.rampPoints` (if ≥2) override it. Argwave and worst-case
// min/max operands search a grid of their own (extremumGrid.js) and do not use
// this.
export function bandSampleCount(op) {
    const w = Math.abs((op.lambdaEnd ?? op.lambdaStart) - op.lambdaStart);
    const n = Math.round(w / AVG_STEP_NM) + 1;
    return Math.max(BAND_MIN_POINTS, n, bandFlagCount(op));
}
// Samples per fringe period on a design-set band grid. Measured on fifteen
// random 80-layer TiO2/SiO2 stacks (about 9.4 µm) refined for 60 LM steps
// against TAV(400-1600): with 4 samples per period the band average on the
// grid ended up to 0.22 points away from the true one, with 6 up to 0.15, with
// 8 at most 0.09 and typically 0.01 (tests/band_sampling_fringe.mjs checks the
// first stack). Stacks this reflective have transmission resonances much
// narrower than the period, and those are what an optimizer parks between
// samples.
export const SAMPLES_PER_FRINGE = 8;
// Band-sample count that resolves the fringes of a coating whose group optical
// thickness at the band's short end is `groupThicknessNm` (nm). The fringe
// period there is Δλ = λ²/(2G) and the step is Δλ / SAMPLES_PER_FRINGE, so the
// count grows with the coating and has no upper limit: a merit sampled coarser
// than its fringes can be lowered by moving fringes between samples (Macleod,
// Thin-Film Optical Filters 5e, §3 automatic design, p. 94). Never below
// BAND_MIN_POINTS, and never coarser than the row's flag asks (bandFlagCount).
export function fringeSampleCount(op, groupThicknessNm) {
    const a = op.lambdaStart;
    const b = op.lambdaEnd ?? op.lambdaStart;
    const shortEnd = Math.min(a, b);
    const width = Math.abs(b - a);
    if (!(groupThicknessNm > 0) || !(shortEnd > 0) || !(width > 0)) return Math.max(BAND_MIN_POINTS, bandFlagCount(op));
    const step = (shortEnd * shortEnd) / (2 * groupThicknessNm * SAMPLES_PER_FRINGE);
    return Math.max(BAND_MIN_POINTS, Math.ceil(width / step) + 1, bandFlagCount(op));
}
// The step, nm, a band-extremum row that looks for a peak of T, 1 − R or A
// searches its band at: 10^(1 − flag) nm, so flag 1 is 1 nm, 2 is 0.1 nm, 3 is
// 0.01 nm and 4 is 0.001 nm. A row without a flag searches at 1 nm. The finest
// level is the grid the design contests check entries on for leaks (Tilsch and
// Hendrix, Appl. Opt. 47, C55 (2008)); one level finer would be ten thousand
// samples per nanometre of band. The flag decides only whether peaks closer
// than a few steps are told apart: the peak found is located far finer than
// the step (evalCore/bandExtremum.js).
export const EXTREMUM_FLAG_MAX = 4;
export function extremumFlag(op) {
    const flag = op?.flag;
    return Number.isInteger(flag) && flag >= 1 && flag <= EXTREMUM_FLAG_MAX ? flag : 1;
}
export function extremumStepNm(op) {
    return 10 ** (1 - extremumFlag(op));
}
// The coarsest step, nm, a band row (isBandGridRow) is sampled at: its flag read
// as a worst-case row's (1 nm to 0.001 nm), or null for a row without a flag,
// whose grid comes from the design's fringes, or AVG_STEP_NM with no design.
// A cavity's pass band is about a fringe divided by the cavity's finesse wide,
// so the fringe grid can step over it; the flag is how a row asks for a grid
// finer than the pass band.
export function bandFlagStepNm(op) {
    const flag = op?.flag;
    return Number.isInteger(flag) && flag >= 1 && flag <= EXTREMUM_FLAG_MAX ? 10 ** (1 - flag) : null;
}
// Samples the band row's flag asks for over its band, 0 without a flag.
export function bandFlagCount(op) {
    const step = bandFlagStepNm(op);
    if (step == null) return 0;
    const width = Math.abs((op.lambdaEnd ?? op.lambdaStart) - op.lambdaStart);
    return Math.ceil(width / step) + 1;
}

// ── Operand factories ─────────────────────────────────────────────────────────
//
// Stamping policy: SEMANTIC fields (user intent) are persisted; implementation
// hyperparameters such as the sampling density are NOT. The latter flow through
// runtime defaults at evaluation time; see operandSampleLambdas for bandPoints
// / rampPoints. This means bumping a default later upgrades every existing
// operand on disk automatically: nothing to remake, nothing to migrate.
//
// Persisted (semantic):  type, lambdaStart, lambdaEnd, aoi, pol, target,
//                        targetEnd, weight, baseType (OPGT/OPLT),
//                        source + detector (TIW/RIW/AIW).
// Runtime-defaulted:     bandPoints, rampPoints.

export function isValidMeritWeight(weight) {
    return Number.isFinite(weight) && weight >= 0;
}

// A math row without all of its source rows has no defined value, and neither
// has a PPEF row without its curve block. Removing a source therefore removes
// every directly or transitively dependent row.
export function removeOperandsAndDependents(operands, ids) {
    const removedIds = new Set(Array.isArray(ids) ? ids : [ids]);
    const referencesRows = type => isMath(type) || isPPEF(type);
    let previousSize;
    do {
        previousSize = removedIds.size;
        for (const op of operands) {
            if (!referencesRows(op.type) || removedIds.has(op.id)) continue;
            const references = [op.refId, op.refId1, op.refId2];
            if (references.some(id => removedIds.has(id))) removedIds.add(op.id);
        }
    } while (removedIds.size !== previousSize);
    return operands.filter(op => !removedIds.has(op.id));
}

// Per-type physical default target for phase/field operands (degrees, fs, fs²,
// |E|²). EFMX/GD*/flat default to 0 so the residual monotonically minimizes the
// quantity until the user sets a specific target.
const PHASE_DEFAULT_TARGET = {
    PSI: 45, DEL: 180, TANPSI: 1, COSDEL: 0,
    PR: 0, PT: 0, DPR: 0, DPT: 0,
    GD: 0, GDT: 0, GDD: 0, GDDT: 0, TOD: 0, TODT: 0,
    GDFLAT: 0, GDTFLAT: 0, GDDFLAT: 0, GDDTFLAT: 0,
    TODFLAT: 0, TODTFLAT: 0, EFMX: 0,
};

// Replace the RAV "+ Add" default (0.99, a fraction) with the phase operand's
// physical default. Fractions are meaningless for degrees / fs / fs² / |E|².
function seedPhaseTarget(base, overrides) {
    if (!isPhase(base.type)) return;
    const explicitTarget = Object.prototype.hasOwnProperty.call(overrides, 'target');
    if (explicitTarget && Number.isFinite(overrides.target)) return;
    base.target = PHASE_DEFAULT_TARGET[base.type] ?? 0;
}

// True while the target still holds the RAV "+ Add" default (0.99, a fraction)
// or nothing at all. A type whose target is a wavelength, a thickness or a
// force reads that value as its own unit and has to replace it.
function targetUnset(base) {
    return !Number.isFinite(base.target) || base.target === 0.99;
}

// Source/detector for integral operands: without these the weighting would
// silently fall back to E × flat = unity, changing the operand's meaning. So
// we DO stamp these — they're part of the user's intent.
function seedIntegralWeighting(base) {
    if (!base.source)   base.source   = { id: 'D65' };
    if (!base.detector) base.detector = { id: 'photopic' };
}

// Argwave: the target is the user-facing λ-comparison threshold. Seed at the
// band midpoint so a brand-new operand isn't immediately reporting a huge
// residual against a target of 0.
function seedArgwaveTarget(base) {
    if (targetUnset(base)) base.target = (base.lambdaStart + base.lambdaEnd) * 0.5;
}

// Range-target (TGT/RGT/AGT): a per-λ target line. `target` is the value at
// λStart, `targetEnd` the value at λEnd. When targetEnd is unset the target is
// FLAT, so a fresh range-target operand enforces a constant level across the
// band until the user sets a ramp.
function seedRangeTargetEnd(base) {
    if (base.targetEnd == null) base.targetEnd = base.target;
}

/** Total thickness (TT): a target in nm, so a fraction is meaningless. */
function seedTotalThicknessTarget(base) {
    if (targetUnset(base)) base.target = 1000;
}

// Film stress (STR): the target is a force per unit width in N/m, and the one
// value worth seeding is 0 — Klein's zero-deflection condition, which is what
// a user reaches for this operand to ask for.
function seedStressTarget(base) {
    if (targetUnset(base)) base.target = 0;
    if (base.cmp == null) base.cmp = 'eq';
}

// A dB or density target means nothing as the fractional default. Each type
// starts at a level that reads as a specification: 0 dB at a point, a 0.5 dB
// insertion-loss floor, a 30 dB isolation or return-loss ceiling, a density of
// 3. A PPEF row starts at 0 dB, so until a specification is typed in it keeps
// flattening.
const LOG_DEFAULT_TARGETS = { TDB: 0, TDBMN: -0.5, TDBMX: -30, RDBMX: -30, ODMN: 3, PPEF: 0 };
function seedLogTarget(base) {
    if (targetUnset(base)) base.target = LOG_DEFAULT_TARGETS[base.type];
}

// A DEL row records the sign of Δ it reads (`deltaConvention`): 'azzam', the
// Azzam-Bashara sign an ellipsometer writes and the Ellipsometry window shows,
// or 'reversed', 360° − that. A new row reads 'azzam'. A stored row without
// the field was written when every DEL row read 'reversed', and is evaluated
// that way so the design scores as it did.
function seedDeltaConvention(base) {
    const { deltaConvention = 'azzam' } = base;
    base.deltaConvention = deltaConvention;
}

/** Blank/comment operand: keep a comment field, no numeric meaning. */
function seedComment(base) {
    if (base.comment == null) base.comment = '';
}

// Per-family semantic seeding, first match wins. The families are disjoint, so
// the order here is documentation rather than precedence. Math operands
// (OPGT…PROD) are deliberately absent: their refId depends on which other rows
// exist, so the UI sets it when the row is created.
const TYPE_SEEDS = [
    [isIntegral,       seedIntegralWeighting],
    [isArgwave,        seedArgwaveTarget],
    [isRangeTarget,    seedRangeTargetEnd],
    [isTotalThickness, seedTotalThicknessTarget],
    [isStress,         seedStressTarget],
    [type => isLogOperand(type) || isPPEF(type), seedLogTarget],
    [isBlank,          seedComment],
    [type => type === 'DEL', seedDeltaConvention],
];

export function makeOperand(overrides = {}) {
    const base = {
        id:          Math.random().toString(36).slice(2, 10),
        enabled:     true,
        type:        'TAV',
        lambdaStart: 400,
        lambdaEnd:   700,
        aoi:         0,
        pol:         'avg',
        target:      0.99,
        targetEnd:   null,   // non-null → linear-ramp target from `target` (at λStart) to `targetEnd` (at λEnd)
        weight:      1.0,
        ...overrides
    };
    if (!isValidMeritWeight(base.weight)) base.weight = 1;
    // ── Semantic defaults (persisted) ────────────────────────────────────────
    seedMeasuredCurve(base);
    TYPE_SEEDS.find(([inFamily]) => inFamily(base.type))?.[1](base);
    seedPhaseTarget(base, overrides);
    // ── Implementation hyperparameters NOT stamped ───────────────────────────
    // bandPoints, rampPoints: runtime defaults via operandSampleLambdas. This
    // way a default change later automatically upgrades
    // every existing operand on disk; users never have to remake anything.
    return base;
}

// A ramp/range-target operand (TGT/RGT/AGT) enforces a per-wavelength target
// line (flat or linearly varying) across [λStart, λEnd]. Its merit
// contribution is the RMS deviation of the spectrum from that target line,
// sampled at `rampPoints` wavelengths. TAV/RAV/AAV are NOT ramps — they are
// pure single-value band averages (one target = the average over the band).
export function isRamp(op) {
    return op != null && isRangeTarget(op.type);
}

// Last layer a new thickness constraint covers. Layers are numbered from 1, and
// the end is deliberately far above any stack a user starts from, because
// synthesis adds layers and a constraint written for today's layer count would
// silently stop covering the ones it grows.
export const DEFAULT_CONSTRAINT_LAST_LAYER = 1000;

// Target, nm, of a new constraint row: a 10 nm floor for MNT, and for MXT the
// 1000 nm ceiling the merit wizard's thickness limits start at, so a row added
// by hand and one the wizard writes agree. A 10 nm ceiling would penalize
// nearly every layer of a real design.
const DEFAULT_CONSTRAINT_TARGET_NM = { MNT: 10, MXT: 1000 };

export function makeConstraintOperand(overrides = {}) {
    const type = overrides.type ?? 'MNT';
    const operand = {
        id:          Math.random().toString(36).slice(2, 10),
        enabled:     true,
        type,
        lambdaStart: 1,
        lambdaEnd:   1,
        aoi:         0,
        pol:         'avg',
        target:      DEFAULT_CONSTRAINT_TARGET_NM[type] ?? DEFAULT_CONSTRAINT_TARGET_NM.MNT,
        weight:      1.0,
        ...overrides
    };
    if (!isValidMeritWeight(operand.weight)) operand.weight = 1;
    return operand;
}

export function makeDefaultConstraints(type, layerStart, layerEnd, valueNm) {
    return [makeConstraintOperand({ type, lambdaStart: layerStart, lambdaEnd: layerEnd, target: valueNm })];
}

export function makeDmfsOperand(comment = '') {
    return {
        id:          Math.random().toString(36).slice(2, 10),
        type:        'DMFS',
        enabled:     true,
        comment,
        lambdaStart: 0, lambdaEnd: 0, aoi: 0, pol: 'avg', target: 0, weight: 1
    };
}
