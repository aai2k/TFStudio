// ── Built-in weighting catalog ────────────────────────────────────────────────

import { solarIrradianceAt, SOLAR_RANGE_NM } from '../solarSpectrum.js';
import { makeTableLookup } from './weightedIntegral.js';

export const BUILTIN_WEIGHTINGS = {
    photopic: {
        id:        'photopic',
        labelTr:   'photopic',
        reference: 'CIE 1924 V(λ) × CIE D65',   // designations only, nothing to translate
        lamMin:    380,
        lamMax:    780,
        kind:      'photopic',          // special: routes through tristimulus()
    },
    solar: {
        id:        'solar',
        labelTr:   'solar',
        reference: 'ASTM G173-03 AM1.5G (NREL)',  // designations only
        lamMin:    SOLAR_RANGE_NM[0],
        lamMax:    SOLAR_RANGE_NM[1],
        kind:      'sampled',
        sampler:   solarIrradianceAt,
    },
    uv: {
        id:        'uv',
        labelTr:   'uv',
        refTr:     'uvRef',
        lamMin:    300,
        lamMax:    380,
        kind:      'flat',
        sampler:   () => 1,
    },
    nir: {
        id:        'nir',
        labelTr:   'nir',
        refTr:     'nirRef',
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
export function makeUserWeighting(table, label) {
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

/**
 * Name and reference note for a weighting. `tr` is t.integralValues.weightings.
 * A user weighting carries its own name, so it has neither key.
 */
export function weightingText(weighting, tr) {
    return {
        label:     weighting.labelTr ? tr[weighting.labelTr] : weighting.label,
        reference: weighting.refTr ? tr[weighting.refTr] : weighting.reference,
    };
}
