/**
 * Qualifiers / Design Specifications — PUBLIC BARREL.
 *
 * A *qualifier* is a single PASS/FAIL design requirement, e.g.
 *   "T at 550 nm ≥ 99 %",
 *   "Avg T over 400–700 nm ≥ 92 %",
 *   "Central λ of bandpass = 550 ± 10 nm",
 *   "FWHM ≤ 20 nm at 50 % of peak T",
 *   "Visible-weighted Tvis ≥ 90 %",
 *   "Total physical thickness ≤ 2000 nm",
 *   "Layer count ≤ 30".
 *
 * Each qualifier carries:
 *   - id, enabled
 *   - kind: one of QUALIFIER_KINDS (T_AT / T_AVG / R_AT / R_AVG / A_AT /
 *           A_AVG / CENTRAL_LAMBDA / FWHM / EDGE_LAMBDA / INTEGRAL /
 *           THICKNESS_BUDGET / LAYER_COUNT)
 *   - cmp: 'ge' | 'le' | 'eq' (with tol) | 'between' (lo, hi)
 *   - lambdaStart, lambdaEnd (depending on kind)
 *   - aoi, pol
 *   - target, tol, lo, hi
 *   - level — FWHM crossing fraction (0..1; default 0.5)
 *   - source, detector — for INTEGRAL kind only
 *
 * The implementation is split into focused modules under ./qualifiers/:
 *   constants      → QUALIFIER_KINDS, QUALIFIER_CMPS, defaultTolForKind
 *   construction   → makeQualifier
 *   channelTypes   → channel / MF-operand-type helpers
 *   format         → value formatting + threshold comparison
 *   bandScan       → FWHM / EDGE_LAMBDA dense-scan evaluation
 *   evaluate       → evaluateQualifier / evaluateQualifiers / aggregateVerdict
 *   mfOperands     → qualifiersToMFOperands (the "Generate MF from
 *                    qualifiers" button: converts each qualifier into one or
 *                    more OPGT/OPLT operands (12.2.1), written into
 *                    design.meritOperands by the Specification window)
 * This file re-exports their full surface so every existing importer
 * (components, tests) is unchanged.
 */

export * from './qualifiers/constants.js';
export * from './qualifiers/construction.js';
export * from './qualifiers/evaluate.js';
export * from './qualifiers/mfOperands.js';

// Return an empty qualifier list. Designers usually start blank and add rows
// as their spec sheet dictates.
export function emptyQualifiers() { return []; }
