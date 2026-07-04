/**
 * Global-Refinement engine base class.
 *
 * The new optimization engines (Differential Evolution, Simulated Annealing,
 * Conjugate Gradient) all solve the SAME problem the DLS refiner solves:
 * minimize the merit function over the layer-thickness vector of a FIXED stack.
 * They do NOT change the layer count (that is synthesis — Needle / Gradual
 * Evolution). Per Macleod (Thin-Film Optical Filters, 5th ed., "Automatic
 * Design"): refinement = adjustment without structural change.
 *
 * To guarantee the engines minimize EXACTLY the same function as DLS — with
 * identical surface-mode handling (front_only / back_only / symmetric /
 * both_independent), bounds, locks, material resolution, and design write-back
 * — each engine wraps a `DLSOptimizer` instance used purely as an *evaluator*
 * (`mfAt` / `gradMF` / `applyToDesign`). The wrapped DLS `step()` is never
 * called, so the validated, bit-identical DLS path is untouched.
 *
 * Common interface (matches DLSOptimizer so the Refinement orchestrator /
 * worker pool stay method-agnostic):
 *   step()            advance one iteration (engine-specific "iteration":
 *                     DE = one generation, SA = one cooling sweep, CG = one
 *                     conjugate step + line search)
 *   isConverged()     -> bool
 *   restoreBest()     reset current state to the best found
 *   applyToDesign(d)  -> design with the engine's current thicknesses written back
 *   .mf .mfBest .thickBest .thicknesses .iter .layerSide
 */

import { DLSOptimizer } from '../physics/optimizer.js';

// Small deterministic PRNG (mulberry32) — used by DE/SA when a seed is given
// (tests need reproducibility). App/worker code passes no seed → Math.random.
export function makeRng(seed) {
    if (seed == null) return Math.random;
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Box-Muller standard normal from a uniform rng.
export function gaussian(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class EngineBase {
    constructor(operands, design, resolveMat, opts = {}) {
        // The evaluator. Owns surface-mode vector layout, bounds, locks, ñ
        // resolution and applyToDesign. Never stepped.
        this._ev = new DLSOptimizer(operands, design, resolveMat, opts);

        this.D_MIN      = this._ev.D_MIN;
        this.D_MAX      = this._ev.D_MAX;
        this.lockedMask = this._ev.lockedMask.slice();
        this.layerSide  = this._ev.layerSide;        // legacy field some callers read
        this.surfaceMode = this._ev.surfaceMode;
        this.nFront     = this._ev.nFront;
        this.dim        = this._ev.thicknesses.length;
        this.freeIdx    = this._ev.thicknesses.map((_, i) => i).filter(i => !this.lockedMask[i]);
        this.tol        = opts.tol ?? 1e-7;
        this.maxIter    = opts.maxIter ?? 500;
        this.rng        = makeRng(opts.seed);

        // x0 = the design's current thicknesses. Locked entries are pinned to
        // these forever (clampVec restores them), matching DLS semantics.
        this.x0          = this._ev.thicknesses.slice();
        this.thicknesses = this.x0.slice();
        this.mf          = this._ev.mf;
        this.mfBest      = this.mf;
        this.thickBest   = this.thicknesses.slice();
        this.iter        = 0;
    }

    mfAt(thk)  { return this._ev.mfAt(thk); }
    mfOpticalAt(thk) { return this._ev.mfOpticalAt(thk); }
    gradMF(thk) { return this._ev.gradMF(thk, this.freeIdx); }

    // Clamp to [D_MIN, D_MAX] and pin locked layers to their initial value.
    clampVec(thk) {
        const out = thk.slice();
        for (let i = 0; i < out.length; i++) {
            if (this.lockedMask[i]) { out[i] = this.x0[i]; continue; }
            if (!(out[i] >= this.D_MIN)) out[i] = this.D_MIN;
            else if (out[i] > this.D_MAX) out[i] = this.D_MAX;
        }
        return out;
    }

    // Adopt (thk, mf) as the current point; promote to best if improved.
    _accept(thk, mf) {
        this.thicknesses = thk;
        this.mf = mf;
        if (mf < this.mfBest) {
            this.mfBest = mf;
            this.thickBest = thk.slice();
        }
    }

    // No free variables → nothing any engine can optimize, so we are converged
    // by definition (M15: otherwise isConverged stays false and the engine
    // no-ops to maxIter).
    isConverged() { return this.freeIdx.length === 0 || this.mfBest < this.tol; }

    restoreBest() {
        this.thicknesses = this.thickBest.slice();
        this.mf = this.mfAt(this.thicknesses);
    }

    applyToDesign(d) {
        const saved = this._ev.thicknesses;
        this._ev.thicknesses = this.thicknesses;
        const out = this._ev.applyToDesign(d);
        this._ev.thicknesses = saved;
        return out;
    }
}
