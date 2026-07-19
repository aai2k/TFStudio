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
// Blank/comment operand — inert (contributes nothing to the merit function).
// Carries a free-text `comment`; used to annotate the MF table.
export const BLANK_OPERAND_TYPES = ['BLNK'];
// Weighted-integral operands: T̄_w / R̄_w / Ā_w = Σ w_i·C_i / Σ w_i, where
// w(λ) = Source(λ) · Detector(λ). Operand carries `source` and `detector` specs
// (see spectralWeightings.js). Target is the spec value the average should hit.
export const INTEGRAL_OPERAND_TYPES   = ['TIW', 'RIW', 'AIW'];
// Worst-case (minmax) operands using a smooth surrogate (log-sum-exp p-norm).
// TMN/RMN/AMN: soft-min over the band — for "T ≥ target" worst-case specs.
// TMX/RMX/AMX: soft-max over the band — for "R ≤ target" worst-case specs.
// `op.pNorm` (default 50) controls sharpness; higher = closer to the true
// min/max but stiffer for DLS.
export const MINMAX_OPERAND_TYPES     = ['TMN', 'RMN', 'AMN', 'TMX', 'RMX', 'AMX'];
// ── Phase / field operands ────────────────────────────────────────────────────
// Quantities derived from the complex amplitude coefficients or the internal
// field — NOT fractions in [0,1]. They carry physical units, so they force the
// finite-difference Jacobian (their analytic chain rule is not worked out) and
// get a per-type residual scale (operandResidualScale) rather than σ=1.
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
export const GROUPDELAY_OPERAND_TYPES   = ['GD', 'GDD', 'GDFLAT', 'GDDFLAT'];
export const EFIELD_OPERAND_TYPES        = ['EFMX'];
export const PHASE_OPERAND_TYPES = [
    ...ELLIPSOMETRY_OPERAND_TYPES, ...GROUPDELAY_OPERAND_TYPES, ...EFIELD_OPERAND_TYPES,
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
    ...INTEGRAL_OPERAND_TYPES,
    ...MINMAX_OPERAND_TYPES,
    ...PHASE_OPERAND_TYPES,
    ...INEQUALITY_OPERAND_TYPES,
    ...MATH_OPERAND_TYPES,
    ...ARGWAVE_OPERAND_TYPES,
    ...TOTAL_THICKNESS_OPERAND_TYPES,
    ...CONSTRAINT_OPERAND_TYPES,
    ...BLANK_OPERAND_TYPES,
];
export const OPERAND_POLS  = ['avg', 's', 'p'];

