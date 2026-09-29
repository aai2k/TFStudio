/**
 * Conjugate gradients on one face of the box, the first half of a minor
 * iterate of the trust-region step (trustRegion/boxStep.js).
 *
 * From the step s, on the variables free at s with the others held, they
 * minimize the model q(s + p) = q(s) + rᵀp + ½ pᵀBp, r = g + Bs, blind to
 * the bounds lo and hi: the projected search that follows deals with those.
 * They stop where s + p reaches the edge of the trust region, a face
 * |s_i + p_i| = delta, and along a direction of non-positive curvature they go
 * on to that edge (Steihaug; Nocedal and Wright, Numerical Optimization 2e,
 * Algorithm 7.2). At most 2·nf + 5 iterations for nf free variables, ending
 * early when ‖residual‖² falls to CG_SHRINK of its start: the synthesis lab's
 * values (refine.c, subspace_projected).
 */
import { _vdot } from '../../physics/optimizer/linalg.js';

const CG_SHRINK = 1e-24;

// The largest t ≥ 0 at which s + p + t·dir first puts a variable on a face of
// the trust region |x_i| = delta. Held variables have dir_i = 0.
function toEdge(s, p, dir, delta) {
    let t = Infinity;
    for (let i = 0; i < dir.length; i++) {
        if (dir[i] === 0) continue;
        const face = dir[i] > 0 ? delta : -delta;
        t = Math.min(t, (face - (s[i] + p[i])) / dir[i]);
    }
    return Math.max(t, 0);
}

// (B·v)_i on the free variables, 0 on the held ones.
function freeProduct(B, v, free) {
    return B.map((row, i) => (free[i] ? _vdot(row, v) : 0));
}

function addScaled(x, a, v) {
    for (let i = 0; i < x.length; i++) x[i] += a * v[i];
}

/**
 * B is the model Hessian (rows), s the step so far, r the model gradient at
 * s, free[i] whether variable i may move, delta the trust radius, nm.
 * Returns { p, edge }: the step from s, zero on the held variables, and
 * whether it ended on the trust-region edge; null when r is zero on the free
 * variables.
 */
export function faceCG(B, s, r, { free, delta }) {
    const res = r.map((ri, i) => (free[i] ? -ri : 0));
    let rr = _vdot(res, res);
    if (!(rr > 0)) return null;
    const rr0 = rr;
    const cap = 2 * free.filter(Boolean).length + 5;
    const p = new Array(s.length).fill(0);
    let dir = res.slice();
    for (let it = 0; it < cap; it++) {
        const Bd = freeProduct(B, dir, free);
        const dBd = _vdot(dir, Bd);
        const alpha = dBd > 0 ? rr / dBd : Infinity;
        const t = toEdge(s, p, dir, delta);
        if (alpha >= t) { addScaled(p, t, dir); return { p, edge: true }; }
        addScaled(p, alpha, dir);
        addScaled(res, -alpha, Bd);
        const rn = _vdot(res, res);
        if (rn <= CG_SHRINK * rr0) break;
        const beta = rn / rr;
        rr = rn;
        dir = res.map((x, i) => x + beta * dir[i]);
    }
    return { p, edge: false };
}
