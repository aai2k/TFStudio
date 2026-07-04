/**
 * User-selectable INNER REFINER for needle / Gradual-Evolution synthesis.
 * Needle/GE = insert a layer → refine ALL thicknesses → repeat;
 * this selects the refiner for that inner step.
 *
 * CURRENT DEFAULT: all three tools default to 'cg' (see ENGINE_DEFAULTS below).
 * An earlier PER-TOOL scheme defaulted GE to 'dls' on the strength of a 4-line
 * multipassband GUI run, but the grand cross-optimizer benchmark superseded it
 * — CG is the more robust inner refiner across the case set and does not stall
 * where DLS does. DLS remains a fully supported, user-selectable engine (and is
 * competitive / faster on easy dielectric AR targets), so a user who prefers it
 * can pick it per tool.
 *
 * localStorage-backed PER TOOL (renderer only). The synthesis worker never reads
 * this; the main thread reads it and passes `engine` in each worker job, so the
 * worker stays context-free.
 */
const ENGINE_KEY = 'tfstudio-synth-inner-engine';
// All LOCAL refiners are valid inner engines for synthesis (insert → refine →
// repeat). DE/SA are global population methods — unsuitable as a per-step inner
// refiner — so they are intentionally not offered here. newton/newton-cg/sqp now
// work in every surface mode (dls.js _gaussNewtonSystem), so they are safe here.
export const SYNTHESIS_INNER_ENGINES = ['cg', 'dls', 'newton', 'newton-cg', 'sqp'];
// All three default to CG: the grand benchmark showed CG is
// the best inner refiner for synthesis — it preserves the thin layers the scan
// inserts and lets them mature, while second-order engines (Newton/Newton-CG/
// SQP) take aggressive steps that COLLAPSE the fresh stack (Needle→1 layer,
// GE→stalled). CG wins Needle (4/5 cases) and Structural (4/5); for GE it's the
// robust choice — it does not stall on multipassbands where DLS gets stuck
// (3-line bandpass: DLS 0.522/4-layers vs CG 0.116/33-layers).
const ENGINE_DEFAULTS = { needle: 'cg', ge: 'cg', structural: 'cg' };

export function getSynthesisInnerEngine(tool = 'ge') {
    try {
        const v = localStorage.getItem(`${ENGINE_KEY}-${tool}`);
        if (v && SYNTHESIS_INNER_ENGINES.includes(v)) return v;
    } catch (_) { /* no localStorage (worker/test) → default */ }
    return ENGINE_DEFAULTS[tool] || 'dls';
}

export function setSynthesisInnerEngine(tool, engine) {
    try { localStorage.setItem(`${ENGINE_KEY}-${tool}`, engine); } catch (_) {}
}

/**
 * Worker-thread budget for the optimizer worker pools (synthesis + refinement).
 *
 * A GLOBAL machine-resource setting (one value, shared by every synthesis and
 * refinement window) — it governs how many CPU threads our Web-Worker pools may
 * run in parallel. Detected from the hardware (`navigator.hardwareConcurrency`).
 *
 * The DEFAULT deliberately leaves the main/UI thread plus some headroom free, so
 * the app stays responsive and the user's machine is not fully saturated by us —
 * while still scaling UP on many-core CPUs (we are not shy on a powerful box).
 * The user can override with the "Threads" dropdown (range 1 … all detected
 * cores; picking "all cores" is allowed but is not the default).
 *
 * localStorage-backed, renderer-only. The worker pools read it at run start
 * (disabled while running), so a change takes effect on the next run.
 */
const THREADS_KEY = 'tfstudio-worker-threads';

