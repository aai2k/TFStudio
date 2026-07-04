/**
 * Simulated Annealing refinement engine (Kirkpatrick et al., 1983).
 *
 * A gradient-free GLOBAL optimizer. It accepts worsening moves with probability
 * exp(−ΔMF/T) and lowers the temperature T on a cooling schedule, so early on it
 * ranges widely over the thickness space (escaping local minima) and late on it
 * settles into a minimum. Macleod lists simulated annealing (with an "annealing
 * schedule") among the recognized thin-film refinement methods; it optimizes
 * thicknesses only and does NOT change layer count.
 *
 * Reference: S. Kirkpatrick, C. D. Gelatt, M. P. Vecchi, "Optimization by
 * Simulated Annealing", Science 220:671–680 (1983). Cooling = geometric
 * (T ← α·T). Step proposals are per-coordinate Gaussian, scaled relative to the
 * current thickness and shrunk with T so late moves are fine adjustments.
 *
 * One step() = one cooling sweep: `movesPerSweep` Metropolis proposals followed
 * by one temperature decrement. The best-ever point is tracked separately and
 * is what the orchestrator reads (restoreBest), so accepted uphill moves never
 * lose a good design.
 */

import { EngineBase, gaussian } from './base.js';

export class SAOptimizer extends EngineBase {
    constructor(operands, design, resolveMat, opts = {}) {
        super(operands, design, resolveMat, opts);

        const nFree = this.freeIdx.length;
        this.movesPerSweep = opts.movesPerSweep ?? Math.max(8, 2 * nFree);
        this.alpha   = opts.alpha   ?? 0.95;        // geometric cooling factor
        this.Tmin    = opts.Tmin    ?? 1e-7;
        this.stepFrac0 = opts.stepFrac ?? 0.15;     // initial relative step size
        this._stepFloor = opts.stepFloor ?? 1.0;    // nm — min proposal scale
        this._stallLimit = opts.stallLimit ?? 100;
        this._stall = 0;

        this.T = (opts.T0 != null) ? opts.T0 : this._autoTemp();
        this._T0 = this.T;
    }

    // Auto initial temperature: sample a few random worsening moves and set T0
    // so their average is accepted with ~p0 probability:  T0 = mean(ΔMF₊)/−ln p0.
    _autoTemp() {
        const p0 = 0.8;
        const trials = 20;
        let sum = 0, cnt = 0;
        for (let t = 0; t < trials; t++) {
            const cand = this._propose(this.x0, 0.15);
            const d = this.mfAt(cand) - this.mf;
            if (d > 0) { sum += d; cnt++; }
        }
        const meanUp = cnt > 0 ? sum / cnt : Math.max(this.mf, 1e-6);
        return meanUp / -Math.log(p0);
    }

    // Propose a neighbor: every free coordinate jiggled by a Gaussian whose
    // scale is `frac` of the coordinate (floored), clamped to the box.
    _propose(x, frac) {
        const cand = x.slice();
        for (const j of this.freeIdx) {
            const scale = Math.max(this._stepFloor, frac * Math.abs(x[j]));
            cand[j] = x[j] + scale * gaussian(this.rng);
        }
        return this.clampVec(cand);
    }

    step() {
        if (this.freeIdx.length === 0) { this.iter++; return; }

        // Step size shrinks as the system cools (relative to T0), so late sweeps
        // make fine adjustments.
        const frac = Math.max(0.01, this.stepFrac0 * (this.T / this._T0));
        let improved = false;

        for (let m = 0; m < this.movesPerSweep; m++) {
            const cand = this._propose(this.thicknesses, frac);
            const mfC  = this.mfAt(cand);
            const d    = mfC - this.mf;
            if (d <= 0 || this.rng() < Math.exp(-d / Math.max(this.T, 1e-30))) {
                this.thicknesses = cand;
                this.mf = mfC;
                if (mfC < this.mfBest) {
                    this.mfBest = mfC;
                    this.thickBest = cand.slice();
                    improved = true;
                }
            }
        }

        this.T *= this.alpha;
        this._stall = improved ? 0 : this._stall + 1;
        this.iter++;
    }

    isConverged() {
        return this.mfBest < this.tol || this.T < this.Tmin || this._stall >= this._stallLimit;
    }
}
