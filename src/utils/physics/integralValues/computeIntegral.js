// ── Core integral computation ────────────────────────────────────────────────

import { tristimulus } from '../colorimetry.js';
import { trapezoidalWeighted } from './weightedIntegral.js';

function emptyIntegralResult() {
    return {
        value: 0, norm: 0, num: 0, min: NaN, max: NaN, lamAtMin: NaN, lamAtMax: NaN,
        lamMin: 0, lamMax: 0, nSamples: 0,
    };
}

// Photopic case → route through CIE tristimulus (gives the exact V(λ)·D65
// luminance factor — Macleod Eq. (12.2)). The spectrum is sampled on the
// design's grid; tristimulus interpolates on its 5-nm CMF/SPD tables.
function computeIntegralPhotopic(spectrum, fArr) {
    const lams = spectrum.lambda;
    const responseAt = (lam) => {
        if (lam <= lams[0])              return fArr[0];
        if (lam >= lams[lams.length-1])  return fArr[fArr.length-1];
        let l = 0, r = lams.length - 1;
        while (l + 1 < r) {
            const m = (l + r) >> 1;
            if (lams[m] <= lam) l = m; else r = m;
        }
        const t = (lam - lams[l]) / (lams[r] - lams[l] || 1);
        return fArr[l] * (1 - t) + fArr[r] * t;
    };
    const XYZ = tristimulus(responseAt, '2', 'D65', 5);

    // Min/max in the photopic band — computed straight off the design grid.
    let mn = +Infinity, mx = -Infinity, lmn = NaN, lmx = NaN, nS = 0;
    for (let i = 0; i < lams.length; i++) {
        if (lams[i] < 380 || lams[i] > 780) continue;
        const v = fArr[i];
        if (v < mn) { mn = v; lmn = lams[i]; }
        if (v > mx) { mx = v; lmx = lams[i]; }
        nS++;
    }
    if (nS === 0) { mn = NaN; mx = NaN; }

    return {
        value:  XYZ.Y / 100,
        norm:   1,
        num:    XYZ.Y / 100,
        min:    mn,  max: mx,  lamAtMin: lmn, lamAtMax: lmx,
        lamMin: 380, lamMax: 780, nSamples: nS,
    };
}

// Generic sampled-weighting case → trapezoidal integration.
function computeIntegralSampled(spectrum, fArr, weighting) {
    const lamMin = Math.max(weighting.lamMin, spectrum.lambda[0]);
    const lamMax = Math.min(weighting.lamMax, spectrum.lambda[spectrum.lambda.length - 1]);
    const { num, den, min, max, lamAtMin, lamAtMax, nSamples } =
        trapezoidalWeighted(spectrum.lambda, fArr, weighting.sampler, lamMin, lamMax);
    return {
        value:  den > 0 ? num / den : 0,
        norm:   den,
        num,
        min, max, lamAtMin, lamAtMax,
        lamMin, lamMax, nSamples,
    };
}

/**
 * Compute the weighting-averaged value of a spectral characteristic.
 *
 * @param {{lambda:number[], R?:number[], T?:number[], A?:number[]}} spectrum
 *      Pre-computed spectrum object (from `evaluateSpectrum*` in thinFilmMath).
 * @param {'T'|'R'|'A'} char       which channel to integrate
 * @param {object}    weighting    one of BUILTIN_WEIGHTINGS or makeUserWeighting()
 * @returns {{ value:number, norm:number, num:number, lamMin:number, lamMax:number }}
 *      `value` ∈ [0,1] is the weighted average; `norm` = ∫w·dλ;
 *      `lamMin`/`lamMax` are the effective integration limits (clipped to
 *      the intersection of the design grid and the weighting range).
 */
export function computeIntegralValue(spectrum, char, weighting) {
    if (!spectrum?.lambda?.length) return emptyIntegralResult();
    const fArr = spectrum[char];
    if (!fArr) throw new Error(`computeIntegralValue: spectrum has no '${char}' channel`);
    return weighting.kind === 'photopic'
        ? computeIntegralPhotopic(spectrum, fArr)
        : computeIntegralSampled(spectrum, fArr, weighting);
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
