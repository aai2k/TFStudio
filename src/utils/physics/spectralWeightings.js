/**
 * Spectral weighting library — sources × detectors → weighting w(λ).
 *
 * The Integral Values tool computes
 *
 *     C̄ = ∫ C(λ)·w(λ) dλ  /  ∫ w(λ) dλ
 *
 * where C(λ) is one of T/R/A. Real measurement chains have *two* spectral
 * factors: the **source SPD** S(λ) (what light hits the sample) and the
 * **detector responsivity** D(λ) (what the receiver does with it). The
 * end-to-end weighting is their product
 *
 *     w(λ) = S(λ) · D(λ)
 *
 * This file is the catalog of built-in sources and detectors, plus the
 * `composeWeighting(...)` factory that produces an integralValues-compatible
 * weighting from any combination.
 *
 * Built-in sources:
 *   - D65    — CIE 15:2004 Table T.1, 380–780 nm
 *   - D50    — CIE 15:2004 (ICC profile values), 380–780 nm
 *   - A      — CIE Planckian formula, Tc ≈ 2856 K (any λ > 0)
 *   - AM1.5G — ASTM G173-03 / NREL, 280–2500 nm
 *   - E      — equal-energy (S(λ) ≡ 1), unbounded
 *   - blackbody — Planck's law at user-supplied T_K, unbounded
 *   - custom — user table [[λ, value], …]
 *
 * Built-in detectors:
 *   - photopic — CIE 1924 V(λ) = ȳ-CMF, 380–780 nm
 *   - flat     — D(λ) ≡ 1, unbounded   (i.e. "no detector / pure source")
 *   - custom   — user table
 *
 * Provenance: see colorimetry.js (D65/D50/A/V(λ)) and solarSpectrum.js
 * (AM1.5G). All tables are CC0 / public domain.
 */

import {
    illuminantSPD,
    photopicV,
    PHOTOPIC_RANGE_NM,
    D65_RANGE_NM,
    D50_RANGE_NM,
} from './colorimetry.js';
import { solarIrradianceAt, SOLAR_RANGE_NM } from './solarSpectrum.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Planck's law, relative intensity (no absolute normalization).
 *  Returns spectral radiance B_λ(λ, T) up to a constant factor. */
export function planckSPD(lambda_nm, T_K) {
    if (!(T_K > 0)) return 0;
    const c2 = 1.4388e7; // hc/k in nm·K
    const lam5 = Math.pow(lambda_nm, 5);
    return 1 / (lam5 * (Math.exp(c2 / (lambda_nm * T_K)) - 1));
}

/** Linear interpolation on a sorted [λ, value] table; out-of-range = 0. */
function tableSampler(table) {
    if (!table?.length) return () => 0;
    const lams = new Float64Array(table.length);
    const vals = new Float64Array(table.length);
    for (let i = 0; i < table.length; i++) { lams[i] = table[i][0]; vals[i] = table[i][1]; }
    const lo = lams[0], hi = lams[lams.length - 1];
    return (lam) => {
        if (lam < lo || lam > hi) return 0;
        let l = 0, r = lams.length - 1;
        while (l + 1 < r) {
            const m = (l + r) >> 1;
            if (lams[m] <= lam) l = m; else r = m;
        }
        const t = (lam - lams[l]) / (lams[r] - lams[l] || 1);
        return vals[l] * (1 - t) + vals[r] * t;
    };
}

// ── Source catalog ───────────────────────────────────────────────────────────

/**
 * BUILTIN_SOURCES — UI-facing list. Each entry has `{ id, label, lamMin, lamMax,
 * needsT? }`. `needsT` flags entries that take a user temperature parameter
 * (blackbody only). Bounds are the meaningful range; analytic sources (A, E,
 * blackbody) are sampled wherever asked but typically bounded by the user band.
 */
export const BUILTIN_SOURCES = [
    { id: 'D65',       label: 'D65 (daylight 6504 K)',     lamMin: D65_RANGE_NM[0],   lamMax: D65_RANGE_NM[1]   },
    { id: 'D50',       label: 'D50 (daylight 5003 K)',     lamMin: D50_RANGE_NM[0],   lamMax: D50_RANGE_NM[1]   },
    { id: 'A',         label: 'A (incandescent 2856 K)',   lamMin: 200,               lamMax: 4000              },
    { id: 'AM1.5G',    label: 'AM1.5G (ASTM G173-03)',     lamMin: SOLAR_RANGE_NM[0], lamMax: SOLAR_RANGE_NM[1] },
    { id: 'E',         label: 'E (equal energy)',          lamMin: 0,                 lamMax: 1e9               },
    { id: 'blackbody', label: 'Blackbody (T_K user)',      lamMin: 0,                 lamMax: 1e9, needsT: true },
    { id: 'custom',    label: 'Custom (user table)',       lamMin: null,              lamMax: null              },
];

/**
 * BUILTIN_DETECTORS — UI-facing list. Same shape as BUILTIN_SOURCES.
 */
export const BUILTIN_DETECTORS = [
    { id: 'photopic', label: 'Photopic V(λ) — CIE 1924',   lamMin: PHOTOPIC_RANGE_NM[0], lamMax: PHOTOPIC_RANGE_NM[1] },
    { id: 'flat',     label: 'Flat (no detector / unity)', lamMin: 0,                    lamMax: 1e9                  },
    { id: 'custom',   label: 'Custom (user table)',        lamMin: null,                 lamMax: null                 },
];

// ── Spec resolution ───────────────────────────────────────────────────────────

