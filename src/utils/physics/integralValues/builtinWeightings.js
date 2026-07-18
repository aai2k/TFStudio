// ── Built-in weighting catalog ────────────────────────────────────────────────

import { AM1_5G_5NM, solarIrradianceAt, SOLAR_RANGE_NM } from '../solarSpectrum.js';
import { makeTableLookup } from './weightedIntegral.js';

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
