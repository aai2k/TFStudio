/**
 * Qualifiers / Design Specifications.
 *
 * A *qualifier* is a single PASS/FAIL design requirement, e.g.
 *   "T at 550 nm ≥ 99 %",
 *   "Avg T over 400–700 nm ≥ 92 %",
 *   "Central λ of bandpass = 550 ± 10 nm",
 *   "FWHM ≤ 20 nm at 50 % of peak T",
 *   "Visible-weighted Tvis ≥ 90 %",
 *   "Total physical thickness ≤ 2000 nm",
 *   "Layer count ≤ 30".
 *
 * Each qualifier carries:
 *   - id, enabled
 *   - kind: one of QUALIFIER_KINDS (T_AT / T_AVG / R_AT / R_AVG / A_AT /
 *           A_AVG / CENTRAL_LAMBDA / FWHM / EDGE_LAMBDA / INTEGRAL /
 *           THICKNESS_BUDGET / LAYER_COUNT)
 *   - cmp: 'ge' | 'le' | 'eq' (with tol) | 'between' (lo, hi)
 *   - lambdaStart, lambdaEnd (depending on kind)
 *   - aoi, pol
 *   - target, tol, lo, hi
 *   - level — FWHM crossing fraction (0..1; default 0.5)
 *   - source, detector — for INTEGRAL kind only
 *
 * Evaluation strategy:
 *   For each qualifier we synthesize a temporary list of MF operands that
 *   compute the relevant scalar(s), reuse the validated
 *   evaluateOperands / buildEvalContext pipeline, then post-process the
 *   results into { value, pass, deviation, fail_message }. This keeps
 *   the qualifier window's math in lockstep with the optimizer's math —
 *   no second physics implementation to keep in sync.
 *
 * Wiring into MF (the "Generate MF from qualifiers" button):
 *   qualifiersToMFOperands(qualifiers, design) → operand list. Each
 *   qualifier converts to one or more OPGT/OPLT operands (12.2.1) so
 *   the optimizer is driven by inequality residuals that go to zero when
 *   the spec is satisfied. The Specification window writes the result
 *   into design.meritOperands.
 */

import {
    makeOperand, evaluateOperands, buildEvalContext, calcMF,
    AVG_POINTS, ARGWAVE_DEFAULT_POINTS,
} from '../physics/optimizer.js';

// ── Qualifier kinds ──────────────────────────────────────────────────────────

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
export function defaultTolForKind(kind) {
    switch (kind) {
        case 'CENTRAL_LAMBDA':   return 1.0;   // nm
        case 'FWHM':             return 2.0;   // nm
        case 'EDGE_LAMBDA':      return 1.0;   // nm
        case 'THICKNESS_BUDGET': return 10.0;  // nm
        case 'LAYER_COUNT':      return 0;     // exact integer count
        default:                 return 0.01;  // fraction = 1 % for T/R/A
    }
}

// ── Construction ─────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }

export function makeQualifier(overrides = {}) {
    const base = {
        id:          uid(),
        enabled:     true,
        kind:        'T_AVG',
        cmp:         'ge',
        // Channel for *_AT / *_AVG / CENTRAL_LAMBDA / FWHM / EDGE_LAMBDA:
        // 'T' | 'R' | 'A' (derived from kind otherwise).
        channel:     'T',
        // Peak direction for CENTRAL_LAMBDA / FWHM:
        // 'max' | 'min'  (peak = max, notch = min).
        direction:   'max',
        // FWHM / EDGE_LAMBDA crossing level (fraction of peak; default 0.5 =
        // half-max). User can set 0.1 for HM-at-0.1T-style specs.
        level:       0.5,
        // Band / single λ
        lambdaStart: 400,
        lambdaEnd:   700,
        lambda:      550,            // single-λ kinds (*_AT)
        // AOI & pol
        aoi:         0,
        pol:         'avg',
        // Threshold(s)
        target:      0.99,           // for cmp = ge/le/eq (eq uses ±tol)
        tol:         0.01,           // eq tolerance
        lo:          0.95,           // for cmp = between
        hi:          1.00,
        // INTEGRAL specs
        source:      { id: 'D65' },
        detector:    { id: 'photopic' },
        // bandPoints (sampling density for argmax / FWHM scans) is NOT stamped
        // on the qualifier — it's an implementation hyperparameter that
        // defaults at evaluation time (ARGWAVE_DEFAULT_POINTS in optimizer.js).
        // This way a default change later upgrades existing qualifiers on disk
        // automatically, and Specification stays consistent with the equivalent
        // MF operand by construction (both use the same runtime default).
        // User can still override per-qualifier by setting `bandPoints`
        // explicitly (e.g. via a future "Advanced" panel).
        // User-visible label (auto-derived from kind if blank)
        label:       '',
        ...overrides
    };
    // Tolerance follows the (possibly overridden) kind unless the caller set it
    // explicitly — so an nm-valued kind gets an nm-scale tol, not 0.01 nm.
    if (overrides.tol == null) base.tol = defaultTolForKind(base.kind);
    return base;
}

