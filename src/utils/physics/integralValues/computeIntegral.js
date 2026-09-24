// ── Core integral computation ────────────────────────────────────────────────

import { trapezoidalWeighted } from './weightedIntegral.js';

// No value: the spectrum does not span the weighting's band (`covered` false,
// `spectrumSpan` the wavelengths it does span), or the weighting integrates to
// zero over its band. The average is left undefined rather than taken over
// part of the band or reported as 0.
function unavailableResult(weighting, covered, spectrumSpan) {
    return {
        value: NaN, norm: 0, num: 0, min: NaN, max: NaN, lamAtMin: NaN, lamAtMax: NaN,
        lamMin: weighting.lamMin, lamMax: weighting.lamMax, nSamples: 0,
        covered, spectrumSpan,
    };
}

/**
 * Compute the weighting-averaged value of a spectral characteristic,
 *
 *     C̄ = ∫ C(λ)·w(λ)·dλ / ∫ w(λ)·dλ   over the weighting's band,
 *
 * by the trapezoidal rule on the spectrum's own wavelength grid with w(λ)
 * interpolated to it. Every weighting, the photopic one included, follows this
 * one rule; for the photopic weighting S(λ)·ȳ(λ) the ratio is the luminance
 * factor Y/100 of Macleod Eq. (12.2).
 *
 * A band is integrated only when the spectrum spans all of it. Otherwise the
 * result has no value and says which wavelengths the spectrum spans.
 *
 * @param {{lambda:number[], R?:number[], T?:number[], A?:number[]}} spectrum
 *      Pre-computed spectrum object (from `evaluateSpectrum*` in thinFilmMath).
 * @param {'T'|'R'|'A'} char       which channel to integrate
 * @param {object}    weighting    one of BUILTIN_WEIGHTINGS or makeUserWeighting()
 * @returns {{ value:number, norm:number, num:number, lamMin:number, lamMax:number,
 *             covered:boolean, spectrumSpan:number[] }}
 *      `value` ∈ [0,1] is the weighted average, NaN when not available;
 *      `norm` = ∫w·dλ; `lamMin`/`lamMax` are the weighting's band in nm;
 *      `spectrumSpan` is [first, last] wavelength of the spectrum in nm.
 */
export function computeIntegralValue(spectrum, char, weighting) {
    const lambdas = spectrum?.lambda;
    if (!lambdas?.length) return unavailableResult(weighting, false, [NaN, NaN]);
    const fArr = spectrum[char];
    if (!fArr) throw new Error(`computeIntegralValue: spectrum has no '${char}' channel`);
    const spectrumSpan = [lambdas[0], lambdas[lambdas.length - 1]];
    if (spectrumSpan[0] > weighting.lamMin || spectrumSpan[1] < weighting.lamMax) {
        return unavailableResult(weighting, false, spectrumSpan);
    }
    const { num, den, min, max, lamAtMin, lamAtMax, nSamples } =
        trapezoidalWeighted(lambdas, fArr, weighting.sampler, weighting.lamMin, weighting.lamMax);
    if (!(den > 0)) return unavailableResult(weighting, true, spectrumSpan);
    return {
        value:  num / den,
        norm:   den,
        num,
        min, max, lamAtMin, lamAtMax,
        lamMin: weighting.lamMin, lamMax: weighting.lamMax, nSamples,
        covered: true, spectrumSpan,
    };
}

/**
 * Compute every integral in a list against a single spectrum. Returns a
 * keyed object: `{ Tvis: { value, ... }, Rvis: {...}, Tsol: {...}, ... }`.
 */
export function computeIntegralValueBatch(spectrum, integralDefs) {
    const out = {};
    for (const def of integralDefs) {
        out[def.key] = computeIntegralValue(spectrum, def.char, def.weighting);
    }
    return out;
}