/**
 * A *spec* describes the user's choice on one slot. Shape:
 *   { id: 'D65' | 'D50' | 'A' | 'AM1.5G' | 'E' | 'blackbody' | 'custom',
 *     T?:     number,             // K, required for blackbody
 *     table?: [[λ_nm, value], …]} // required for custom
 *
 * Resolves to `{ sampler: (lam)=>value, lamMin, lamMax, label }`.
 */
export function resolveSourceSpec(spec) {
    if (!spec || !spec.id) return resolveSourceSpec({ id: 'E' });
    switch (spec.id) {
        case 'D65':
        case 'D50':
        case 'A':
        case 'E': {
            // Derive the integration range from the BUILTIN_SOURCES metadata
            // (single source of truth) instead of hardcoding. The old code
            // clipped BOTH 'A' and 'E' to 200–4000, but 'E' (equal energy) is
            // declared 0–1e9 — so integrals using source E were silently
            // truncated beyond 4000 nm even though equal energy applies at every λ.
            const meta = BUILTIN_SOURCES.find(s => s.id === spec.id);
            return {
                sampler: (lam) => illuminantSPD(spec.id, lam),
                lamMin: meta.lamMin, lamMax: meta.lamMax,
                label:  meta.label,
            };
        }
        case 'AM1.5G':
            return {
                sampler: solarIrradianceAt,
                lamMin: SOLAR_RANGE_NM[0], lamMax: SOLAR_RANGE_NM[1],
                label:  'AM1.5G',
            };
        case 'blackbody': {
            const T = Number.isFinite(spec.T) ? spec.T : 5778;
            return {
                sampler: (lam) => planckSPD(lam, T),
                lamMin: 0, lamMax: 1e9,
                label:  `Blackbody ${Math.round(T)} K`,
            };
        }
        case 'custom': {
            if (!spec.table?.length) return resolveSourceSpec({ id: 'E' });
            const sorted = [...spec.table].sort((a, b) => a[0] - b[0]);
            return {
                sampler: tableSampler(sorted),
                lamMin:  sorted[0][0],
                lamMax:  sorted[sorted.length - 1][0],
                label:   spec.label || 'Custom source',
                rawTable: sorted,
            };
        }
        default:
            return resolveSourceSpec({ id: 'E' });
    }
}

/**
 * Same shape as resolveSourceSpec but for the detector slot.
 *   { id: 'photopic' | 'flat' | 'custom', table?: [[λ, value], …] }
 */
export function resolveDetectorSpec(spec) {
    if (!spec || !spec.id) return resolveDetectorSpec({ id: 'flat' });
    switch (spec.id) {
        case 'photopic':
            return {
                sampler: photopicV,
                lamMin:  PHOTOPIC_RANGE_NM[0], lamMax: PHOTOPIC_RANGE_NM[1],
                label:   'Photopic V(λ)',
            };
        case 'flat':
            return {
                sampler: () => 1,
                lamMin:  0, lamMax: 1e9,
                label:   'Flat (unity)',
            };
        case 'custom': {
            if (!spec.table?.length) return resolveDetectorSpec({ id: 'flat' });
            const sorted = [...spec.table].sort((a, b) => a[0] - b[0]);
            return {
                sampler: tableSampler(sorted),
                lamMin:  sorted[0][0],
                lamMax:  sorted[sorted.length - 1][0],
                label:   spec.label || 'Custom detector',
                rawTable: sorted,
            };
        }
        default:
            return resolveDetectorSpec({ id: 'flat' });
    }
}

// ── Composer ──────────────────────────────────────────────────────────────────

/**
 * Build an integralValues-compatible weighting from a source + detector + optional
 * user-imposed band. The effective band is the intersection of the source range,
 * the detector range, and the user band (if any).
 *
 * @param {{source?:object, detector?:object, band?:[number,number], label?:string}} opts
 * @returns {{id,label,reference,kind,lamMin,lamMax,sampler,source,detector}}
 */
export function composeWeighting({ source, detector, band, label } = {}) {
    const S = resolveSourceSpec(source || { id: 'E' });
    const D = resolveDetectorSpec(detector || { id: 'flat' });

    let lamMin = Math.max(S.lamMin, D.lamMin);
    let lamMax = Math.min(S.lamMax, D.lamMax);
    if (band && Number.isFinite(band[0])) lamMin = Math.max(lamMin, band[0]);
    if (band && Number.isFinite(band[1])) lamMax = Math.min(lamMax, band[1]);

    return {
        id:        'composed',
        kind:      'sampled',
        label:     label || `${S.label} × ${D.label}`,
        reference: `${S.label} × ${D.label}` + (band ? `  on ${band[0]}–${band[1]} nm` : ''),
        lamMin,
        lamMax,
        sampler:   (lam) => S.sampler(lam) * D.sampler(lam),
        source:    S,
        detector:  D,
    };
}

// ── CSV → table parser (shared with the old user-weighting path) ──────────────

/**
 * Parse CSV/TSV/space-separated `λ, value` rows. Tolerant of headers, blank
 * lines, `#` and `//` comments. Returns sorted [[λ, v], …].
 */
export function parseSpectrumCSV(text) {
    if (!text) return [];
    const rows = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;
        const parts = line.split(/[,;\t]+|\s{2,}/).map(s => s.trim()).filter(Boolean);
        if (parts.length < 2) continue;
        const lam = parseFloat(parts[0]);
        const v   = parseFloat(parts[1]);
        if (Number.isFinite(lam) && Number.isFinite(v)) rows.push([lam, v]);
    }
    rows.sort((a, b) => a[0] - b[0]);
    return rows;
}
