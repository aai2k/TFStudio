/**
 * The projected search of Lin and More, the second half of a minor iterate of
 * the trust-region step (trustRegion/boxStep.js).
 *
 * Along the conjugate-gradient direction p from s (faceCG.js) the trial is
 * s + a·p projected onto the box lo ≤ s ≤ hi, a = 1 halved until the model
 * falls by MU0 of its linear change, or the first breakpoint when no a past
 * it does (C.-J. Lin and J. J. More, "Newton's method for large
 * bound-constrained optimization problems," SIAM J. Optim. 9, 1100 (1999),
 * eq. 4.4). The projection puts every variable the step carries across a
 * bound onto it, so several layers can reach the floor in one search.
 *
 * `face` is { model, s, p, r }: the model { B, lo, hi } (trustRegion/boxStep.js),
 * the step s (moved in place), the direction p, zero on the held variables,
 * and the model gradient r = g + Bs at s.
 */
import { _vdot, _matVec } from '../../physics/optimizer/linalg.js';

// Lin and More's sufficient decrease constant (p. 1120).
const MU0 = 0.01;

// The bound variable i moves toward along p.
const boundAhead = ({ model: { lo, hi }, p }, i) => (p[i] > 0 ? hi[i] : lo[i]);

// The first breakpoint along p from s: the step at which a variable first
// reaches lo or hi, and which one; { t: Infinity, at: -1 } when none does.
function firstBreak(face) {
    const { s, p } = face;
    let t = Infinity, at = -1;
    for (let i = 0; i < p.length; i++) {
        if (p[i] === 0) continue;
        const ti = (boundAhead(face, i) - s[i]) / p[i];
        if (ti < t) { t = ti; at = i; }
    }
    return { t, at };
}

// The move u = P(s + a·p) − s, with every variable the step carries to or
// across a bound exactly on it.
function projectedMove({ model: { lo, hi }, s, p }, a) {
    return p.map((pi, i) => {
        if (pi === 0) return 0;
        const x = s[i] + a * pi;
        if (x <= lo[i]) return lo[i] - s[i];
        return x >= hi[i] ? hi[i] - s[i] : a * pi;
    });
}

// The model's change q(s + u) − q(s) = rᵀu + ½ uᵀBu for the move at a, and rᵀu.
function trialChange(face, a) {
    const u = projectedMove(face, a);
    const ru = _vdot(face.r, u);
    return { dq: ru + 0.5 * _vdot(u, _matVec(face.model.B, u)), ru };
}

// The step length: a = 1 halved while it lies past the first breakpoint brk
// and the model falls by less than MU0 of its linear change; brk when the
// halving passes it.
function searchLength(face, brk) {
    let a = 1;
    while (a > brk) {
        const { dq, ru } = trialChange(face, a);
        if (dq <= MU0 * Math.min(ru, 0)) break;
        a *= 0.5;
    }
    return a < 1 && a < brk ? brk : a;
}

// s ← P(s + a·p). A step that reaches the first breakpoint puts its variable
// exactly on the bound, so that variable is held from the next minor iterate.
function moveOnto(face, a, brk) {
    const { model: { lo, hi }, s, p } = face;
    for (let i = 0; i < p.length; i++) {
        if (p[i] === 0) continue;
        const x = a >= brk.t && i === brk.at ? boundAhead(face, i) : s[i] + a * p[i];
        s[i] = Math.min(hi[i], Math.max(lo[i], x));
    }
}

/**
 * One projected search, moving face.s. Returns { met, whole }: whether the
 * step reached the first breakpoint and whether it took all of p (a = 1);
 * null, with s unchanged, when the model does not fall.
 */
export function projectedSearch(face) {
    const brk = firstBreak(face);
    const a = searchLength(face, brk.t);
    if (!(trialChange(face, a).dq < 0)) return null;
    moveOnto(face, a, brk);
    return { met: a >= brk.t, whole: a >= 1 };
}
