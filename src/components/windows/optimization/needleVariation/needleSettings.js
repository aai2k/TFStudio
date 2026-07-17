/**
 * Needle Variation's "Min thickness" smart default.
 *
 * Standalone Needle is a SYNTHESIS step (find structure with thin needles).
 * dMin here is the *synthesis* floor — it controls (a) the needle line-search
 * lower bound, (b) the post-DLS prune threshold. It MUST stay small (default
 * 1 nm) regardless of the user's MNT setting, otherwise every "needle" is
 * force-fed at MNT thickness and synthesis collapses. GE uses the MNT-coupled
 * dMin because its forced-TOT step escapes the resulting local minimum;
 * Needle has no such escape, so it can't. Manufacturability is restored later
 * by the Refinement + Cleaner loop.
 */

// A persisted dMin counts as user-set (skip the synthesis-floor default on
// remount); a genuine design switch still re-derives.
export function deriveDMinDefault({ design, lastIdForDMin, dMinTouchedRef, runningRef, dMinRef, setDMin }) {
    const id = design?.id ?? null;
    if (lastIdForDMin.current !== id) {
        const firstMount = lastIdForDMin.current === null;
        lastIdForDMin.current = id;
        if (!firstMount) dMinTouchedRef.current = false;
    }
    if (runningRef.current || dMinTouchedRef.current) return;
    const def = 1.0;   // synthesis floor — thin needles by design
    if (Math.abs((dMinRef.current || 0) - def) > 1e-9) { setDMin(def); dMinRef.current = def; }
}
