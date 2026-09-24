/**
 * Seed-handling / refine-strength mode for needle / GE synthesis
 * ("preserve-bulk + gentle refine").
 *
 * What it is for. A lone layer cannot lower a multiband merit much at any
 * thickness, and refining it can move it a long way. Measured headless on the
 * 4-line OTF-demo target (benchmark case otf4) from a bare 7000 nm TiO2 seed,
 * dMin 15: refined to convergence, CG takes the seed to about 4500 nm for a
 * merit change from 0.539 to 0.534, while DLS and SQP keep it within 2 %.
 * Gradual Evolution does far better from the unrefined seed, with the needles
 * going into the bulk (numbers below).
 *
 * NOTE: only Gradual Evolution consumes this. Standalone Needle scans first and
 * never refines the bare seed, so it keeps the bulk by itself and does NOT
 * read this setting (the GUI control lives in the GE window only).
 *
 *   • 'refine'        = legacy: full bare-seed refine + full per-step refine
 *                       to convergence.
 *   • 'preserve-bulk' = (GE DEFAULT) on a thick seed:
 *       (1) SKIP the bare-seed refine: keep the seed at full thickness
 *           (evaluate MF only),
 *       (2) needle INTO the thick bulk (intra-layer, already produced by the
 *           scanner),
 *       (3) refine GENTLY per step (PRESERVE_BULK_GENTLE_ITER iteration cap).
 *           The gentle cap also doubles as a per-step speed lever.
 *
 * GE with the worker-pool runner on that target (CG inner engine, dMin 15,
 * 50 layers, 16 GE steps), merit on the run's own operands:
 *   preserve-bulk  MF 0.046, 39 layers, final TOT 2884 nm, half the run time
 *   refine         MF 0.128, 25 layers, final TOT 1658 nm
 * preserve-bulk would REGRESS Needle, but Needle doesn't read this, so the
 * default is GE-only and safe.
 */
const SEED_MODE_KEY = 'tfstudio-synth-seed-mode';
export const SYNTHESIS_SEED_MODES = ['refine', 'preserve-bulk'];
export const DEFAULT_SYNTHESIS_SEED_MODE = 'preserve-bulk';

/** Per-step inner-refine iteration cap when seed mode = 'preserve-bulk'. Kept
 *  small so the refine after each insertion adjusts the structure the needles
 *  build rather than moving the bulk. Applied as min(dlsIter, this) so a user
 *  who lowers dlsIter is still respected. */
export const PRESERVE_BULK_GENTLE_ITER = 15;

export function getSynthesisSeedMode() {
    try {
        const v = localStorage.getItem(SEED_MODE_KEY);
        if (v && SYNTHESIS_SEED_MODES.includes(v)) return v;
    } catch (_) { /* no localStorage (worker/test) → default */ }
    return DEFAULT_SYNTHESIS_SEED_MODE;
}

export function setSynthesisSeedMode(mode) {
    try { localStorage.setItem(SEED_MODE_KEY, mode); } catch (_) {}
}
