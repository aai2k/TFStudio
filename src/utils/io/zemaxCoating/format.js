/** Parse a COATING.DAT numeric token (plain decimal or scientific notation, e.g. -1.56E-04). */
export function num(s) {
    if (s == null) return NaN;
    return parseFloat(String(s));
}

/** Format a number for the .dat file: trim, keep up to `sig` significant digits. */
export function fmt(x, sig = 8) {
    if (!Number.isFinite(x)) return '0';
    if (x === 0) return '0';
    // Use a fixed-but-trimmed representation; fall back to exponential for tiny |x|.
    let s = Number(x.toPrecision(sig)).toString();
    return s;
}
