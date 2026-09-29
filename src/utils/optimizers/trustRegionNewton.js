/**
 * Trust-region Newton refinement engine with Lin and More's projected search:
 * the synthesis lab's refine.c with proj=1, the refinement of its giga4
 * method (synthesis-lab/src/refine.c, giga4.c).
 *
 * Each iteration minimizes a quadratic model of F = ½‖r‖², r the residuals
 * whose Jacobian and Hessian LSQEngine assembles, around the thicknesses d:
 *
 *     m(s) = F + gᵀs + ½ sᵀBs   s.t.   D_MIN ≤ d + s ≤ D_MAX,   |s|∞ ≤ delta,
 *
 * g = Jᵀr and B = JᵀJ + Σ rₚ·∂²rₚ, the exact Hessian (LSQEngine._newtonSystem;
 * Nocedal and Wright, Numerical Optimization 2e, eq. 18.61). The step is the
 * Cauchy point and then Lin and More's minor iterates (trustRegion/boxStep.js),
 * which can put several layers onto the floor in one iteration where the
 * other engines hold them one at a time. A layer at a bound whose gradient
 * pushes it out of the box takes no part in the step (boundedStep.js). The
 * trial is accepted when F falls by more than ETA of the model's prediction,
 * and the radius, in nm on every layer, follows N&W Algorithm 4.1: a quarter
 * of itself after a ratio below 1/4, twice itself up to deltaMax after a ratio
 * above 3/4 on a step that reached the edge.
 *
 * Where LSQEngine has no exact Hessian (two-sided or full-system scoring, a
 * cone, operands without analytic curvature) B is the Gauss-Newton JᵀJ, as in
 * the Newton and SQP engines. `hessianModel` says which: 'newton' or
 * 'gauss-newton'.
 *
 * The run ends (convergedBy) on the lab's tests:
 *   'stationary'  the model predicts a gain below 1e-15 F, rounding in F;
 *   'reduction'   F reached 0, or an accepted step lowered F by at most FTOL
 *                 of itself and the model predicted no more (MINPACK lmder);
 *   'step'        an accepted step was at most XTOL (XTOL + |d|∞) long;
 *   'radius'      after a rejected step the radius is that short;
 *   'plateau'     the merit fell by less than plateauGain of itself over the
 *                 last `plateau` iterations, TFStudio's synthesis stop;
 *   'iterations'  maxIter iterations;
 * and on the merit under `tol`, as every engine does.
 *
 * Defaults are giga4's refinement (GIGA4_REFINE, "proj=1 refine_iter=60
 * plateau=6") with refine.c's constants: 60 iterations or a plateau of 6
 * iterations gaining less than 1e-4; a first radius of 20 nm and at most
 * 500 nm; ETA = 1e-4; FTOL = XTOL = 1e-10. Stopped that way, on the lab's
 * multiband case it reached the merits of the full refinement for 60% of the
 * CPU (giga4.c).
 */
import { LSQEngine } from '../physics/optimizer.js';
import { evaluateOperands, calcMF } from '../physics/optimizer/evalCore.js';
import { _vdot } from '../physics/optimizer/linalg.js';
import { movablePositions, restrictSystem, projectedTrial } from '../physics/optimizer/boundedStep.js';
import { boxTrustStep } from './trustRegion/boxStep.js';

export const TRUST_REGION_DEFAULTS = Object.freeze({
    maxIter: 60,        // iterations
    plateau: 6,         // iterations; 0 turns the plateau stop off
    plateauGain: 1e-4,  // relative merit gain over the plateau window
    delta0: 20,         // first trust radius, nm
    deltaMax: 500,      // largest trust radius, nm
});

const ETA = 1e-4;
const FTOL = 1e-10;
const XTOL = 1e-10;
const STATIONARY = 1e-15;

const maxAbs = v => v.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

export class TrustRegionNewtonOptimizer extends LSQEngine {
    constructor(operands, design, resolveMat, opts = {}) {
        super(operands, design, resolveMat, opts);
        const o = TRUST_REGION_DEFAULTS;
        this.maxIter     = opts.maxIter ?? o.maxIter;
        this.plateau     = opts.plateau ?? o.plateau;
        this.plateauGain = opts.plateauGain ?? o.plateauGain;
        this.delta       = opts.delta0 ?? o.delta0;
        this.deltaMax    = opts.deltaMax ?? o.deltaMax;
        this.accepted    = 0;
        this._mfHistory  = [this.mf];
        this._F          = this._meritAt(this.thicknesses).F;
        // The model LSQEngine will build, until it builds one.
        const sm = this.surfaceMode;
        this.hessianModel = this._fullNewtonSupported(sm, sm === 'back_only') ? 'newton' : 'gauss-newton';
    }

