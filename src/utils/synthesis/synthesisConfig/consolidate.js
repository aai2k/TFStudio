/**
 * Merit-aware layer CONSOLIDATION on synthesis finish (Macleod, "Automatic
 * Design": the needle method's thin/redundant layers "must then be processed to
 * remove them"). When enabled, the synthesis state machine runs one
 * `removePass` over the best design at finalize — trial-deleting each
 * non-locked layer, re-refining, and keeping the deletion iff the merit does not
 * worsen by more than `tol` (relative). This strips the layers an MNT penalty
 * parks at ≈dMin (which plain cleanupLayers cannot remove) — the bloat behind
 * GE's many-layer results for compact optima.
 *
 *   • enabled : default ON (cheap finalize step; only removes merit-neutral layers)
 *   • tol     : relative merit slack to still drop a layer (default 0.05 = 5 %)
 */
const CONSOLIDATE_KEY     = 'tfstudio-synth-consolidate';
const CONSOLIDATE_TOL_KEY = 'tfstudio-synth-consolidate-tol';
export const DEFAULT_CONSOLIDATE_TOL = 0.05;

export function getSynthesisConsolidate() {
    try {
        const v = localStorage.getItem(CONSOLIDATE_KEY);
        if (v === '0' || v === 'false') return false;
    } catch (_) { /* no localStorage → default ON */ }
    return true;
}
export function setSynthesisConsolidate(on) {
    try { localStorage.setItem(CONSOLIDATE_KEY, on ? '1' : '0'); } catch (_) {}
}
export function getSynthesisConsolidateTol() {
    try {
        const v = parseFloat(localStorage.getItem(CONSOLIDATE_TOL_KEY));
        if (Number.isFinite(v) && v >= 0) return v;
    } catch (_) { /* default */ }
    return DEFAULT_CONSOLIDATE_TOL;
}
export function setSynthesisConsolidateTol(tol) {
    try { localStorage.setItem(CONSOLIDATE_TOL_KEY, String(tol)); } catch (_) {}
}