// ── Channel & op-type helpers ────────────────────────────────────────────────

// Map qualifier `channel` (T/R/A) + λ-mode (single/avg) → MF operand type.
// Polarization rides on the operand's `pol` field (avg/s/p), not the type code,
// so these return the base type only (no S/P suffix). The caller always passes
// `pol` to makeOperand.
function singleType(ch /*, pol */) { return ch; }
function avgType(ch /*, pol */) { return ch + 'AV'; }
// Worst-case soft-min / soft-max operand type for a channel.
//   direction 'min' → T/R/A MN (worst-case minimum, e.g. "min T over band")
//   direction 'max' → T/R/A MX (worst-case maximum, e.g. "max R over band")
function minmaxType(ch, direction) {
    return ch + (direction === 'min' ? 'MN' : 'MX');
}
function argwaveType(direction, ch, pol) {
    // Polarization is carried by the operand's `pol` field (not the type code),
    // so argwave types are just MXW{T|R|A} / MNW{T|R|A}. (The S/P-suffixed
    // variants were removed — see ARGWAVE_OPERAND_TYPES in optimizer.js.)
    return (direction === 'min' ? 'MNW' : 'MXW') + ch;
}

// Resolve channel from a qualifier kind that hard-encodes it.
function channelFromKind(kind) {
    if (kind === 'T_AT' || kind === 'T_AVG') return 'T';
    if (kind === 'R_AT' || kind === 'R_AVG') return 'R';
    if (kind === 'A_AT' || kind === 'A_AVG') return 'A';
    return null;
}

// ── Evaluation ───────────────────────────────────────────────────────────────