export function detectCores() {
    return (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
}

// Default thread budget — leave the main thread + headroom free, scale with cores:
//   ≤2 cores → 1            (don't contend with the UI thread on a weak machine)
//   3–4      → cores − 1    (leave 1 free)
//   5–8      → cores − 2    (leave 2 free: main + OS/UI headroom)
//   9+       → round(cores · 0.75)  (big CPUs: use ~¾, never all by default)
export function defaultThreadCount(cores = detectCores()) {
    if (cores <= 2) return 1;
    if (cores <= 4) return cores - 1;
    if (cores <= 8) return cores - 2;
    return Math.round(cores * 0.75);
}

// Effective thread budget: the user's saved choice, clamped to [1, cores], or the
// scaled default when unset. Always ≥ 1 and never exceeds the detected core count.
export function getThreadCount() {
    const cores = detectCores();
    let v;
    try {
        const s = localStorage.getItem(THREADS_KEY);
        if (s != null) v = parseInt(s, 10);
    } catch (_) { /* no localStorage (worker/test) → default */ }
    if (!Number.isFinite(v) || v < 1) v = defaultThreadCount(cores);
    return Math.max(1, Math.min(cores, v));
}

export function setThreadCount(n) {
    try { localStorage.setItem(THREADS_KEY, String(Math.max(1, n | 0))); } catch (_) {}
}

// Dropdown choices [value, label] for 1 … all detected cores. `t` (locales) is
// passed in so the "recommended" / "all cores" annotations are localized without
// this leaf module importing the locale table. Numbers themselves are not text.
export function threadSelectOptions(t) {
    const cores = detectCores();
    const def   = defaultThreadCount(cores);
    const recommended = t?.settings?.threadsRecommended || 'recommended';
    const allCores    = t?.settings?.threadsAll || 'all cores';
    const out = [];
    for (let n = 1; n <= cores; n++) {
        const tags = [];
        if (n === def)   tags.push(recommended);
        if (n === cores && cores > 1) tags.push(allCores);
        out.push([String(n), tags.length ? `${n} (${tags.join(', ')})` : String(n)]);
    }
    return out;
}

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

// ── Smart starting design ("seed") ──────────────────────────────────────────────
// When ON, a synthesis run first generates the canonical QW/HW antireflection
// starting designs from the material pool, refines each OFF-THREAD on the worker
// pool (so the UI never blocks), and begins synthesis from whichever scores best.
// The CURRENT design is always included as a candidate, so enabling the seed can
// only match or improve the starting point — it never replaces a better design
// with a worse generated one. Default OFF (opt-in; an explicit user choice).
// Per-window setting (scope = 'needle' | 'ge' | 'structural'). Defaults differ by
// window: GE and Structural GROW a stack, so a smart QW/HW AR seed is a good head
// start → default ON. Needle CARVES from a (often thick) seed, where replacing the
// start with a generated AR design is usually NOT wanted → default OFF. An explicit
// user toggle (stored '1'/'0') always wins over the default. A bare key (no scope)
// keeps the legacy global behaviour, default OFF.
const SMART_SEED_KEY = 'tfstudio-synth-smart-seed';
const SMART_SEED_DEFAULTS = { needle: false, ge: true, structural: true };
export function getSynthesisSmartSeed(scope = '') {
    const key = SMART_SEED_KEY + (scope ? `-${scope}` : '');
    try {
        const v = localStorage.getItem(key);
        if (v === '1' || v === 'true')  return true;
        if (v === '0' || v === 'false') return false;   // explicit user choice wins
    } catch (_) { /* no localStorage → fall through to default */ }
    return SMART_SEED_DEFAULTS[scope] ?? false;
}
export function setSynthesisSmartSeed(on, scope = '') {
    const key = SMART_SEED_KEY + (scope ? `-${scope}` : '');
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (_) {}
}

// NOTE: adaptive merit sampling is ALWAYS ON and has no setting —
// it's a correctness fix (the merit was blind to spectral features narrower than
// the operand grid step) and a no-op on smooth designs, so there is nothing to
// toggle. The engine lives in optimizer.js (densifyOperandsForFeatures); each
// optimizer window calls it at run launch via a local densifyForRun helper.
