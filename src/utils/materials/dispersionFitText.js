/**
 * A smooth dispersion fit as the Material Editor and n,k Characterization word
 * it, in the user's language. `words` is t.dispersionFit and `units` is t.units;
 * model names come from the locale, symbols such as A1 or ωp do not.
 */

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

const superscript = power => String(power).split('').map(digit => SUPERSCRIPT_DIGITS[digit]).join('');

// A unit of dispersionFits.js ({ base, power }), written with the language's
// own symbol for its base: µm², 1/µm, eV².
function unitText({ base, power = 1 }, units) {
    const symbol = units[base];
    if (power === 1) return symbol;
    if (power === -1) return `1/${symbol}`;
    return `${symbol}${superscript(power)}`;
}

/** A fitted parameter's label: its symbol, and its unit in brackets when it has one. */
export function fitParameterLabel({ symbol, unit }, units) {
    return unit ? `${symbol} (${unitText(unit, units)})` : symbol;
}

/** The fitted model and the range it covers, as "3-term Cauchy; Urbach k, 400-800 nm". */
export function dispersionFitModelText(fit, words, units) {
    const [from, to] = fit.rangeNm;
    if (fit.complex) {
        // A Drude-Lorentz fit that took no oscillators is a Drude fit.
        const count = fit.complex.oscillators.length;
        const model = fit.complex.kind === 'drude' || count === 0
            ? words.models.drude
            : words.drudeLorentz(count);
        return words.metalName(model, from, to, units.nm);
    }
    const index = fit.n.kind === 'sellmeier'
        ? words.terms(words.models.sellmeier, fit.n.terms)
        : words.terms(words.models.cauchy, fit.n.coefficients.length);
    const extinction = fit.k.kind === 'zero' ? words.noExtinction : words.urbachExtinction;
    return words.name(index, extinction, from, to, units.nm);
}

/** Why a fit could not be made, from the code dispersionFits.js gives the error. */
export function dispersionFitErrorText(error, words) {
    return words.errors[error?.code] || error?.message || String(error);
}
