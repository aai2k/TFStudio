/**
 * Needle SENSITIVITY threshold — a documented #1 needle/GE speedup.
 * Each scan returns ALL improving P-function needles
 * (predicted ΔMF < 0); the weak tail improves the design only negligibly yet
 * each one still costs a full DLS refine round. This culls needles whose
 * predicted |ΔMF| is below `relFloor × |ΔMF|` of the STRONGEST needle in the
 * same scan — a self-scaling threshold (independent of MF normalization). When
 * every remaining needle is culled the loop reaches needle-optimality → forced
 * TOT step sooner (the "preemptive-GE" escape; Sullivan 1996 "refine completely
 * after each insertion", Tikhonravov GE forced-thickness step).
 *
 * Complements candMode (which caps refine BATCHES): sensitivity prunes the
 * candidate LIST up front, candMode caps how many of the survivors we refine.
 * Threshold is relative to the STRONGEST needle in the same scan and always keeps
 * that strongest needle, so it only trims the marginal tail and can never stall
 * stack growth (see cullMarginalNeedles for why the more aggressive MF-relative
 * variant was rejected). It therefore only changes 'thorough' (uncapped) runs;
 * with the default batch cap the tail is already ignored, so it is a safe no-op
 * there. Default OFF until the stagnation-based preemptive escape is added.
 *   • 'off'        = keep every improving needle (legacy / bit-identical) — default
 *   • 'light'      = drop needles weaker than 1 % of the best
 *   • 'medium'     = drop weaker than 5 %
 *   • 'aggressive' = drop weaker than 15 %
 */
const NEEDLE_SENS_KEY = 'tfstudio-needle-sensitivity';
export const NEEDLE_SENS_MODES = ['off', 'light', 'medium', 'aggressive'];
export const DEFAULT_NEEDLE_SENS_MODE = 'off';
const NEEDLE_SENS_FLOOR = { off: 0, light: 0.01, medium: 0.05, aggressive: 0.15 };

export function getNeedleSensMode() {
    try {
        const v = localStorage.getItem(NEEDLE_SENS_KEY);
        if (v && NEEDLE_SENS_MODES.includes(v)) return v;
    } catch (_) { /* no localStorage → default */ }
    return DEFAULT_NEEDLE_SENS_MODE;
}

export function setNeedleSensMode(mode) {
    try { localStorage.setItem(NEEDLE_SENS_KEY, mode); } catch (_) {}
}

/** Relative-to-strongest-needle predicted-|ΔMF| floor (0 = keep all). */
export function getNeedleSensFloor() {
    return NEEDLE_SENS_FLOOR[getNeedleSensMode()] ?? 0;
}

// Needle-sensitivity cull. `queue` must already be filtered to improving
// needles (dMF < 0) and sorted best-first (strongest |ΔMF| at [0]). Drops the
// marginal TAIL — needles whose predicted |ΔMF| is below `relFloor × |ΔMF_best|`
// of the strongest needle in THIS scan — so a 'thorough' (uncapped) synthesis
// run stops grinding the long tail of near-zero-gain candidates. Always keeps
// the strongest needle (never empties) so it can NEVER stall stack growth.
// relFloor falsy/≤0 returns the queue UNCHANGED ⇒ bit-identical legacy path.
//
// NOTE: a MORE aggressive MF-relative variant that could empty
// the queue (predicted |ΔMF| < relFloor·MF) was prototyped to trigger a preemptive
// forced-TOT step, but it REGRESSED hard cases — on a thick-seed bandpass it culled
// every (individually weak) early needle and froze the design at 1 layer. The
// effective-and-safe preemptive escape must be STAGNATION-based (force TOT after N
// consecutive needles of negligible ACTUAL improvement), not a per-scan predicted-
// ΔMF cull — deferred to a follow-up. This tail-trim is the safe subset.
// Pure / node-safe (shared by the headless runSynth driver and the UI windows).
export function cullMarginalNeedles(queue, relFloor) {
    if (!relFloor || relFloor <= 0 || !queue || queue.length <= 1) return queue;
    const top = Math.abs(queue[0].dMF);          // strongest needle (sorted best-first)
    if (!(top > 0)) return queue;
    const floor = relFloor * top;
    const culled = queue.filter(c => Math.abs(c.dMF) >= floor);
    return culled.length ? culled : queue.slice(0, 1);   // never empty (keep the best)
}
