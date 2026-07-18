/**
 * Formatting and threshold comparison for a qualifier's computed value.
 */

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
export function finishCompare(qual, value, unit) {
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
