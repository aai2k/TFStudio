/**
 * Formatting and threshold comparison for a qualifier's computed value.
 *
 * A result carries its value, its unit and the threshold it was held to; the
 * text for them is written where they are shown, in the reader's language, by
 * qualifierValueText and qualifierSummary. `units` is t.units.
 */

import { eqTolerance } from './constants.js';

// How a value in each unit is shown: the factor from the value to the number
// written, and its decimal places. A fraction is written as a percent; a value
// in a unit not listed is written in full.
const SHOWN = {
    '%': { scale: 100, digits: 3 },
    nm:  { scale: 1, digits: 2 },
    dB:  { scale: 1, digits: 3 },
};

// Format a scalar in its native unit. Non-finite values render as a dash.
function formatQualifierValue(v, unit, units) {
    if (v == null || !Number.isFinite(v)) return '—';
    const shown = SHOWN[unit];
    if (!shown) return String(v);
    return `${(v * shown.scale).toFixed(shown.digits)} ${unit === 'nm' ? units.nm : unit}`;
}

// Half a unit in the last digit a value is shown to, in the value's own unit,
// or 0 for a value written in full. A check passes a value this close past a
// bound, so a value shown on its bound passes: a run that stops on its merit
// target leaves a one-sided check about that close.
function shownSlack(unit) {
    const shown = SHOWN[unit];
    return shown ? 0.5 / (shown.scale * 10 ** shown.digits) : 0;
}

// The bounds an equality check holds a value between: the bounds Generate MF
// holds the row between, in the same arithmetic, each `slack` further out.
function eqBounds(qual, slack) {
    const tol = eqTolerance(qual) + slack;
    return [qual.target - tol, qual.target + tol];
}

// Apply the qualifier's comparator to a (finite) value, returning the
// PASS/FAIL verdict and the deviation magnitude (> 0 means the spec is violated).
// The verdict lets the value `slack` past a bound; the deviation does not.
function compareToThreshold(qual, value, slack) {
    if (qual.cmp === 'ge') return { pass: value >= qual.target - slack, deviation: qual.target - value };
    if (qual.cmp === 'le') return { pass: value <= qual.target + slack, deviation: value - qual.target };
    if (qual.cmp === 'eq') {
        const [low, high] = eqBounds(qual, slack);
        return { pass: value >= low && value <= high, deviation: Math.abs(value - qual.target) };
    }
    if (qual.cmp === 'between') {
        const deviation = value < qual.lo ? qual.lo - value
                        : value > qual.hi ? value - qual.hi
                        : 0;
        return { pass: value >= qual.lo - slack && value <= qual.hi + slack, deviation };
    }
    return { pass: false, deviation: 0 };
}

/**
 * The room a finite value has inside the qualifier's threshold, in the
 * value's unit (the evaluator's: '%', 'nm', 'dB' or ''): how far it is from the
 * nearest bound, positive inside and negative outside. It is taken against the
 * bounds compareToThreshold holds the value to, each half the last shown digit
 * past the stated bound, so it is 0 or more exactly when the check passes.
 * Null for a comparison the check does not know.
 */
export function thresholdMargin(qual, value, unit) {
    const slack = shownSlack(unit);
    if (qual.cmp === 'ge') return value - (qual.target - slack);
    if (qual.cmp === 'le') return (qual.target + slack) - value;
    if (qual.cmp === 'eq') {
        const [low, high] = eqBounds(qual, slack);
        return Math.min(value - low, high - value);
    }
    if (qual.cmp === 'between') return Math.min(value - (qual.lo - slack), (qual.hi + slack) - value);
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
    const { pass, deviation } = compareToThreshold(qual, value, shownSlack(unit));
    return {
        value,
        pass,
        deviation,
        unit,
        threshold: { cmp: qual.cmp, target: qual.target, tol: qual.tol, lo: qual.lo, hi: qual.hi },
    };
}
