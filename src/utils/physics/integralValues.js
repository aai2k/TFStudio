/**
 * Integral Values & Characteristics — weighted averages of T(λ), R(λ), A(λ).
 *
 * Computes integral figures of merit such as
 *   • Photopic transmittance/reflectance:  Tvis, Rvis (CIE V(λ) × D65)
 *   • Solar transmittance/reflectance:     Tsol, Rsol (ASTM G173 AM1.5G)
 *   • Flat-band UV/NIR integrals
 *   • Arbitrary user-defined spectral weighting
 *
 * All integrals are of the form
 *
 *     C̄ = ∫ C(λ)·w(λ)·dλ  /  ∫ w(λ)·dλ
 *
 * evaluated by trapezoidal integration on the *design's* spectrum λ grid
 * (so the result respects the same spectral resolution as the rest of the
 * Optical Evaluation tool). The weighting w(λ) is sampled by linear
 * interpolation on its own table.
 *
 * Photopic Tvis/Rvis are computed by routing T (or R) through
 * `tristimulus(..., '2', 'D65')` in `colorimetry.js` — `Y` is exactly
 * the V(λ)·D65-weighted average (Macleod Eq. (12.2), Y = luminance factor).
 * That avoids duplicating the CIE tables here.
 *
 * Provenance:
 *   - Photopic V(λ): CIE 1924 photopic standard observer (= y-CMF of CIE
 *     1931 2°; CIE 15:2004 Table T.4)
 *   - D65 illuminant: CIE 15:2004 Table T.1
 *   - AM1.5G:        ASTM G173-03, NREL public-domain dataset (see solarSpectrum.js)
 */

import { tristimulus } from './colorimetry.js';
import { AM1_5G_5NM, solarIrradianceAt, SOLAR_RANGE_NM } from './solarSpectrum.js';

// ── Sampled-weighting helpers ────────────────────────────────────────────────

/**
 * Trapezoidal integral ∫f(λ)·g(λ)·dλ over the shared λ grid.
 *
 * Both arrays are sampled on the same λ grid (the design's spectrum). g is
 * looked up via linear interpolation on its own table (`weightTable` is an
 * array of [λ_nm, value] tuples, sorted by λ). Out-of-range g is zero.
 *
 * Also tracks the unweighted min/max of f within the integration band (the
 * argmin/argmax wavelengths, picked from the design grid — no sub-sample
 * refinement, since the optimizer would only care about which design-grid
 * point is worst anyway).
 *
 * @returns { num, den, min, max, lamAtMin, lamAtMax, nSamples }
 */
function trapezoidalWeighted(lambdas, fVals, weightFn, lamMin, lamMax) {
    let num = 0, den = 0;
    let min = +Infinity, max = -Infinity, lamAtMin = NaN, lamAtMax = NaN;
    let nSamples = 0;
    if (!lambdas?.length || lambdas.length < 2) {
        return { num, den, min: NaN, max: NaN, lamAtMin, lamAtMax, nSamples: 0 };
    }

    let prevW   = null;
    let prevFw  = null;
    let prevLam = null;
    for (let i = 0; i < lambdas.length; i++) {
        const lam = lambdas[i];
        if (lam < lamMin || lam > lamMax) {
            prevW = prevFw = prevLam = null;
            continue;
        }
        const w  = weightFn(lam);
        const f  = fVals[i];
        const Fw = f * w;
        if (prevLam != null) {
            const dlam = lam - prevLam;
            num += 0.5 * (Fw + prevFw) * dlam;
            den += 0.5 * (w  + prevW)  * dlam;
        }
        if (f < min) { min = f; lamAtMin = lam; }
        if (f > max) { max = f; lamAtMax = lam; }
        nSamples++;
        prevW = w;
        prevFw = Fw;
        prevLam = lam;
    }
    if (nSamples === 0) { min = NaN; max = NaN; }
    return { num, den, min, max, lamAtMin, lamAtMax, nSamples };
}

// Linear interpolation on a sorted [λ, value] table; out-of-range = 0.
function makeTableLookup(table) {
    if (!table?.length) return () => 0;
    const lo = table[0][0], hi = table[table.length - 1][0];
    // Pre-extract for speed
    const lams = new Float64Array(table.length);
    const vals = new Float64Array(table.length);
    for (let i = 0; i < table.length; i++) { lams[i] = table[i][0]; vals[i] = table[i][1]; }
    return (lam) => {
        if (lam < lo || lam > hi) return 0;
        // Binary search since user tables may not have uniform spacing
        let l = 0, r = lams.length - 1;
        while (l + 1 < r) {
            const m = (l + r) >> 1;
            if (lams[m] <= lam) l = m; else r = m;
        }
        const t = (lam - lams[l]) / (lams[r] - lams[l] || 1);
        return vals[l] * (1 - t) + vals[r] * t;
    };
}