// Evaluate one qualifier against a design. Returns:
//   { value, value2, pass, deviation, displayValue, unit, summary }
// where value/value2 are the raw computed numbers, displayValue is a
// formatted string for the table, and unit is 'nm' or '%' or '' depending
// on kind.
export function evaluateQualifier(qual, design, resolveMat) {
    const k = qual.kind;
    const ctx = buildEvalContext(design, resolveMat);

    // ── Static (geometry-only) qualifiers ────────────────────────────────────
    if (k === 'THICKNESS_BUDGET') {
        const layers = design?.frontLayers || [];
        const v = layers.reduce((s, l) => s + (l.thickness || 0), 0)
                + (design?.backLayers || []).reduce((s, l) => s + (l.thickness || 0), 0);
        return finishCompare(qual, v, 'nm');
    }
    if (k === 'LAYER_COUNT') {
        const v = (design?.frontLayers?.length || 0) + (design?.backLayers?.length || 0);
        return finishCompare(qual, v, '');
    }

    // ── Optical scalar qualifiers ────────────────────────────────────────────
    const ch  = channelFromKind(k) || qual.channel || 'T';
    const pol = qual.pol || 'avg';

    if (k === 'T_AT' || k === 'R_AT' || k === 'A_AT') {
        const op = makeOperand({
            type: singleType(ch, pol),
            lambdaStart: qual.lambda, lambdaEnd: qual.lambda,
            aoi: qual.aoi, pol, target: 0, weight: 1,
        });
        const v = evaluateOperands([op], ctx)[0];
        return finishCompare(qual, v, '%');
    }
    if (k === 'T_AVG' || k === 'R_AVG' || k === 'A_AVG') {
        const op = makeOperand({
            type: avgType(ch, pol),
            lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
            aoi: qual.aoi, pol, target: 0, weight: 1,
        });
        const v = evaluateOperands([op], ctx)[0];
        return finishCompare(qual, v, '%');
    }
    // ── MIN_MAX — true min/max of T/R/A over a band ───────────────────────────
    // The "T(λ) ≥ X across the band" / "R(λ) ≤ Y across the band" spec that
    // appears on optical drawings. Evaluated through the SAME TMN/TMX/RMN/RMX/
    // AMN/AMX operand the generated MF uses — which now returns the true band
    // extremum on the dense (≈1 nm) grid — so the Specification verdict and the
    // MF operand's reported value are identical by construction (same code, same
    // grid). No separate scan to drift out of sync.
    if (k === 'MIN_MAX') {
        const op = makeOperand({
            type: minmaxType(ch, qual.direction),
            lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
            aoi: qual.aoi, pol, target: 0, weight: 1,
        });
        const v = evaluateOperands([op], ctx)[0];
        return finishCompare(qual, v, '%');
    }
    if (k === 'INTEGRAL') {
        const opType = ch === 'R' ? 'RIW' : ch === 'A' ? 'AIW' : 'TIW';
        const op = makeOperand({
            type: opType,
            lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
            aoi: qual.aoi, pol, target: 0, weight: 1,
            source: qual.source, detector: qual.detector,
            bandPoints: qual.bandPoints,
        });
        const v = evaluateOperands([op], ctx)[0];
        return finishCompare(qual, v, '%');
    }

    // ── CENTRAL_LAMBDA — argwave on the requested channel ────────────────────
    // Delegate to the optimizer's argwave operand so this and the
    // equivalent MXWT/MNW* operand placed in design.meritOperands evaluate
    // through exactly the same code path with exactly the same λ grid.
    if (k === 'CENTRAL_LAMBDA') {
        const op = makeOperand({
            type: argwaveType(qual.direction, ch, pol),
            lambdaStart: qual.lambdaStart, lambdaEnd: qual.lambdaEnd,
            aoi: qual.aoi, pol, target: qual.target, weight: 1,
            bandPoints: qual.bandPoints || ARGWAVE_DEFAULT_POINTS,
        });
        const lam = evaluateOperands([op], ctx)[0];
        return finishCompare(qual, lam, 'nm');
    }

    // ── FWHM / EDGE_LAMBDA — derived from a dense band scan ──────────────────
    if (k === 'FWHM' || k === 'EDGE_LAMBDA') {
        // Sample the band and find the peak first, then the two (or one)
        // crossings of level·peak.  Use the same default grid density as
        // the argwave operand so the peak λ here matches CENTRAL_LAMBDA.
        const N = Math.max(11, qual.bandPoints || ARGWAVE_DEFAULT_POINTS);
        const lams = new Array(N);
        const vals = new Array(N);
        for (let i = 0; i < N; i++) {
            const lam = qual.lambdaStart + (qual.lambdaEnd - qual.lambdaStart) * i / (N - 1);
            lams[i] = lam;
            const probe = makeOperand({
                type: singleType(ch, pol),
                lambdaStart: lam, lambdaEnd: lam,
                aoi: qual.aoi, pol, target: 0, weight: 1,
            });
            vals[i] = evaluateOperands([probe], ctx)[0];
        }
        const direction = qual.direction || 'max';
        // Peak / notch value
        let peakI = 0, peakV = vals[0];
        for (let i = 1; i < N; i++) {
            if (direction === 'min' ? vals[i] < peakV : vals[i] > peakV) {
                peakV = vals[i]; peakI = i;
            }
        }
        const level = Math.max(0.001, Math.min(0.999, qual.level ?? 0.5));
        // For a max peak the crossing level is peakV · level; for a notch
        // (min) we use peakV + level · (1 − peakV) — i.e. recover toward 1.
        const cross = direction === 'min'
            ? peakV + (1 - peakV) * level
            : peakV * level;

        // Walk outward from peakI to find crossings.
        function findCross(startI, step) {
            let prev = peakV, prevLam = lams[peakI];
            for (let i = startI; i >= 0 && i < N; i += step) {
                const curV = vals[i], curLam = lams[i];
                // For a max peak we look for first descent below cross; for a
                // min notch we look for first ascent above cross.
                const isCrossed = direction === 'min'
                    ? (curV >= cross && prev < cross)
                    : (curV <= cross && prev > cross);
                if (isCrossed) {
                    // linear-interp between prev → cur
                    const t = (cross - prev) / (curV - prev);
                    return prevLam + t * (curLam - prevLam);
                }
                prev = curV; prevLam = curLam;
            }
            return null;
        }

        const leftLam  = findCross(peakI - 1, -1);
        const rightLam = findCross(peakI + 1, +1);

        if (k === 'FWHM') {
            if (leftLam == null || rightLam == null) {
                // Couldn't bracket both crossings inside the scan band.
                return {
                    value: NaN, pass: false, deviation: NaN,
                    displayValue: '— (no crossings)', unit: 'nm',
                    summary: `FWHM @ ${(level*100).toFixed(0)}% not bracketed in [${qual.lambdaStart},${qual.lambdaEnd}] nm`,
                };
            }
            const fwhm = rightLam - leftLam;
            return finishCompare(qual, fwhm, 'nm');
        }
        if (k === 'EDGE_LAMBDA') {
            // For an LP / SP edge there's typically one crossing in the band.
            // Pick whichever side has a real crossing (left for LP↑, right
            // for SP↓ etc.); if both exist, the qualifier carries `edgeSide`
            // ('left' | 'right'); default 'left'.
            const which = qual.edgeSide === 'right' ? rightLam : (leftLam ?? rightLam);
            if (which == null) {
                return {
                    value: NaN, pass: false, deviation: NaN,
                    displayValue: '— (no crossing)', unit: 'nm',
                    summary: `Edge level ${(level*100).toFixed(0)}% not crossed in band`,
                };
            }
            return finishCompare(qual, which, 'nm');
        }
    }

    // ── Unknown kind — defensive return ──────────────────────────────────────
    return {
        value: null, pass: false, deviation: null,
        displayValue: '—', unit: '',
        summary: `Unknown qualifier kind: ${k}`,
    };
}

