/**
 * Formatting and threshold comparison for a qualifier's computed value.
 *
 * A result carries its value, its unit and the threshold it was held to; the
 * text for them is written where they are shown, in the reader's language, by
 * qualifierValueText and qualifierSummary. `units` is t.units.
 */

import { eqTolerance } from './constants.js';

// Format a scalar in its native unit: fraction → percent (3 dp), nm (2 dp),
// dB (3 dp), otherwise plain string. Non-finite values render as a dash.
function formatQualifierValue(v, unit, units) {
    if (v == null || !Number.isFinite(v)) return '—';
    if (unit === '%')  return (v * 100).toFixed(3) + ' %';
    if (unit === 'nm') return `${v.toFixed(2)} ${units.nm}`;
    if (unit === 'dB') return v.toFixed(3) + ' dB';
    return String(v);
}

// The bounds an equality check holds a value between: the bounds Generate MF
// holds the row between, in the same arithmetic, so a value on a bound passes
// the check and meets the rows, or neither.
function eqBounds(qual) {
    const tol = eqTolerance(qual);
    return [qual.target - tol, qual.target + tol];
}

// Apply the qualifier's comparator to a (finite) value, returning the
// PASS/FAIL verdict and the deviation magnitude (> 0 means the spec is violated).
function compareToThreshold(qual, value) {
    if (qual.cmp === 'ge') return { pass: value >= qual.target, deviation: qual.target - value };
    if (qual.cmp === 'le') return { pass: value <= qual.target, deviation: value - qual.target };
    if (qual.cmp === 'eq') {
        const [low, high] = eqBounds(qual);
        return { pass: value >= low && value <= high, deviation: Math.abs(value - qual.target) };
    }
    if (qual.cmp === 'between') {
        const deviation = value < qual.lo ? qual.lo - value
                        : value > qual.hi ? value - qual.hi
                        : 0;
        return { pass: value >= qual.lo && value <= qual.hi, deviation };
    }
    return { pass: false, deviation: 0 };
}

/**
 * The room a finite value has inside the qualifier's threshold, in the
 * value's unit: how far it is from the nearest bound, positive inside, negative
 * outside and 0 on a bound. It is taken against the bounds compareToThreshold
 * holds the value to, so it is 0 or more exactly when the check passes. Null
 * for a comparison the check does not know.
 */
export function thresholdMargin(qual, value) {
    if (qual.cmp === 'ge') return value - qual.target;
    if (qual.cmp === 'le') return qual.target - value;
    if (qual.cmp === 'eq') {
        const [low, high] = eqBounds(qual);
        return Math.min(value - low, high - value);
    }
    if (qual.cmp === 'between') return Math.min(value - qual.lo, qual.hi - value);
    return null;
}

// The threshold a value was held to, as the summary states it.
function thresholdText({ cmp, target, tol, lo, hi }, unit, units) {
    const fmt = v => formatQualifierValue(v, unit, units);
    if (cmp === 'ge') return '≥ ' + fmt(target);
    if (cmp === 'le') return '≤ ' + fmt(target);
    if (cmp === 'eq') return '= ' + fmt(target) + ' ± ' + fmt(tol);
    if (cmp === 'between') return '∈ [' + fmt(lo) + ', ' + fmt(hi) + ']';
    return '';
}

/** An evaluated qualifier's value in its unit, or a dash when it has none. */
export function qualifierValueText(result, units) {
    return formatQualifierValue(result?.value, result?.unit, units);
}

/**
 * The summary line for one evaluated qualifier, in the reader's language.
 *
 * A qualifier that was computed summarises itself in numbers, its unit and
 * comparison symbols: its value, then the threshold it was held to. One that
 * could not be computed carries the reason as a key into `summaries` instead,
 * since that reason is a sentence.
 */
export function qualifierSummary(result, summaries = {}, units) {
    const entry = result?.summaryKey && summaries[result.summaryKey];
    if (typeof entry === 'function') return entry(...(result.summaryArgs || []));
    if (entry) return entry;
    if (!result?.threshold) return '';
    return `${qualifierValueText(result, units)}  ${thresholdText(result.threshold, result.unit, units)}`;
}

// Compare a scalar value against the qualifier's threshold(s): a PASS/FAIL
// verdict, the deviation magnitude, and the threshold the summary states.
export function finishCompare(qual, value, unit) {
    if (value == null || !Number.isFinite(value)) {
        return { value, pass: false, deviation: null, unit, summaryKey: 'notComputable' };
    }
    const { pass, deviation } = compareToThreshold(qual, value);
    return {
        value,
        pass,
        deviation,
        unit,
        threshold: { cmp: qual.cmp, target: qual.target, tol: qual.tol, lo: qual.lo, hi: qual.hi },
    };
}
