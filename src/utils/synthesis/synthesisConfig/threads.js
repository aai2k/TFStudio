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