export function isConstraint(type) { return type === 'MNT' || type === 'MXT'; }
export function isDmfs(type)       { return type === 'DMFS'; }
export function isBlank(type)      { return type === 'BLNK'; }
export function isTotalThickness(type) { return type === 'TT'; }
export function isRangeTarget(type) { return RANGE_TARGET_OPERAND_TYPES.indexOf(type) >= 0; }
export function isIntegral(type)   { return type === 'TIW' || type === 'RIW' || type === 'AIW'; }
export function isMinmax(type)     { return MINMAX_OPERAND_TYPES.indexOf(type) >= 0; }
export function isMinType(type)    { return type === 'TMN' || type === 'RMN' || type === 'AMN'; }
export function isEllipsometry(type) { return ELLIPSOMETRY_OPERAND_TYPES.indexOf(type) >= 0; }
export function isGroupDelay(type)   { return GROUPDELAY_OPERAND_TYPES.indexOf(type) >= 0; }
// GD/GDD flatness operands whose value is already an RMS deviation from the flat
// target (residual = value, like a range-target ramp).
export function isGroupDelayFlat(type) { return type === 'GDFLAT' || type === 'GDDFLAT'; }
export function isEField(type)       { return type === 'EFMX'; }
export function isPhase(type)        { return isEllipsometry(type) || isGroupDelay(type) || isEField(type); }
export function isInequality(type) { return type === 'OPGT' || type === 'OPLT'; }
export function isArgwave(type)    { return ARGWAVE_OPERAND_TYPES.indexOf(type) >= 0; }
export function isArgwaveMin(type) { return type.startsWith('MNW'); }
// Math operand = any operand that REFERENCES another row instead of
// evaluating a TMM characteristic directly.  Includes OPGT/OPLT and the
// broader Zemax math family (OPVA / ABSO / ABGT / ABLT / DIFF / SUMM /
// PROD).  See MATH_REGISTRY below for per-operand semantics.
export function isMath(type)       { return isInequality(type) || MATH_OPERAND_TYPES.indexOf(type) >= 0; }
// Operands that take a SINGLE referenced row (op.refId).
export function isMathSingleRef(type) {
    return type === 'OPGT' || type === 'OPLT' || type === 'OPVA' ||
           type === 'ABSO' || type === 'ABGT' || type === 'ABLT';
}
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
export function isFractionalUnit(type) {
    if (!type) return false;
    // False for the non-fractional (nm / deg / fs / placeholder / inherited)
    // types; true for T/R/A optical, TAV/RAV/AAV, TGT/RGT/AGT, TMN…
    return !(
        isConstraint(type)                    // MNT/MXT in nm
        || isTotalThickness(type)             // TT in nm
        || isArgwave(type) || isPhase(type)   // MXWT/MNWT (nm), Ψ/Δ (deg), GD (fs), |E|²
        || isMath(type)                       // math = inherit (resolved separately)
        || isDmfs(type)                       // DMFS = placeholder
        || isBlank(type)                      // BLNK = comment placeholder
    );
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

export function polFromType(type) {
    // Skip the 'S'/'P' suffix interpretation for compound type codes whose
    // last letter is incidental (MNT/MXT/TMN/TMX/RMN/RMX/AMN/AMX/TIW/RIW/AIW
    // /math operands) or for argwave types (handled separately via argwavePolCode).
    const hasNoPol = isConstraint(type) || isDmfs(type) || isBlank(type) || isTotalThickness(type) ||
        isIntegral(type) || isMinmax(type) || isMath(type);
    if (hasNoPol) return null;
    if (isArgwave(type)) return argwavePolCode(type);
    if (type.endsWith('S')) return 's';
    if (type.endsWith('P')) return 'p';
    return null;
}

// Minimum band-sample count (floor). The actual default is density-based —
// see AVG_STEP_NM / bandSampleCount — so a band average / integral / worst-case
// is computed PRECISELY (fine grid) rather than from a sparse 13-point estimate.
export const AVG_POINTS = 13;
// Target spacing (nm) for band-sampled operands (TAV/RAV/AAV, TGT/RGT/AGT,
// TIW/RIW/AIW, TMN…AMX). ~1 nm matches a coating designer's spectral grid; the
// count is clamped to [AVG_POINTS, AVG_POINTS_MAX] so a 300 nm band → 301 pts
// and the DLS analytic-Jacobian cost per step stays bounded.
export const AVG_STEP_NM    = 2;
export const AVG_POINTS_MAX = 201;
// Density-based default sample count for a band-sampled operand: ⌈width/step⌉+1,
// clamped. `op.bandPoints` (if ≥2) overrides it. Argwave has its own dense
// default (ARGWAVE_DEFAULT_POINTS) and does not use this.
export function bandSampleCount(op) {
    const w = Math.abs((op.lambdaEnd ?? op.lambdaStart) - op.lambdaStart);
    const n = Math.round(w / AVG_STEP_NM) + 1;
    return Math.min(AVG_POINTS_MAX, Math.max(AVG_POINTS, n));
}
// Default band-sample count for argwave (argmax/argmin-λ) operands.  Used by
// makeOperand AND by qualifiers.js so the two paths agree by construction.
// 301 = 1 nm grid on a 300 nm band — parabolic peak refinement then lands
// the reported λ within ~0.05–0.1 nm of the true extremum, well below a
// coating designer's spec tolerance.  Coarser defaults (e.g. 21 pts =
// 15 nm spacing) were observed to land on different local peaks for
// designs with narrow features, producing a misleading mismatch between
// the Specification window and the equivalent MXWT operand in the MF.
export const ARGWAVE_DEFAULT_POINTS = 301;

// ── Operand factories ─────────────────────────────────────────────────────────
//
// Stamping policy: SEMANTIC fields (user intent) are persisted; implementation
// hyperparameters (sampling density, softmax sharpness, …) are NOT. The latter
// flow through runtime defaults at evaluation time — see operandSampleLambdas
// for bandPoints / rampPoints and evalOperand for pNorm.  This means bumping
// a default later upgrades every existing operand on disk automatically:
// nothing to remake, nothing to migrate.
//
// Persisted (semantic):  type, lambdaStart, lambdaEnd, aoi, pol, target,
//                        targetEnd, weight, baseType (OPGT/OPLT),
//                        source + detector (TIW/RIW/AIW).
// Runtime-defaulted:     bandPoints, rampPoints, pNorm.

export const PNORM_DEFAULT = 50;     // softmax sharpness for TMN/TMX-family

// Per-type physical default target for phase/field operands (degrees, fs, fs²,
// |E|²). EFMX/GD*/flat default to 0 so the residual monotonically minimizes the
// quantity until the user sets a specific target.
const PHASE_DEFAULT_TARGET = {
    PSI: 45, DEL: 180, TANPSI: 1, COSDEL: 0,
    GD: 0, GDD: 0, GDFLAT: 0, GDDFLAT: 0, EFMX: 0,
};

// Replace the RAV "+ Add" default (0.99, a fraction) with the phase operand's
// physical default. Fractions are meaningless for degrees / fs / fs² / |E|².
function seedPhaseTarget(base) {
    if (!isPhase(base.type)) return;
    if (Number.isFinite(base.target) && base.target !== 0.99) return;
    base.target = PHASE_DEFAULT_TARGET[base.type] ?? 0;
}

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
    // ── Semantic defaults (persisted) ────────────────────────────────────────
    // Source/detector for integral operands: without these the weighting
    // would silently fall back to E × flat = unity, changing the operand's
    // meaning. So we DO stamp these — they're part of the user's intent.
    if (isIntegral(base.type)) {
        if (!base.source)   base.source   = { id: 'D65' };
        if (!base.detector) base.detector = { id: 'photopic' };
    }
    // Math operands (OPGT/OPLT/OPVA/ABSO/ABGT/ABLT/DIFF/SUMM/PROD) reference
    // OTHER rows in the MF table by their stable `id`.  No default refId is
    // stamped — the UI / qualifiersToMFOperands sets it when the row is
    // created, since the right answer depends on which other operands exist.
    // Argwave: target is the user-facing λ-comparison threshold. Seed at band
    // midpoint so a brand-new operand isn't immediately reporting a huge
    // residual against target=0 (which it inherits from RAV's "+ Add" default).
    if (isArgwave(base.type)) {
        if (!Number.isFinite(base.target) || base.target === 0.99) {
            base.target = (base.lambdaStart + base.lambdaEnd) * 0.5;
        }
    }
    // Range-target (TGT/RGT/AGT): a per-λ target line. `target` is the value at
    // λStart, `targetEnd` the value at λEnd. When targetEnd is unset we make the
    // target FLAT (targetEnd = target) so a fresh range-target operand enforces a
    // constant level across the band until the user sets a ramp.
    if (isRangeTarget(base.type) && base.targetEnd == null) {
        base.targetEnd = base.target;
    }
    // Total-thickness (TT): target is in nm. A brand-new TT operand inherits the
    // 0.99 default from the RAV "+ Add" path, which is meaningless for nm — seed
    // a sensible non-zero nm target instead.
    if (isTotalThickness(base.type) && (!Number.isFinite(base.target) || base.target === 0.99)) {
        base.target = 1000;
    }
    seedPhaseTarget(base);
    // Blank/comment operand: keep a comment field, no numeric meaning.
    if (isBlank(base.type) && base.comment == null) base.comment = '';
    // ── Implementation hyperparameters NOT stamped ───────────────────────────
    // bandPoints, rampPoints, pNorm — runtime defaults via operandSampleLambdas
    // / evalOperand. This way a default change later automatically upgrades
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

export function makeConstraintOperand(overrides = {}) {
    return {
        id:          Math.random().toString(36).slice(2, 10),
        enabled:     true,
        type:        'MNT',
        lambdaStart: 1,
        lambdaEnd:   1,
        aoi:         0,
        pol:         'avg',
        target:      10,
        weight:      1.0,
        ...overrides
    };
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
