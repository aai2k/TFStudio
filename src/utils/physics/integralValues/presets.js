// ── Standard integral presets ─────────────────────────────────────────────────

import { SOLAR_RANGE_NM } from '../solarSpectrum.js';
import { BUILTIN_WEIGHTINGS } from './builtinWeightings.js';

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
