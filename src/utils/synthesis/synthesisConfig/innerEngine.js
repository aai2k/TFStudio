/**
 * User-selectable INNER REFINER for needle / Gradual-Evolution synthesis.
 * Needle/GE = insert a layer → refine ALL thicknesses → repeat;
 * this selects the refiner for that inner step. Each tool starts from its entry
 * in ENGINE_DEFAULTS below, and the user can pick any of the others per tool.
 *
 * localStorage-backed PER TOOL (renderer only). The synthesis worker never reads
 * this; the main thread reads it and passes `engine` in each worker job, so the
 * worker stays context-free.
 */
const ENGINE_KEY = 'tfstudio-synth-inner-engine';
// All LOCAL refiners are valid inner engines for synthesis (insert → refine →
// repeat). DE/SA are global population methods, unsuitable as a per-step inner
// refiner, so they are intentionally not offered here. newton/newton-cg/sqp now
// work in every surface mode (dls.js _gaussNewtonSystem), so they are safe here.
// 'trust-region' is the synthesis lab's refinement (optimizers/trustRegionNewton.js).
export const SYNTHESIS_INNER_ENGINES = ['cg', 'dls', 'newton', 'newton-cg', 'sqp', 'trust-region'];
// Needle refines with trust-region. The Needle window's own run was compared
// with CG, Newton and trust-region at 3 threads (a 4-core machine) and the
// window's other defaults, from the optimizer benchmark's thick starting
// designs and material pool. Trust-region ended lower than CG on five of the
// six cases and reached the target with fewer layers on the sixth; on the
// 3-line bandpass, which runs to the layer cap, it ended twelve times lower.
// Newton ended about as low and took longer in total. No refiner collapsed the
// stack. Gradual Evolution and Structural refine with CG.
export const ENGINE_DEFAULTS = { needle: 'trust-region', ge: 'cg', structural: 'cg' };

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
