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
