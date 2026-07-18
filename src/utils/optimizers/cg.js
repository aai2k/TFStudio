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
import { projectedLineSearch } from './cg/lineSearch.js';
import { gradNorm2, conjugateStep } from './cg/direction.js';

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

    // Plateau reached (many tiny consecutive gains): emulate the user's manual
    // relaunch — restore the best point and discard the conjugate state +
    // collapsed warm-start step so the next step is a fresh full-box steepest-
    // descent move that can escape the current basin. Converge only when a whole
    // relaunch cycle yielded no meaningful gain, or the budget is spent.
    // (persistent mode only). Returns true when the step is fully consumed (the
    // engine has converged), false to continue the current step.
    _maybeRelaunch() {
        if (!(this._persistent && this._softStall >= this._softPatience)) return false;
        const improved = (this._mfAtRelaunch - this.mfBest)
                         > this._minRelGain * Math.max(this._mfAtRelaunch, 1e-30);
        if (this._relaunchBudget > 0 && (this._mfAtRelaunch === Infinity || improved)) {
            this.restoreBest();
            this._g = null; this._dir = null; this._alpha = null;
            this._softStall = 0; this._stall = 0;
            this._mfAtRelaunch = this.mfBest;
            this._relaunchBudget--;
            return false;
        }
        this._done = true;
        this.iter++;
        return true;
    }

    // Stationary point: steepest descent cannot move, so this IS the converged
    // state. Signal convergence in both modes (persistent reads _done;
    // non-persistent reads _stall) — the restored best design is unchanged, the
    // wasted iterations are not.
    _markStationary() {
        this._done = true;
        this._stall = Math.max(this._stall, 4);
        this.iter++;
    }

    step() {
        if (this.freeIdx.length === 0) { this.iter++; return; }

        if (this._maybeRelaunch()) return;

        const x  = this.thicknesses;
        const g  = this.gradMF(x);                  // ∇MF (0 on locked coords)
        const gNorm2 = gradNorm2(g);
        if (Math.sqrt(gNorm2) < this._gtol) { this._markStationary(); return; }

        const { dir, gDotDir, beta } = conjugateStep({
            g, prevG: this._g, prevDir: this._dir,
            iter: this.iter, restartEvery: this._restartEvery, gNorm2,
        });

        let searchDir = dir;
        let ls = projectedLineSearch(this, x, searchDir, this.mf);

        // AUTO-RESTART before declaring a stall. A failed line search is usually
        // NOT a true minimum but a TRAPPED search: either the conjugate direction
        // is poor, or the warm-start step `_alpha` has collapsed so every probe
        // is too small to register improvement (the line search only ever shrinks
        // from its starting α, never expands). Retry once as pure steepest descent
        // with α reset to the box span. Only if THIS also fails is the design
        // genuinely at a numerical minimum.
        if (this._persistent && !ls && (beta !== 0 || this._alpha != null)) {
            const sd = new Array(g.length);
            for (let i = 0; i < g.length; i++) sd[i] = -g[i];
            const savedAlpha = this._alpha;
            this._alpha = null;                      // first probe spans the full box
            const ls2 = projectedLineSearch(this, x, sd, this.mf);
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
