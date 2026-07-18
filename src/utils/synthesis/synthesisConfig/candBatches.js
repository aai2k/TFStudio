/**
 * Candidate-search breadth for needle / GE ("match OTF's recipe").
 * Each outer step the scanner returns ALL improving P-function candidates; we
 * refine them in pool-sized batches (K) until one beats the current design.
 * An earlier scheme escalated through EVERY candidate (45–56 at the stall = 6–7
 * refine rounds → the 9–21 s/gen blow-up). OTF inserts the single best-P needle
 * (or a few) and moves on. This caps the number of K-batches refined per step:
 *   • 'fast'     = 1 batch  (top-K P-minima, one refine round — closest to OTF)
 *   • 'balanced' = 2 batches (default — most of the quality, ~⅓ the stall cost)
 *   • 'thorough' = unlimited (legacy: exhaust all candidates → best quality, slow)
 * Fewer batches ⇒ if none of the top-K improve we go to forced-TOT sooner (which
 * re-scans), rather than grinding the long tail of marginal candidates.
 */
const BATCHES_KEY = 'tfstudio-synth-cand-batches';
export const SYNTHESIS_CAND_MODES = ['fast', 'balanced', 'thorough'];
export const DEFAULT_SYNTHESIS_CAND_MODE = 'balanced';
const CAND_MODE_BATCHES = { fast: 1, balanced: 2, thorough: Infinity };

export function getSynthesisCandMode() {
    try {
        const v = localStorage.getItem(BATCHES_KEY);
        if (v && SYNTHESIS_CAND_MODES.includes(v)) return v;
    } catch (_) { /* no localStorage → default */ }
    return DEFAULT_SYNTHESIS_CAND_MODE;
}

export function setSynthesisCandMode(mode) {
    try { localStorage.setItem(BATCHES_KEY, mode); } catch (_) {}
}

/** Max K-batches to refine per outer step (Infinity = exhaust all candidates). */
export function getSynthesisMaxBatches() {
    return CAND_MODE_BATCHES[getSynthesisCandMode()] ?? 2;
}