// ── Built-in weighting catalog ────────────────────────────────────────────────

export const BUILTIN_WEIGHTINGS = {
    photopic: {
        id:        'photopic',
        label:     'Photopic (V(λ) × D65)',
        reference: 'CIE 1924 V(λ) × CIE D65 — Macleod §12.2',
        lamMin:    380,
        lamMax:    780,
        kind:      'photopic',          // special: routes through tristimulus()
    },
    solar: {
        id:        'solar',
        label:     'Solar (AM1.5G)',
        reference: 'ASTM G173-03 AM1.5G (NREL)',
        lamMin:    SOLAR_RANGE_NM[0],
        lamMax:    SOLAR_RANGE_NM[1],
        kind:      'sampled',
        sampler:   solarIrradianceAt,
    },
    uv: {
        id:        'uv',
        label:     'UV (300–380 nm flat)',
        reference: 'Flat (uniform) over 300–380 nm',
        lamMin:    300,
        lamMax:    380,
        kind:      'flat',
        sampler:   () => 1,
    },
    nir: {
        id:        'nir',
        label:     'NIR (780–2500 nm flat)',
        reference: 'Flat (uniform) over 780–2500 nm',
        lamMin:    780,
        lamMax:    2500,
        kind:      'flat',
        sampler:   () => 1,
    },
};

/**
 * Build a `weighting` object from a user CSV-style table.
 * `table`: array of [λ_nm, weight] tuples (must be sorted by λ).
 * Out-of-range weight = 0.
 */
export function makeUserWeighting(table, label = 'User') {
    if (!table?.length) throw new Error('makeUserWeighting: empty table');
    const sorted = [...table].sort((a, b) => a[0] - b[0]);
    return {
        id:        'user',
        label,
        reference: 'User-defined (CSV import)',
        lamMin:    sorted[0][0],
        lamMax:    sorted[sorted.length - 1][0],
        kind:      'sampled',
        sampler:   makeTableLookup(sorted),
        rawTable:  sorted,
    };
}

