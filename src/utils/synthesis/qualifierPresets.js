/**
 * Built-in Specification preset library.
 *
 * One-click templates for the most common coating-design specs. Each
 * preset produces a list of `makeQualifier(...)` items the user can
 * apply (replacing or appending to their current qualifier list).
 *
 * Built-ins live here; saved user presets live on disk under
 * Documents\TFStudio\Qualifiers\<name>.tfsq (see main.js qualifiers:* IPC).
 *
 * Reference: standard coating specs from Macleod 5th ed. Ch.3–7; ITU-T G.694.1
 * for DWDM grid; CIE 15:2004 for photopic / D65.
 */

import { makeQualifier } from './qualifiers.js';

// Each preset = { id, label, description, kinds: [...] } where kinds is a
// list of qualifier override objects passed to makeQualifier.
export const QUALIFIER_PRESETS = [
    {
        id:          'BBAR_VIS',
        label:       'BBAR visible (400–700 nm)',
        description: 'Broadband AR: Tavg ≥ 99 %, Rmax ≤ 1 % across the visible band.',
        kinds: [
            { kind: 'T_AVG', channel: 'T', cmp: 'ge', target: 0.99,
              lambdaStart: 400, lambdaEnd: 700, label: 'T avg ≥ 99 %' },
            { kind: 'R_AVG', channel: 'R', cmp: 'le', target: 0.01,
              lambdaStart: 400, lambdaEnd: 700, label: 'R avg ≤ 1 %' },
        ],
    },
    {
        id:          'PHOTOPIC_AR',
        label:       'Photopic AR (Tvis ≥ 99 %)',
        description: 'Visual-weighted Tvis ≥ 99 % under D65 × CIE 2° photopic.',
        kinds: [
            { kind: 'INTEGRAL', channel: 'T', cmp: 'ge', target: 0.99,
              lambdaStart: 380, lambdaEnd: 780,
              source: { id: 'D65' }, detector: { id: 'photopic' },
              label: 'Tvis (D65 × V(λ)) ≥ 99 %' },
        ],
    },
    {
        id:          'COLD_MIRROR',
        label:       'Cold mirror (vis HR + NIR pass)',
        description: 'Reflects visible (R ≥ 95 % on 400–700), transmits NIR (T ≥ 90 % on 800–1100).',
        kinds: [
            { kind: 'R_AVG', channel: 'R', cmp: 'ge', target: 0.95,
              lambdaStart: 400, lambdaEnd: 700, label: 'R vis ≥ 95 %' },
            { kind: 'T_AVG', channel: 'T', cmp: 'ge', target: 0.90,
              lambdaStart: 800, lambdaEnd: 1100, label: 'T NIR ≥ 90 %' },
        ],
    },
    {
        id:          'HOT_MIRROR',
        label:       'Hot mirror (vis pass + NIR HR)',
        description: 'Transmits visible (T ≥ 90 % on 400–700), reflects NIR (R ≥ 90 % on 800–1100).',
        kinds: [
            { kind: 'T_AVG', channel: 'T', cmp: 'ge', target: 0.90,
              lambdaStart: 400, lambdaEnd: 700, label: 'T vis ≥ 90 %' },
            { kind: 'R_AVG', channel: 'R', cmp: 'ge', target: 0.90,
              lambdaStart: 800, lambdaEnd: 1100, label: 'R NIR ≥ 90 %' },
        ],
    },
    {
        id:          'DWDM_100GHZ_C',
        label:       'DWDM C-band 100 GHz (≈1550 nm)',
        description: 'Bandpass filter: peak at 1550 ± 0.1 nm, FWHM ≤ 0.4 nm, Tpeak ≥ 95 %.',
        kinds: [
            { kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max',
              cmp: 'eq', target: 1550, tol: 0.1,
              lambdaStart: 1530, lambdaEnd: 1570,
              label: 'λ_center = 1550 ± 0.1 nm' },
            { kind: 'FWHM', channel: 'T', direction: 'max', level: 0.5,
              cmp: 'le', target: 0.4,
              lambdaStart: 1545, lambdaEnd: 1555,
              label: 'FWHM ≤ 0.4 nm' },
            { kind: 'T_AT', channel: 'T', cmp: 'ge', target: 0.95,
              lambda: 1550, label: 'T(1550) ≥ 95 %' },
        ],
    },
    {
        id:          'LP_FILTER_VIS',
        label:       'Long-pass filter @ 600 nm',
        description: 'Edge at 600 nm: T ≤ 1 % below 580 nm, T ≥ 90 % above 620 nm.',
        kinds: [
            { kind: 'T_AVG', channel: 'T', cmp: 'le', target: 0.01,
              lambdaStart: 400, lambdaEnd: 580, label: 'T blocked ≤ 1 %' },
            { kind: 'EDGE_LAMBDA', channel: 'T', level: 0.5,
              cmp: 'eq', target: 600, tol: 5,
              lambdaStart: 580, lambdaEnd: 620, label: 'Edge = 600 ± 5 nm' },
            { kind: 'T_AVG', channel: 'T', cmp: 'ge', target: 0.90,
              lambdaStart: 620, lambdaEnd: 800, label: 'T pass ≥ 90 %' },
        ],
    },
    {
        id:          'AR_550_VCOAT',
        label:       'V-coat AR @ 550 nm',
        description: 'Single-wavelength AR: R(550) ≤ 0.2 %, T(550) ≥ 99 %.',
        kinds: [
            { kind: 'R_AT', channel: 'R', cmp: 'le', target: 0.002,
              lambda: 550, label: 'R(550) ≤ 0.2 %' },
            { kind: 'T_AT', channel: 'T', cmp: 'ge', target: 0.99,
              lambda: 550, label: 'T(550) ≥ 99 %' },
        ],
    },
];

// Instantiate a preset into concrete qualifier objects (with fresh ids).
export function applyPreset(presetId) {
    const p = QUALIFIER_PRESETS.find(x => x.id === presetId);
    if (!p) return [];
    return p.kinds.map(spec => makeQualifier(spec));
}

// Find a preset descriptor (for UI display).
export function getPreset(presetId) {
    return QUALIFIER_PRESETS.find(x => x.id === presetId) || null;
}
