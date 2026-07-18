/**
 * (m, k) parameter translation between the standard WDM notation and the
 * internal `mirrorPairs` / `spacerOrder` naming. See ../wdmDesigner.js for
 * the full geometry model and references.
 *
 * The standard WDM (m, k) notation uses:
 *   m = number of external mirror LAYERS (counting H and L)
 *   k = order of prototype spacer (half-waves)
 *
 * Internal code uses `mirrorPairs` (= H+L QW pairs) and `spacerOrder`.
 * Mapping:
 *   m  =  2 · mirrorPairs    (each "pair" is 2 layers)
 *   k  =  spacerOrder
 */

export function notationM_to_mirrorPairs(m) { return Math.max(1, Math.round(m / 2)); }
export function mirrorPairs_to_notationM(p) { return 2 * Math.max(1, Math.round(p)); }
