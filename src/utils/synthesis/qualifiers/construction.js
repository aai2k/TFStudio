/**
 * Qualifier construction (default field values).
 */

import { defaultTolForKind } from './constants.js';

function uid() { return Math.random().toString(36).slice(2, 10); }

export function makeQualifier(overrides = {}) {
    const base = {
        id:          uid(),
        enabled:     true,
        kind:        'T_AVG',
        cmp:         'ge',
        // Channel for *_AT / *_AVG / CENTRAL_LAMBDA / FWHM / EDGE_LAMBDA:
        // 'T' | 'R' | 'A' (derived from kind otherwise).
        channel:     'T',
        // Peak direction for CENTRAL_LAMBDA / FWHM:
        // 'max' | 'min'  (peak = max, notch = min).
        direction:   'max',
        // FWHM / EDGE_LAMBDA crossing level (fraction of peak; default 0.5 =
        // half-max). User can set 0.1 for HM-at-0.1T-style specs.
        level:       0.5,
        // Band / single λ
        lambdaStart: 400,
        lambdaEnd:   700,
        lambda:      550,            // single-λ kinds (*_AT)
        // AOI & pol
        aoi:         0,
        pol:         'avg',
        // Threshold(s)
        target:      0.99,           // for cmp = ge/le/eq (eq uses ±tol)
        tol:         0.01,           // eq tolerance
        lo:          0.95,           // for cmp = between
        hi:          1.00,
        // INTEGRAL specs — source/detector/band are normally stamped from a
        // named integral preset (presetKey); the raw fields below are the
        // fallback for a qualifier that matches no saved preset.
        presetKey:   '',
        presetLabel: '',
        source:      { id: 'D65' },
        detector:    { id: 'photopic' },
        // bandPoints (sampling density for argmax / FWHM scans) is NOT stamped
        // on the qualifier — it's an implementation hyperparameter that
        // defaults at evaluation time (ARGWAVE_DEFAULT_POINTS in optimizer.js).
        // This way a default change later upgrades existing qualifiers on disk
        // automatically, and Specification stays consistent with the equivalent
        // MF operand by construction (both use the same runtime default).
        // User can still override per-qualifier by setting `bandPoints`
        // explicitly (e.g. via a future "Advanced" panel).
        // User-visible label (auto-derived from kind if blank)
        label:       '',
        ...overrides
    };
    // Tolerance follows the (possibly overridden) kind unless the caller set it
    // explicitly — so an nm-valued kind gets an nm-scale tol, not 0.01 nm.
    if (overrides.tol == null) base.tol = defaultTolForKind(base.kind);
    return base;
}