// Format a scalar in its native unit: fraction → percent (3 dp), nm (2 dp),
// otherwise plain string. Non-finite values render as an em dash.
function formatQualifierValue(v, unit) {
    if (v == null || !Number.isFinite(v)) return '—';
    if (unit === '%')  return (v * 100).toFixed(3) + ' %';
    if (unit === 'nm') return v.toFixed(2) + ' nm';
    return String(v);
}

// Apply the qualifier's comparator to a (finite) value, returning the
// PASS/FAIL verdict, the deviation magnitude (> 0 means the spec is violated),
// and a display string for the threshold.
function compareToThreshold(qual, value, unit) {
    const fmt = v => formatQualifierValue(v, unit);
    if (qual.cmp === 'ge') {
        return { pass: value >= qual.target, deviation: qual.target - value,
                 cmpStr: '≥ ' + fmt(qual.target) };
    }
    if (qual.cmp === 'le') {
        return { pass: value <= qual.target, deviation: value - qual.target,
                 cmpStr: '≤ ' + fmt(qual.target) };
    }
    if (qual.cmp === 'eq') {
        const deviation = Math.abs(value - qual.target);
        return { pass: deviation <= (qual.tol ?? 0), deviation,
                 cmpStr: '= ' + fmt(qual.target) + ' ± ' + fmt(qual.tol) };
    }
    if (qual.cmp === 'between') {
        const deviation = value < qual.lo ? qual.lo - value
                        : value > qual.hi ? value - qual.hi
                        : 0;
        return { pass: value >= qual.lo && value <= qual.hi, deviation,
                 cmpStr: '∈ [' + fmt(qual.lo) + ', ' + fmt(qual.hi) + ']' };
    }
    return { pass: false, deviation: 0, cmpStr: '' };
}

