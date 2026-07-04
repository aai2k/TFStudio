/**
 * Conjugate Gradient refinement engine (Polak–Ribière+).
 *
 * A gradient-only LOCAL method: no Jacobian matrix is stored or factorized, so
 * per-iteration memory is O(n) rather than DLS's O(m·n). That makes it the
 * preferred engine for very large designs (hundreds of layers) where forming
 * and QR-factorizing the residual Jacobian every step dominates cost.
 *
 * Reference: Nocedal & Wright, *Numerical Optimization* 2nd ed., §5.2
 * (nonlinear CG, Polak–Ribière formula β = max(0, gₖᵀ(gₖ−gₖ₋₁)/gₖ₋₁ᵀgₖ₋₁) with
 * automatic restart). Macleod lists "direction set methods" / linear-search
 * techniques among the recognized refinement methods.
 *
 * The gradient is the EXACT analytic ∇MF from DLSOptimizer.gradMF (Macleod
 * Eq.2.111/2.113 chain rule), or central differences where the analytic path
 * declines a merit term — same fallback policy as DLS. Box bounds [D_MIN,D_MAX]
 * and locked layers are enforced by projecting the trial point every line-search
 * probe (projected-gradient CG).
 */

import { EngineBase } from './base.js';

export class CGOptimizer extends EngineBase {
    constructor(operands, design, resolveMat, opts = {}) {
        super(operands, design, resolveMat, opts);
        this._g    = null;          // previous gradient
        this._dir  = null;          // previous search direction
        this._alpha = opts.alpha0 ?? null;  // last accepted step (line-search warm start)
        this._gtol = opts.gtol ?? 1e-9;     // ‖g‖ stop
        this._stall = 0;
        this._restartEvery = opts.restartEvery ?? Math.max(2, this.freeIdx.length);
        // PERSISTENCE (opt-in). When true, CG won't quit at the first trapped
        // line search: it auto-restarts (steepest descent, full-box step) and,
        // on a plateau, auto-relaunches from the best point — emulating a
        // manual "re-run CG ~5×" workflow. DEFAULT OFF so the validated
        // SYNTHESIS inner-refiner (synthesisWorker → makeEngine('cg')) is byte-
        // identical to before; only the standalone Refinement window opts in
        // (optimizerWorker passes persistent:true). The
        // synthesis_conv_stop A/B depends on the classic stall behavior.
        this._persistent = opts.persistent ?? false;
        // Diminishing-returns detector + AUTO-RELAUNCH. On a
        // 50-layer design a manual relaunch of CG ~5× was needed to keep improving:
        // each manual relaunch starts a fresh full-box steepest-descent step from
        // the best point so far, which can jump to a better basin — something the
        // in-step auto-restart can't do once the line search keeps finding tiny
        // grinding gains (so it never "fails"). We emulate that workflow: when
        // many consecutive accepted steps each gain < a tol-level RELATIVE amount
        // (a plateau), we relaunch in place (restoreBest + discard _g/_dir/_alpha)
        // instead of stopping. We only truly converge when a whole relaunch cycle
        // produces no meaningful gain, or the relaunch budget is spent.
        this._minRelGain   = opts.minRelGain ?? 1e-7;
        this._softPatience = opts.softPatience ?? 12;
        this._softStall    = 0;
        this._relaunchBudget = opts.relaunchBudget ?? 8;  // > the user's manual ~5
        this._mfAtRelaunch   = Infinity;                  // mfBest at the last relaunch
        this._done           = false;
    }

    // Projected backtracking line search. Starts from the LARGEST useful step
    // (the one that moves the largest free coordinate across the whole box) so
    // the first probe is meaningful even when ‖∇MF‖ is tiny, then shrinks
    // geometrically and returns the best strictly-improving probe. (A pure
    // Armijo test is unreliable here because gᵀd can be vanishingly small near
    // shallow minima; best-improving + box projection is the robust choice and
    // CG's superlinear behavior still emerges from the conjugate directions.)
    // Returns {thk, mf, alpha} or null if nothing improved.
    _lineSearch(x, dir, mf0 /*, gDotDir */) {
        let dmax = 0;
        for (let i = 0; i < dir.length; i++) {
            const ad = Math.abs(dir[i]);
            if (ad > dmax) dmax = ad;
        }
        if (dmax === 0) return null;

        // α0: move the largest coord by the full box span. Bias toward the
        // previous accepted α (warm start) by starting a little above it but
        // never exceeding the box-spanning step.
        const aBox = (this.D_MAX - this.D_MIN) / dmax;
        let a = aBox;
        if (this._alpha && this._alpha * 4 < aBox) a = this._alpha * 4;

        const shrink = 0.5;
        const MAX_BT = 44;            // 0.5^44 ≈ 6e-14 of the box span
        let best = null;
        for (let bt = 0; bt < MAX_BT; bt++) {
            const trial = this.clampVec(x.map((xi, i) => xi + a * dir[i]));
            const mfT = this.mfAt(trial);
            if (best === null || mfT < best.mf) best = { thk: trial, mf: mfT, alpha: a };
            // Once we have improvement and the probe starts climbing again,
            // we've bracketed the descent — stop.
            else if (best.mf < mf0 && mfT > best.mf) break;
            a *= shrink;
        }
        return (best && best.mf < mf0) ? best : null;
    }