// ── Core integral computation ────────────────────────────────────────────────

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
    if (!spectrum?.lambda?.length) {
        return { value: 0, norm: 0, num: 0, min: NaN, max: NaN, lamAtMin: NaN, lamAtMax: NaN,
                 lamMin: 0, lamMax: 0, nSamples: 0 };
    }
    const fArr = spectrum[char];
    if (!fArr) throw new Error(`computeIntegralValue: spectrum has no '${char}' channel`);

    // Photopic case → route through CIE tristimulus (gives the exact V(λ)·D65
    // luminance factor — Macleod Eq. (12.2)). The spectrum is sampled on the
    // design's grid; tristimulus interpolates on its 5-nm CMF/SPD tables.
    if (weighting.kind === 'photopic') {
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

    // Generic sampled-weighting case → trapezoidal integration
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

// ── Standard integral presets ─────────────────────────────────────────────────

/** Default integral set (T+R+A for each weighting). Keys use the standard
 *  naming where possible (Tvis/Rvis/Tsol/Rsol/TUV/TNIR…). */
export const DEFAULT_INTEGRALS = [
    { key: 'Tvis',  label: 'Tvis',  char: 'T', weighting: BUILTIN_WEIGHTINGS.photopic },
    { key: 'Rvis',  label: 'Rvis',  char: 'R', weighting: BUILTIN_WEIGHTINGS.photopic },
    { key: 'Avis',  label: 'Avis',  char: 'A', weighting: BUILTIN_WEIGHTINGS.photopic },
    { key: 'Tsol',  label: 'Tsol',  char: 'T', weighting: BUILTIN_WEIGHTINGS.solar    },
    { key: 'Rsol',  label: 'Rsol',  char: 'R', weighting: BUILTIN_WEIGHTINGS.solar    },
    { key: 'Asol',  label: 'Asol',  char: 'A', weighting: BUILTIN_WEIGHTINGS.solar    },
    { key: 'TUV',   label: 'TUV',   char: 'T', weighting: BUILTIN_WEIGHTINGS.uv       },
    { key: 'RUV',   label: 'RUV',   char: 'R', weighting: BUILTIN_WEIGHTINGS.uv       },
    { key: 'TNIR',  label: 'TNIR',  char: 'T', weighting: BUILTIN_WEIGHTINGS.nir      },
    { key: 'RNIR',  label: 'RNIR',  char: 'R', weighting: BUILTIN_WEIGHTINGS.nir      },
];

// ── MFE-compatible preset shape ───────────────────────────────────────────────
//
// The Merit Function Editor's TIW/RIW/AIW operands carry source/detector/band
// as separate fields (not a pre-composed `weighting`). This table maps each
// built-in weighting back to the (sourceSpec, detectorSpec, band) tuple it
// represents, so the MFE picker can populate operand fields uniformly from
// either built-in or user-defined presets (which already store these fields).
//
// Provenance:
//   photopic = V(λ)·D65  → source D65, detector photopic
//   solar    = AM1.5G·flat → source AM1.5G, detector flat
//   uv/nir   = flat band   → source E (equal-energy), detector flat
const _WEIGHTING_TO_MFE = {
    photopic: { sourceSpec: { id: 'D65'    }, detectorSpec: { id: 'photopic' }, band: [380, 780]  },
    solar:    { sourceSpec: { id: 'AM1.5G' }, detectorSpec: { id: 'flat'     }, band: [SOLAR_RANGE_NM[0], SOLAR_RANGE_NM[1]] },
    uv:       { sourceSpec: { id: 'E'      }, detectorSpec: { id: 'flat'     }, band: [300, 380]  },
    nir:      { sourceSpec: { id: 'E'      }, detectorSpec: { id: 'flat'     }, band: [780, 2500] },
};

/**
 * React hook: load saved integral presets (built-ins + user-defined) into a
 * unified list with the MFE-friendly shape. Re-fetches each mount so a preset
 * just created in the Integrals window appears immediately in MF tables and
 * the spectral monitor without an app restart.
 *
 * NB: relies on the global `React` (consistent with the rest of this codebase;
 * see DesignContext.js for the same pattern).
 */
export function useIntegralPresets() {
    const { useState, useEffect } = React;
    const [presets, setPresets] = useState(() => buildMfePresetList([]));
    useEffect(() => {
        let cancelled = false;
        if (typeof window !== 'undefined' && window?.electronAPI?.loadIntegralPresets) {
            window.electronAPI.loadIntegralPresets().then(r => {
                if (!cancelled) setPresets(buildMfePresetList(r?.presets || []));
            }).catch(() => { /* keep built-ins-only fallback */ });
        }
        return () => { cancelled = true; };
    }, []);
    return presets;
}

/**
 * Merge the built-in DEFAULT_INTEGRALS with user-saved custom presets into a
 * single list with the MFE-friendly shape:
 *   { key, label, char, sourceSpec, detectorSpec, band, builtin }
 *
 * `customDefs` is whatever the Integrals window's `loadIntegralPresets` IPC
 * returns (each entry already has sourceSpec/detectorSpec/band/char/key/label).
 */
export function buildMfePresetList(customDefs = []) {
    const out = [];
    for (const d of DEFAULT_INTEGRALS) {
        const m = _WEIGHTING_TO_MFE[d.weighting?.id];
        if (!m) continue;
        out.push({
            key:          d.key,
            label:        d.label,
            char:         d.char,
            sourceSpec:   m.sourceSpec,
            detectorSpec: m.detectorSpec,
            band:         m.band,
            builtin:      true,
        });
    }
    for (const cd of customDefs) {
        if (!cd?.key) continue;
        out.push({
            key:          cd.key,
            label:        cd.label || cd.key,
            char:         cd.char,
            sourceSpec:   cd.sourceSpec   || { id: 'E'    },
            detectorSpec: cd.detectorSpec || { id: 'flat' },
            band:         Array.isArray(cd.band) ? cd.band : [380, 780],
            builtin:      false,
        });
    }
    return out;
}

// ── CSV parser for user weighting import ──────────────────────────────────────

/**
 * Parse a CSV of "λ_nm, weight" rows.  Tolerant of:
 *   - whitespace, tabs, commas, semicolons as separators
 *   - header rows (skipped if first column isn't a number)
 *   - blank lines and # comment lines
 *
 * @returns {[number, number][]} sorted by λ
 */
export function parseWeightingCSV(text) {
    if (!text) return [];
    const rows = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
        // Split on any of comma, semicolon, tab, or multi-space
        const parts = trimmed.split(/[,;\t]+|\s{2,}/).map(s => s.trim()).filter(Boolean);
        if (parts.length < 2) continue;
        const lam = parseFloat(parts[0]);
        const w   = parseFloat(parts[1]);
        if (Number.isFinite(lam) && Number.isFinite(w)) rows.push([lam, w]);
    }
    rows.sort((a, b) => a[0] - b[0]);
    return rows;
}