// Compare a scalar value against the qualifier's threshold(s), produce a
// PASS/FAIL verdict + deviation magnitude + human summary.
function finishCompare(qual, value, unit) {
    if (value == null || !Number.isFinite(value)) {
        return { value, pass: false, deviation: null, displayValue: '—', unit,
                 summary: 'value not computable' };
    }

    const { pass, deviation, cmpStr } = compareToThreshold(qual, value, unit);
    const displayValue = formatQualifierValue(value, unit);

    return {
        value,
        pass,
        deviation,
        displayValue,
        unit,
        summary: displayValue + '  ' + cmpStr,
    };
}

// Evaluate every qualifier in a list against a design.
export function evaluateQualifiers(qualifiers, design, resolveMat) {
    return (qualifiers || []).map(q =>
        q.enabled
            ? evaluateQualifier(q, design, resolveMat)
            : { value: null, pass: null, deviation: null, displayValue: '—', unit: '', summary: 'disabled' }
    );
}

// Aggregate verdict: { passing, total, allPass, anyFail }.
export function aggregateVerdict(results) {
    let passing = 0, total = 0;
    for (const r of results) {
        if (r && r.pass === null) continue;     // skip disabled
        total += 1;
        if (r && r.pass === true) passing += 1;
    }
    return { passing, total, allPass: total > 0 && passing === total, anyFail: passing < total };
}

