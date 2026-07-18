/**
 * Seed-handling / refine-strength mode for needle / GE synthesis
 * ("preserve-bulk + gentle refine").
 *
 * ROOT CAUSE this addresses (confirmed headless on the 4-line OTF-demo
 * target): refining a bare thick single-layer seed (≈7000 nm) to convergence
 * COLLAPSES its optical thickness to ≈2000 nm (29 % retained) for ZERO MF gain
 * — a lone layer cannot lower a broadband merit at any thickness, so CG just
 * drifts it thin and discards the optical-thickness budget the filter needs.
 * Needling then runs TOT-starved and the design stalls rippled (~0.106 MF /
 * ~36 layers) far above OTF's flat ~96-layer / TOT≈8500 solution. A needle
 * history where TOT starts at the seed value and only ever GROWS — never
 * throwing the seed away — is the desired behavior.
 *
 * NOTE: only Gradual Evolution consumes this — standalone Needle scans-first and
 * never refines the bare seed, so it already "preserves bulk" intrinsically and
 * does NOT read this setting (the GUI control lives in the GE window only).
 *
 *   • 'refine'        = legacy: full bare-seed DLS refine + full per-step refine
 *                       to convergence.
 *   • 'preserve-bulk' = (GE DEFAULT) match OTF's recipe on a
 *                       thick seed:
 *       (1) SKIP the bare-seed refine — keep the seed at full thickness
 *           (evaluate MF only, no thinning),
 *       (2) needle INTO the thick bulk (intra-layer — already produced by the
 *           scanner; no change needed there),
 *       (3) refine GENTLY per step (PRESERVE_BULK_GENTLE_ITER iteration cap) so
 *           structure persists and TOT grows organically like OTF instead of
 *           collapsing to the thin optimum. The gentle cap also doubles as a
 *           per-step speed lever.
 *
 * Chosen as the GE default after a verified GUI benchmark (4-line OTF demo,
 * GE+DLS): preserve-bulk vs legacy refine = MF-neutral
 * (0.0876 vs 0.0875) but ~2× FASTER (26 s vs 50 s) and holds 1.5× the TOT
 * (4821 vs 3169 nm) — same quality, faster, more OTF-like structure. (For the
 * CG engine it also holds far more TOT: 5574 vs 2556 nm.) preserve-bulk would
 * REGRESS Needle, but Needle doesn't read this, so the flip is GE-only and safe.
 * tests/synthesis_preserve_bulk.mjs.
 */
const SEED_MODE_KEY = 'tfstudio-synth-seed-mode';
export const SYNTHESIS_SEED_MODES = ['refine', 'preserve-bulk'];
export const DEFAULT_SYNTHESIS_SEED_MODE = 'preserve-bulk';

/** Per-step inner-refine iteration cap when seed mode = 'preserve-bulk'. Kept
 *  deliberately small so refinement tunes the structure without driving the
 *  bulk to the thin optimum (the collapse this mode isolated). Applied as
 *  min(dlsIter, this) so a user who lowers dlsIter is still respected. */
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
