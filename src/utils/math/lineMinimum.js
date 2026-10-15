/**
 * Minima of a function of one variable: the local minima of a sampled curve,
 * the parabola through three of its samples, and Brent's minimisation on a
 * bracket (Brent, Algorithms for Minimization without Derivatives, 1973,
 * ch. 5): parabolic steps through the three best points, golden-section steps
 * where a parabola would leave the bracket or shrink it too slowly.
 */

const GOLDEN = 0.3819660112501051;

/** Indices of the samples no higher than their neighbours, ends included. */
export function localMinima(values) {
    const out = [];
    const n = values.length;
    for (let i = 0; i < n; i++) {
        const left = i > 0 ? values[i - 1] : Infinity, right = i < n - 1 ? values[i + 1] : Infinity;
        if (values[i] <= left && values[i] <= right) out.push(i);
    }
    return out;
}

/**
 * The parabola through the samples i − 1, i, i + 1 of (xs, ys): its value at
 * x, its vertex, and whether it opens upward.
 */
export function parabola(xs, ys, i) {
    const [x0, x1, x2] = [xs[i - 1], xs[i], xs[i + 1]];
    const [y0, y1, y2] = [ys[i - 1], ys[i], ys[i + 1]];
    return {
        at: x => y0 * (x - x1) * (x - x2) / ((x0 - x1) * (x0 - x2))
            + y1 * (x - x0) * (x - x2) / ((x1 - x0) * (x1 - x2))
            + y2 * (x - x0) * (x - x1) / ((x2 - x0) * (x2 - x1)),
        vertex() {
            const p = (x1 - x0) * (y1 - y2), q = (x1 - x2) * (y1 - y0);
            const den = 2 * (p - q);
            return den !== 0 ? x1 - ((x1 - x0) * p - (x1 - x2) * q) / den : x1;
        },
        convex: (y0 - y1) / (x0 - x1) < (y2 - y1) / (x2 - x1),
    };
}

// The parabolic step from x through the three best points, or null where
// Brent's tests reject it: it leaves the bracket, or it is not under half the
// step before last, `e`.
function parabolicStep(s, e) {
    const { x, fx, w, fw, v, fv, a, b } = s;
    const r = (x - w) * (fx - fv);
    let q = (x - v) * (fx - fw);
    let p = (x - v) * q - (x - w) * r;
    q = 2 * (q - r);
    if (q > 0) p = -p; else q = -q;
    const inside = Math.abs(p) < Math.abs(0.5 * q * e) && p > q * (a - x) && p < q * (b - x);
    return inside ? p / q : null;
}

// The next step d and the step before it e: parabolic where Brent's tests
// accept it, kept `tol` clear of the bracket ends, golden section otherwise.
function nextStep(s, d, e, tol) {
    const xm = 0.5 * (s.a + s.b);
    const step = Math.abs(e) > tol ? parabolicStep(s, e) : null;
    if (step === null) {
        const golden = s.x >= xm ? s.a - s.x : s.b - s.x;
        return { d: GOLDEN * golden, e: golden };
    }
    const nearEnd = s.x + step - s.a < 2 * tol || s.b - s.x - step < 2 * tol;
    return { d: nearEnd ? Math.sign(xm - s.x || 1) * tol : step, e: d };
}

// Take the point (u, fu) into the bracket and the three best points.
function accept(s, u, fu) {
    if (fu <= s.fx) {
        if (u >= s.x) s.a = s.x; else s.b = s.x;
        s.v = s.w; s.fv = s.fw; s.w = s.x; s.fw = s.fx; s.x = u; s.fx = fu;
        return;
    }
    if (u < s.x) s.a = u; else s.b = u;
    if (fu <= s.fw || s.w === s.x) {
        s.v = s.w; s.fv = s.fw; s.w = u; s.fw = fu;
    } else if (fu <= s.fv || s.v === s.x || s.v === s.w) {
        s.v = u; s.fv = fu;
    }
}

/**
 * Minimum of f on [a, b] to within `tol`, started from the best point x and
 * the next two, w and v, with their values: { x, fx }. At most `maxEvals`
 * evaluations of f.
 */
export function brentMinimum(f, a, b, { x, fx, w, fw, v, fv }, { tol, maxEvals }) {
    const s = { a, b, x, fx, w, fw, v, fv };
    let d = 0, e = b - a;
    for (let evals = 0; evals < maxEvals; evals++) {
        if (Math.abs(s.x - 0.5 * (s.a + s.b)) <= 2 * tol - 0.5 * (s.b - s.a)) break;
        ({ d, e } = nextStep(s, d, e, tol));
        const u = s.x + (Math.abs(d) >= tol ? d : Math.sign(d || 1) * tol);
        accept(s, u, f(u));
    }
    return { x: s.x, fx: s.fx };
}
