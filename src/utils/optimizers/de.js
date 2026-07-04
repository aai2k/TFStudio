/**
 * Differential Evolution refinement engine (Storn & Price, 1997).
 *
 * A population-based, gradient-free GLOBAL optimizer. It ranges over the
 * thickness space and escapes the local minima that trap DLS — the central
 * difficulty in thin-film design (Macleod, "Automatic Design": the merit
 * function is a highly multimodal surface; differential evolution is one of the
 * recognized methods for finding the global, not merely a neighboring,
 * minimum). It optimizes thicknesses only; it does NOT change layer count.
 *
 * Strategy: DE/rand/1/bin (default) or DE/best/1/bin.
 *   mutation rand1: v = x_r1 + F·(x_r2 − x_r3)
 *   mutation best1: v = x_best + F·(x_r1 − x_r2)
 *   crossover bin : trialⱼ = vⱼ if rand<CR or j=jrand, else x_iⱼ
 *   selection     : greedy — trial replaces target iff MF(trial) ≤ MF(target)
 *
 * Reference: R. Storn, K. Price, "Differential Evolution – A Simple and
 * Efficient Heuristic for Global Optimization over Continuous Spaces",
 * J. Global Optimization 11:341–359 (1997).
 *
 * One step() = one generation (popSize MF evaluations). The population is
 * seeded with the current design (member 0 = x0) so DE can never finish worse
 * than the starting point; the rest are perturbed around x0 and clamped to the
 * box, with locked layers pinned.
 *
 * SYNCHRONOUS (generational) selection: a generation's entire trial population
 * is built from the OLD population, then evaluated, then selected — no mid-
 * generation replacement. This is the canonical Storn–Price form and, crucially,
 * it lets the popSize MF evaluations of a generation run independently (e.g.
 * fanned across a worker pool) with a result identical to the serial run. The
 * generation is split into three reusable phases so an external orchestrator can
 * supply the evaluations:
 *   produceTrials()           → trial vectors[NP]   (consumes RNG; main thread)
 *   ingestTrials(trials, mfs) → selection + best/stall/iter bookkeeping
 *   step()                    = produceTrials → serial mfAt → ingestTrials
 */

import { EngineBase } from './base.js';

export class DEOptimizer extends EngineBase {
    constructor(operands, design, resolveMat, opts = {}) {
        super(operands, design, resolveMat, opts);

        const nFree = this.freeIdx.length;
        this.NP = Math.max(4, opts.popSize ?? Math.min(Math.max(10, 5 * nFree), 60));
        this.F  = opts.F  ?? 0.7;       // differential weight
        this.CR = opts.CR ?? 0.9;       // crossover probability
        this.strategy = opts.strategy === 'best1' ? 'best1' : 'rand1';
        this._spread  = opts.initSpread ?? 0.5;     // ± fractional spread for init
        this._stallLimit = opts.stallLimit ?? 60;   // generations w/o improvement → converged
        this._stall = 0;

        // ── Initialize population ──────────────────────────────────────────────
        // Member 0 = current design (elitism vs the start). Others = x0 with each
        // free coordinate scaled by (1 ± spread·U), clamped, locked coords pinned.
        this.pop    = new Array(this.NP);
        this.popMF  = new Array(this.NP);
        this.pop[0]   = this.x0.slice();
        this.popMF[0] = this.mf;
        let bestIdx = 0, bestMF = this.popMF[0];
        for (let p = 1; p < this.NP; p++) {
            const v = this.x0.slice();
            for (const j of this.freeIdx) {
                const base = this.x0[j] > 0 ? this.x0[j] : 0.5 * (this.D_MIN + this.D_MAX);
                v[j] = base * (1 + this._spread * (2 * this.rng() - 1));
            }
            const c = this.clampVec(v);
            this.pop[p]   = c;
            this.popMF[p] = this.mfAt(c);
            if (this.popMF[p] < bestMF) { bestMF = this.popMF[p]; bestIdx = p; }
        }
        this._bestIdx = bestIdx;
        this._accept(this.pop[bestIdx].slice(), bestMF);
    }

    _pickDistinct(count, exclude) {
        const picks = [];
        let guard = 0;
        while (picks.length < count && guard++ < 1000) {
            const r = Math.floor(this.rng() * this.NP);
            if (r === exclude || picks.indexOf(r) >= 0) continue;
            picks.push(r);
        }
        return picks;
    }

    // Build one trial vector for member i from the CURRENT population (mutation
    // + binomial crossover + box clamp). Consumes RNG; reads this.pop only.
    _makeTrial(i) {
        const nFree = this.freeIdx.length;
        let donor;
        if (this.strategy === 'best1') {
            const [r1, r2] = this._pickDistinct(2, i);
            const xb = this.pop[this._bestIdx], a = this.pop[r1], b = this.pop[r2];
            donor = this.x0.slice();
            for (const j of this.freeIdx) donor[j] = xb[j] + this.F * (a[j] - b[j]);
        } else {
            const [r1, r2, r3] = this._pickDistinct(3, i);
            const a = this.pop[r1], b = this.pop[r2], cc = this.pop[r3];
            donor = this.x0.slice();
            for (const j of this.freeIdx) donor[j] = a[j] + this.F * (b[j] - cc[j]);
        }
        const trial = this.pop[i].slice();
        const jrand = this.freeIdx[Math.floor(this.rng() * nFree)];
        for (const j of this.freeIdx) {
            if (this.rng() < this.CR || j === jrand) trial[j] = donor[j];
        }
        return this.clampVec(trial);
    }

    // Phase 1 — produce the whole generation's trial vectors from the old
    // population. Returns trials[NP]. (Generational/synchronous: no member is
    // replaced until ingestTrials, so the evaluations are order-independent and
    // can be fanned across a worker pool.)
    produceTrials() {
        if (this.freeIdx.length === 0) return null;
        const trials = new Array(this.NP);
        for (let i = 0; i < this.NP; i++) trials[i] = this._makeTrial(i);
        return trials;
    }

    // Phase 3 — greedy selection given the trial MFs, then best/stall/iter
    // bookkeeping. mfs[i] must be MF(trials[i]).
    ingestTrials(trials, mfs) {
        if (!trials) { this.iter++; return; }
        const prevBest = this.mfBest;
        for (let i = 0; i < this.NP; i++) {
            if (mfs[i] <= this.popMF[i]) { this.pop[i] = trials[i]; this.popMF[i] = mfs[i]; }
        }
        let bi = 0;
        for (let p = 1; p < this.NP; p++) if (this.popMF[p] < this.popMF[bi]) bi = p;
        this._bestIdx = bi;
        this._accept(this.pop[bi].slice(), this.popMF[bi]);
        this._stall = (this.mfBest < prevBest - 1e-15) ? 0 : this._stall + 1;
        this.iter++;
    }

    step() {
        const trials = this.produceTrials();
        if (!trials) { this.iter++; return; }
        const mfs = new Array(this.NP);
        for (let i = 0; i < this.NP; i++) mfs[i] = this.mfAt(trials[i]);
        this.ingestTrials(trials, mfs);
    }

    isConverged() {
        return this.mfBest < this.tol || this._stall >= this._stallLimit;
    }
}