// ── MF-generation helper ─────────────────────────────────────────────────────
// Convert each qualifier into one or more MF operands.
//
// Zemax-style architecture:
//   1. Emit the BASE T/R/A/argwave/integral row (the actual physical operand
//      whose value the spec is about).  Its target is set to a sensible
//      neutral value (0 for equality use; the user's threshold for eq specs).
//   2. Emit a separate OPGT/OPLT/OPVA row that REFERENCES the base operand
//      by id (op.refId).  Its target is the user's spec threshold.
//
// For 'between' specs we emit ONE base row + OPGT(refId=base.id) + OPLT(...).
// For 'eq' specs we just emit the base row with target = user's value
// (equality two-sided residual is exactly what the user wants).
// For 'ge'/'le' we emit base + OPGT/OPLT pointing at it.
//
// This matches the Zemax merit-function convention: spec rows REFERENCE
// physical-measurement rows by Op#.  The user can later insert / delete /
// reorder rows in the MF table and the reference (stable id) follows.
export function qualifiersToMFOperands(qualifiers, opts = {}) {
    const out = [];
    const weight = opts.weight || 1.0;
    for (const q of (qualifiers || [])) {
        if (!q.enabled) continue;
        const k = q.kind;

        // Geometry-only qualifiers don't translate to MF operands the
        // optimizer can act on (layer count / thickness budget are discrete /
        // sum-constraints; MNT/MXT would partially cover them).
        if (k === 'LAYER_COUNT' || k === 'THICKNESS_BUDGET') continue;

        // ── 1. Build the BASE physical-measurement operand ──────────────────
        const ch  = channelFromKind(k) || q.channel || 'T';
        const pol = q.pol || 'avg';

        let baseOp;
        if (k === 'T_AT' || k === 'R_AT' || k === 'A_AT') {
            baseOp = makeOperand({
                type: singleType(ch, pol),
                lambdaStart: q.lambda, lambdaEnd: q.lambda,
                aoi: q.aoi, pol, weight, target: 0,
            });
        } else if (k === 'T_AVG' || k === 'R_AVG' || k === 'A_AVG') {
            baseOp = makeOperand({
                type: avgType(ch, pol),
                lambdaStart: q.lambdaStart, lambdaEnd: q.lambdaEnd,
                aoi: q.aoi, pol, weight, target: 0,
            });
        } else if (k === 'MIN_MAX') {
            // Min/max measurement row — the optimizer's soft-min/soft-max over
            // the band (smooth surrogate for the true extremum). The
            // ge/le/between/eq logic below references this row, so a "min T ≥
            // 90 %" spec becomes TMN(weight 0) + OPGT(refId, 0.90).
            baseOp = makeOperand({
                type: minmaxType(ch, q.direction),
                lambdaStart: q.lambdaStart, lambdaEnd: q.lambdaEnd,
                aoi: q.aoi, pol, weight, target: 0,
            });
        } else if (k === 'INTEGRAL') {
            const opType = ch === 'R' ? 'RIW' : ch === 'A' ? 'AIW' : 'TIW';
            baseOp = makeOperand({
                type: opType,
                lambdaStart: q.lambdaStart, lambdaEnd: q.lambdaEnd,
                aoi: q.aoi, pol, weight, target: 0,
                source: { ...q.source }, detector: { ...q.detector },
                ...(Number.isFinite(q.bandPoints) ? { bandPoints: q.bandPoints } : {}),
            });
        } else if (k === 'CENTRAL_LAMBDA') {
            const opType = argwaveType(q.direction, ch, pol);
            baseOp = makeOperand({
                type: opType,
                lambdaStart: q.lambdaStart, lambdaEnd: q.lambdaEnd,
                aoi: q.aoi, pol, weight, target: q.target,
                ...(Number.isFinite(q.bandPoints) ? { bandPoints: q.bandPoints } : {}),
            });
        } else if (k === 'FWHM' || k === 'EDGE_LAMBDA') {
            // No direct MF operand for these — needs a derived FWHM operand
            // with its own gradient (open follow-up).
            continue;
        } else {
            continue;
        }

        // ── 2. Emit base + spec rows ────────────────────────────────────────
        // For 'eq' specs, the base operand itself does the job — its target
        // is the user's exact value, and equality residual is (val − target).
        // For ge/le/between, the SPEC is carried by the math row (OPGT/OPLT)
        // — the base operand is a pure "measurement" row that the math row
        // references. Its WEIGHT is forced to 0 so it contributes nothing
        // to the merit function (otherwise the equality residual
        // (TAV − base.target) would fight the inequality constraint), but
        // its TARGET is set to the spec value so the MFE table shows
        // "spec = 99 %, value = 99.5 %" instead of "spec = 0 %, value = 99.5 %".
        if (q.cmp === 'ge') {
            baseOp.target = q.target;
            baseOp.weight = 0;
            out.push(baseOp);
            out.push(makeOperand({
                type: 'OPGT', refId: baseOp.id, target: q.target, weight,
            }));
        } else if (q.cmp === 'le') {
            baseOp.target = q.target;
            baseOp.weight = 0;
            out.push(baseOp);
            out.push(makeOperand({
                type: 'OPLT', refId: baseOp.id, target: q.target, weight,
            }));
        } else if (q.cmp === 'between') {
            baseOp.target = (q.lo + q.hi) / 2;      // midpoint = display only
            baseOp.weight = 0;
            out.push(baseOp);
            out.push(makeOperand({
                type: 'OPGT', refId: baseOp.id, target: q.lo, weight,
            }));
            out.push(makeOperand({
                type: 'OPLT', refId: baseOp.id, target: q.hi, weight,
            }));
        } else {
            // eq → just the base operand at the requested target.  For
            // CENTRAL_LAMBDA the target already lives on the argwave row;
            // for T_AT/T_AVG/etc. we set it now. Weight stays at the
            // user-requested value because this row IS the spec.
            if (k !== 'CENTRAL_LAMBDA') baseOp.target = q.target;
            out.push(baseOp);
        }
    }
    return out;
}

// ── Defaults helper ──────────────────────────────────────────────────────────
// Return an empty qualifier list. Designers usually start blank and add rows
// as their spec sheet dictates.
export function emptyQualifiers() { return []; }
