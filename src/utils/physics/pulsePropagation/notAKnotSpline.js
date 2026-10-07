/**
 * Cubic spline with not-a-knot end conditions.
 *
 * The third derivative is continuous across the second and the second-to-last
 * knots, which makes the first two and the last two pieces one cubic each. A
 * cubic is therefore reproduced exactly, so a tabulated spectral phase that is
 * a GDD and a TOD reads back as that GDD and TOD, with no end condition forcing
 * the curvature to zero. de Boor, A Practical Guide to Splines, rev. ed.
 * (2001), Ch. IV.
 *
 * Unknowns are the second derivatives M at the knots. The interior equations
 * are h(i−1)·M(i−1) + 2(h(i−1) + h(i))·M(i) + h(i)·M(i+1) = 6(s(i) − s(i−1)),
 * with h the knot spacings and s the secants; the two end conditions eliminate
 * M at the first and last knots, leaving a tridiagonal system.
 *
 * Points are [x, y] pairs with strictly increasing x. Outside the knots the end
 * pieces are extended. Two points give a line and three a parabola.
 */

function solveTridiagonal(lower, diagonal, upper, right) {
    const size = diagonal.length;
    const c = new Array(size);
    const d = new Array(size);
    c[0] = upper[0] / diagonal[0];
    d[0] = right[0] / diagonal[0];
    for (let i = 1; i < size; i++) {
        const denominator = diagonal[i] - lower[i] * c[i - 1];
        c[i] = upper[i] / denominator;
        d[i] = (right[i] - lower[i] * d[i - 1]) / denominator;
    }
    const solution = new Array(size);
    solution[size - 1] = d[size - 1];
    for (let i = size - 2; i >= 0; i--) solution[i] = d[i] - c[i] * solution[i + 1];
    return solution;
}

/** Second derivatives at the knots under not-a-knot ends; needs four or more points. */
function knotCurvatures(h, s) {
    const n = h.length + 1;
    const unknowns = n - 2;
    const lower = new Array(unknowns).fill(0);
    const diagonal = new Array(unknowns).fill(0);
    const upper = new Array(unknowns).fill(0);
    const right = new Array(unknowns).fill(0);
    for (let i = 1; i <= n - 2; i++) {
        lower[i - 1] = h[i - 1];
        diagonal[i - 1] = 2 * (h[i - 1] + h[i]);
        upper[i - 1] = h[i];
        right[i - 1] = 6 * (s[i] - s[i - 1]);
    }
    // M0 = M1 + (h0/h1)(M1 − M2), folded into the first equation.
    diagonal[0] += h[0] + h[0] * h[0] / h[1];
    upper[0] -= h[0] * h[0] / h[1];
    // M(n−1) = M(n−2) + (h(n−2)/h(n−3))(M(n−2) − M(n−3)), folded into the last.
    const a = h[n - 3];
    const b = h[n - 2];
    diagonal[unknowns - 1] += b + b * b / a;
    lower[unknowns - 1] -= b * b / a;
    const inner = solveTridiagonal(lower, diagonal, upper, right);
    const first = inner[0] + (h[0] / h[1]) * (inner[0] - inner[1]);
    const last = inner[unknowns - 1] + (b / a) * (inner[unknowns - 1] - inner[unknowns - 2]);
    return [first, ...inner, last];
}

/** Second derivatives for two or three points: a line, or the parabola through them. */
function lowOrderCurvatures(h, s) {
    if (h.length === 1) return [0, 0];
    const curvature = 2 * (s[1] - s[0]) / (h[0] + h[1]);
    return [curvature, curvature, curvature];
}

/**
 * @param {Array<[number, number]>} points  strictly increasing x, at least two
 * @returns {(x:number) => number}  with `derivativesAt(x)` giving
 *   `{ value, derivatives: [first, second, third] }`
 */
export function createNotAKnotSpline(points) {
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    const count = xs.length;
    if (count < 2) throw new Error('A spline needs at least two points');
    const h = xs.slice(1).map((x, i) => x - xs[i]);
    const s = h.map((width, i) => (ys[i + 1] - ys[i]) / width);
    const m = count >= 4 ? knotCurvatures(h, s) : lowOrderCurvatures(h, s);

    const pieceAt = (x) => {
        let lo = 0;
        let hi = count - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (xs[mid] <= x) lo = mid;
            else hi = mid;
        }
        return Math.min(lo, count - 2);
    };
    const evaluate = (x) => {
        const i = pieceAt(x);
        const dx = x - xs[i];
        const slope = s[i] - h[i] * (2 * m[i] + m[i + 1]) / 6;
        const jerk = (m[i + 1] - m[i]) / h[i];
        return {
            value: ys[i] + dx * (slope + dx * (m[i] / 2 + dx * jerk / 6)),
            derivatives: [slope + dx * (m[i] + dx * jerk / 2), m[i] + dx * jerk, jerk],
        };
    };
    const spline = x => evaluate(x).value;
    spline.derivativesAt = evaluate;
    return spline;
}
