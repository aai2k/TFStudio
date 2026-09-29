/**
 * The step of one trust-region iteration (trustRegionNewton.js): an
 * approximate minimizer of the model
 *
 *     q(s) = gᵀs + ½ sᵀBs   over the box   lo ≤ s ≤ hi,
 *
 * where lo ≤ 0 ≤ hi and |lo_i|, |hi_i| ≤ delta, the trust-region subproblem
 * of Nocedal and Wright, Numerical Optimization 2e, eq. 18.61, for simple
 * bounds. B need not be positive definite.
 *
 * First the Cauchy point, the first minimizer of q along the projected
 * steepest-descent path (cauchyPoint.js; N&W eqs. 16.70-16.73). Then
 * Lin and More's subspace minimization (SIAM J. Optim. 9, 1100, 1999,
 * sections 4 and 6): minor iterates, each conjugate gradients on the
 * variables free at s (faceCG.js) and a projected search along their
 * direction (projectedSearch.js). The minor iterates go on in the face the
 * search leaves until a search meets no bound, or takes the whole
 * conjugate-gradient step to the edge of the trust region; at most 2n + 5 of
 * them. Every variable a search carries across a bound goes onto it, so
 * several layers can reach the floor in one iteration.
 *
 * A port of the synthesis lab's refine.c with proj=1 (cauchy,
 * subspace_projected, refine_box_step). B is an array of n rows; g, lo, hi and
 * the step are per variable, nm.
 */
import { boxQPValue, _matVec } from '../../physics/optimizer/linalg.js';
import { boxCauchyPoint } from './cauchyPoint.js';
import { faceCG } from './faceCG.js';
import { projectedSearch } from './projectedSearch.js';

// One minor iterate from s, moving s in place. Returns whether another
// follows: the search met a bound and did not take the whole
// conjugate-gradient step to the trust-region edge.
function minorIterate(model, s) {
    const free = s.map((si, i) => si > model.lo[i] && si < model.hi[i]);
    if (!free.includes(true)) return false;
    const Bs = _matVec(model.B, s);
    const r = model.g.map((gi, i) => gi + Bs[i]);
    const cg = faceCG(model.B, s, r, { free, delta: model.delta });
    const moved = cg && projectedSearch({ model, s, p: cg.p, r });
    return !!moved && moved.met && !(cg.edge && moved.whole);
}

/**
 * The step for the model { B, g } over `box` = { lo, hi, delta }. Returns
 * { s, q, qc }: the step, the model there, and the model at the Cauchy point,
 * which q never exceeds.
 */
export function boxTrustStep(B, g, box) {
    const model = { B, g, ...box };
    const s = boxCauchyPoint(B, g, box.lo, box.hi);
    const qc = boxQPValue(B, g, s);
    const passes = 2 * s.length + 5;
    for (let pass = 0; pass < passes; pass++) {
        if (!minorIterate(model, s)) break;
    }
    return { s, q: boxQPValue(B, g, s), qc };
}