    step() {
        if (this.freeIdx.length === 0) { this.iter++; return; }

        // Plateau reached (many tiny consecutive gains): emulate the user's
        // manual relaunch — restore the best point and discard the conjugate
        // state + collapsed warm-start step so the next step is a fresh full-box
        // steepest-descent move that can escape the current basin. Converge only
        // when a whole relaunch cycle yielded no meaningful gain, or the budget
        // is spent. (persistent mode only)
        if (this._persistent && this._softStall >= this._softPatience) {
            const improved = (this._mfAtRelaunch - this.mfBest)
                             > this._minRelGain * Math.max(this._mfAtRelaunch, 1e-30);
            if (this._relaunchBudget > 0 && (this._mfAtRelaunch === Infinity || improved)) {
                this.restoreBest();
                this._g = null; this._dir = null; this._alpha = null;
                this._softStall = 0; this._stall = 0;
                this._mfAtRelaunch = this.mfBest;
                this._relaunchBudget--;
            } else {
                this._done = true;
                this.iter++;
                return;
            }
        }

        const x  = this.thicknesses;
        const g  = this.gradMF(x);                  // ∇MF (0 on locked coords)
        let gNorm2 = 0;
        for (let i = 0; i < g.length; i++) gNorm2 += g[i] * g[i];
        if (Math.sqrt(gNorm2) < this._gtol) {
            // Stationary point: steepest descent cannot move, so this IS the
            // converged state. M15: previously returned without touching
            // _done/_stall, so isConverged() stayed false and the engine spun
            // uselessly to maxIter. Signal convergence in both modes (persistent
            // reads _done; non-persistent reads _stall) — the restored best
            // design is unchanged, the wasted iterations are not.
            this._done = true;
            this._stall = Math.max(this._stall, 4);
            this.iter++;
            return;
        }

        // Polak–Ribière+ β with automatic restart.
        let beta = 0;
        if (this._g && this._dir && (this.iter % this._restartEvery) !== 0) {
            let num = 0, den = 0;
            for (let i = 0; i < g.length; i++) {
                num += g[i] * (g[i] - this._g[i]);
                den += this._g[i] * this._g[i];
            }
            beta = den > 0 ? Math.max(0, num / den) : 0;
        }

        const dir = new Array(g.length);
        let gDotDir = 0;
        for (let i = 0; i < g.length; i++) {
            dir[i] = -g[i] + (beta && this._dir ? beta * this._dir[i] : 0);
            gDotDir += g[i] * dir[i];
        }
        // Guard: if the conjugate direction is not a descent direction (can
        // happen with PR+ after a poor line search), reset to steepest descent.
        if (gDotDir >= 0) {
            for (let i = 0; i < g.length; i++) dir[i] = -g[i];
            gDotDir = -gNorm2;
            beta = 0;
        }

        let searchDir = dir;
        let ls = this._lineSearch(x, searchDir, this.mf, gDotDir);

        // AUTO-RESTART before declaring a stall. A failed line search is usually
        // NOT a true minimum but a TRAPPED search: either the conjugate direction
        // is poor, or the warm-start step `_alpha` has collapsed so every probe
        // is too small to register improvement (the line search only ever shrinks
        // from its starting α, never expands). This is exactly the state a manual
        // re-run escapes — it discards `_dir` and `_alpha` and starts fresh from
        // the full box-spanning step. Do that automatically: retry once as pure
        // steepest descent with α reset to the box span. Only if THIS also fails
        // is the design genuinely at a numerical minimum. (Previously a single
        // trapped step counted toward convergence, so CG quit ~5× too early and
        // the user had to re-launch it by hand to keep making progress.)
        if (this._persistent && !ls && (beta !== 0 || this._alpha != null)) {
            const sd = new Array(g.length);
            for (let i = 0; i < g.length; i++) sd[i] = -g[i];
            const savedAlpha = this._alpha;
            this._alpha = null;                      // first probe spans the full box
            const ls2 = this._lineSearch(x, sd, this.mf, -gNorm2);
            if (ls2) { ls = ls2; searchDir = sd; }
            else this._alpha = savedAlpha;
        }

        if (!ls) {
            // Even a full-box steepest-descent restart could not improve → at a
            // local minimum within numerical reach. Count toward convergence.
            this._stall++;
            this._g = g; this._dir = null;
            this.iter++;
            return;
        }
        if (this._persistent) {
            const relGain = (this.mf - ls.mf) / Math.max(this.mf, 1e-30);
            this._softStall = (relGain < this._minRelGain) ? this._softStall + 1 : 0;
        }
        this._stall = 0;
        this._alpha = ls.alpha;
        this._g   = g;
        this._dir = searchDir;
        this._accept(ls.thk, ls.mf);
        this.iter++;
    }

    isConverged() {
        if (!this._persistent) {
            // Classic behavior (synthesis inner-refiner, validated): a few
            // trapped line searches → converged. UNCHANGED from before the
            // persistence work, so synthesis is byte-identical.
            return this.mfBest < this.tol || this._stall >= 3;
        }
        // Persistent (standalone Refinement): `_done` is set by step() once
        // auto-relaunch can no longer make progress. `_stall>=4` is a genuine
        // numerical minimum (even a full-box steepest-descent restart found no
        // improving probe). `_softStall` is NOT a convergence signal — it
        // triggers a relaunch inside step().
        return this._done || this.mfBest < this.tol || this._stall >= 4;
    }
}
