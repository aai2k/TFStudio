/**
 * Fixed significant figures, for quantities whose magnitude is not known in
 * advance.
 *
 * A fixed decimal count only works while a quantity stays near the scale it was
 * chosen for. The chromatic dispersion coefficient is the clear case: it is the
 * group delay dispersion taken against wavelength, which divides it by roughly
 * a thousand across the visible and near infrared, so the same three decimals
 * that read well for GDD render CDC as zeros on a metal mirror and as an
 * eleven-digit integer on a narrowband filter.
 *
 * Values that sit in a comfortable decade print as plain decimals; the very
 * small and the very large fall back to a compact exponential, since a run of
 * leading zeros carries no information a reader can use.
 */

const SMALL = 1e-4;
const LARGE = 1e6;

/** Trailing zeros carry no precision, so they are dropped from both forms. */
function trimTrailingZeros(text) {
    return text.replace(/\.0+$|(\.\d*?[1-9])0+$/, '$1');
}

/**
 * `value` in exponential form to `digits` significant figures, with the
 * redundant `+` and any trailing zeros of the mantissa removed.
 */
export function toCompactExponential(value, digits) {
    return value.toExponential(Math.max(0, digits - 1))
        .replace(/(\.\d*?[1-9])0+(?=e)/, '$1')
        .replace(/\.0+(?=e)/, '')
        .replace('e+', 'e');
}

/**
 * `value` to `digits` significant figures, as a plain decimal where that is
 * readable and a compact exponential where it is not. Returns null for a value
 * that is not a finite number, so each caller renders its own placeholder.
 *
 * @param   {number} value
 * @param   {number} digits  significant figures, at least 1
 * @returns {string|null}
 */
export function toSignificantFigures(value, digits = 5) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    if (number === 0) return '0';
    const places = Math.max(1, Math.floor(digits));
    const magnitude = Math.abs(number);
    if (magnitude < SMALL || magnitude >= LARGE) return toCompactExponential(number, places);
    const precise = number.toPrecision(places);
    return precise.includes('e')
        ? toCompactExponential(number, places)
        : trimTrailingZeros(precise);
}
