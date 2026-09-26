/**
 * Needle Variation's "Min thickness" smart default.
 *
 * Standalone Needle is a SYNTHESIS step (find structure with thin needles).
 * dMin here is the *synthesis* floor: it controls (a) the needle line-search
 * lower bound, (b) the post-DLS prune threshold. It MUST stay small (default
 * 1 nm) regardless of the user's MNT setting, otherwise every "needle" is
 * force-fed at MNT thickness and synthesis collapses. GE uses the MNT-coupled
 * dMin because its forced-TOT step escapes the resulting local minimum;
 * Needle has no such escape, so it can't. Manufacturability is restored later
 * by the Refinement + Cleaner loop. The field follows this value as GE's and
 * Structural's follow the MNT row (synthesisShared/minThickness.js).
 */
export const NEEDLE_DMIN_DEFAULT = 1.0;   // nm
