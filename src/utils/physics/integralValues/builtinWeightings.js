// ── Built-in weighting catalog ────────────────────────────────────────────────

import { solarIrradianceAt, SOLAR_RANGE_NM } from '../solarSpectrum.js';
import { illuminantSPD, photopicV } from '../colorimetry.js';
import { makeTableLookup } from './weightedIntegral.js';

// Luminous weighting S(λ)·ȳ(λ) of Macleod Eq. (12.2), S = CIE D65 and
// ȳ = V(λ) of the CIE 1931 2° observer, both linearly interpolated on their
// 5 nm tables. Integrated on the design grid like every other weighting, so a
// feature narrower than the 5 nm table spacing is still seen.
const photopicD65 = (lam) => illuminantSPD('D65', lam) * photopicV(lam);

export const BUILTIN_WEIGHTINGS = {
    photopic: {
        id:        'photopic',
        labelTr:   'photopic',
        reference: 'CIE 1924 V(λ) × CIE D65',   // designations only, nothing to translate
        lamMin:    380,
        lamMax:    780,
        kind:      'photopic',
        sampler:   photopicD65,
    },
    // The AM1.5G table starts at 280 nm, but the solar band starts at 300 nm, as
    // the solar direct transmittance of ISO 9050 does, as the solar-block merit
    // operand does, and as the Integral Values grid and the built-in glass data do.
    solar: {
        id:        'solar',
        labelTr:   'solar',
        reference: 'ASTM G173-03 AM1.5G (NREL)',  // designations only
        lamMin:    300,
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