    // LSQEngine's system, recording which Hessian it took: _newtonSystem
    // hands over to _gaussNewtonSystem wherever the exact one is unavailable.
    _newtonSystem(thk, freeIdx) {
        this.hessianModel = 'newton';
        return super._newtonSystem(thk, freeIdx);
    }

    _gaussNewtonSystem(thk, freeIdx) {
        this.hessianModel = 'gauss-newton';
        return super._gaussNewtonSystem(thk, freeIdx);
    }

    // F = ½‖r‖², the function the model approximates (Jtr is its gradient, H
    // its Hessian), and the merit MF, from one evaluation of the operands. A
    // point calcMF cannot score (an operand error, a value that is not finite)
    // has F = Infinity, so its trial is rejected as the other engines reject it.
    _meritAt(thk) {
        const comp = evaluateOperands(this.operands, this._ctxFor(thk));
        const mf = calcMF(this.operands, comp);
        if (!Number.isFinite(mf)) return { F: Infinity, mf };
        const r = this._residuals(thk, comp);
        return { F: 0.5 * _vdot(r, r), mf };
    }

    // The box of the step on the layers moveIdx: the thickness bounds and the
    // trust radius, nm, each side including 0.
    _stepBox(moveIdx) {
        const d = moveIdx.map(k => this.thicknesses[k]);
        const delta = this.delta;
        return {
            lo: d.map(x => Math.min(0, Math.max(this.D_MIN - x, -delta))),
            hi: d.map(x => Math.max(0, Math.min(this.D_MAX - x, delta))),
            delta,
        };
    }

    step() {
        const freeIdx = this.thicknesses.map((_, i) => i).filter(i => !this.lockedMask[i]);
        if (freeIdx.length === 0) return;
        this.iter++;
        this.convergedBy = this._iterate(freeIdx) || this._plateauStop()
            || (this.iter >= this.maxIter ? 'iterations' : null);
    }

    // One iteration up to the acceptance tests; returns the stop it meets.
    _iterate(freeIdx) {
        const sys = this._newtonSystemAt(this.thicknesses, freeIdx);
        const cols = movablePositions(this, freeIdx, sys.Jtr);
        const moveIdx = cols.map(c => freeIdx[c]);
        const { H, Jtr } = restrictSystem(sys, cols);
        const { s, q } = boxTrustStep(H, Jtr, this._stepBox(moveIdx));
        const pred = -q;
        if (!(pred > STATIONARY * this._F)) return 'stationary';
        return this._trial(freeIdx, moveIdx, s, pred);
    }

    // Evaluate the step s on moveIdx, resize the radius on the ratio of the
    // actual to the predicted reduction, and accept or reject the step.
    _trial(freeIdx, moveIdx, s, pred) {
        const tiny = XTOL * (XTOL + maxAbs(freeIdx.map(k => this.thicknesses[k])));
        const trial = projectedTrial(this, freeIdx, moveIdx, s);
        const at = this._meritAt(trial);
        const rho = (this._F - at.F) / pred;
        this._resize(rho, s);
        if (!(rho > ETA)) return this.delta <= tiny ? 'radius' : null;
        return this._accept(trial, at, pred) || (maxAbs(s) <= tiny ? 'step' : null);
    }

    // The radius update of Algorithm 4.1 (see the header). A trial the merit
    // could not score has a ratio of -Infinity and shrinks the radius as a
    // poor one does; a ratio that is not a number does the same.
    _resize(rho, s) {
        const onEdge = s.some(x => Math.abs(x) >= this.delta * (1 - 1e-9));
        if (!(rho >= 0.25)) this.delta *= 0.25;
        else if (rho > 0.75 && onEdge) this.delta = Math.min(2 * this.delta, this.deltaMax);
    }

    // Move to the trial point; 'reduction' when the lab's ftol test ends the run.
    _accept(trial, at, pred) {
        const Fold = this._F;
        this.thicknesses = trial;
        this.mf = at.mf;
        this._F = at.F;
        this.accepted++;
        if (at.mf < this.mfBest) { this.mfBest = at.mf; this.thickBest = [...trial]; }
        const flat = Fold - at.F <= FTOL * Fold && pred <= FTOL * Fold;
        return at.F === 0 || flat ? 'reduction' : null;
    }

    _plateauStop() {
        const h = this._mfHistory;
        h.push(this.mf);
        const k = h.length - 1;
        if (!(this.plateau > 0) || k < this.plateau) return null;
        const past = h[k - this.plateau];
        return past > 0 && (past - this.mf) / past >= this.plateauGain ? null : 'plateau';
    }

    restoreBest() {
        this.thicknesses = [...this.thickBest];
        const at = this._meritAt(this.thicknesses);
        this.mf = at.mf;
        this._F = at.F;
    }
}
