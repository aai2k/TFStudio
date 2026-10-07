/**
 * The refractive index n of a Multilayer Index Catalog (MIC) material at a
 * wavelength between its MWL points, computed the way CODE V computes it.
 *
 * The MUL help does not say how CODE V interpolates a MIC table. The rules
 * here are the ones that reproduce the n CODE V stores in the .mul files of
 * its sample coatings (silver, gold, aluminium, SiO) to float32 precision:
 *
 *  - A table whose n falls with wavelength over its whole range takes the
 *    three-term Hartmann fit that CODE V documents for private-catalog glasses
 *    (CODE V Lens System Setup Reference Manual, Defining Lens Materials,
 *    Using Private Catalog Glasses): n = A0 + A1 / (λ − A2)^1.2 through three
 *    MWL points, the first point at or above λ and the two below it, the
 *    lowest three at the short end.
 *  - Any other table, and a falling one the fit cannot pass through, takes a
 *    cubic spline in λ whose end pieces are parabolas (second derivative at
 *    each end equal to that at its neighbour).
 *
 * Only SiO falls; the three metals take the spline. Other ways of telling the
 * two apart, such as n above 1 everywhere or k below 1 everywhere, fit the
 * samples as well.
 *
 * Outside the table the end value is held. The extinction coefficient k
 * follows neither rule, nor any other tried; it is not computed here.
 */

const HARTMANN_POWER = 1.2;

function hartmannCurve(x, y) {
    const g = (a, t) => Math.pow(t - a, -HARTMANN_POWER);
    const ratio = (y[0] - y[1]) / (y[1] - y[2]);
    const miss = (s) => {
        const a = x[0] - s;
        return (g(a, x[0]) - g(a, x[1])) / (g(a, x[1]) - g(a, x[2])) - ratio;
    };
    // `s` is how far A2 lies below the first point. The left side of the fit
    // equation falls from +∞ as s → 0 to the straight-line ratio as s → ∞, so
    // a root exists only for a table curving like normal dispersion.
    const span = x[2] - x[0];
    let lo = 1e-9 * span, hi = 1e9 * span;
    if (!(miss(lo) > 0 && miss(hi) < 0)) return null;
    for (let i = 0; i < 200 && hi / lo > 1 + 1e-15; i++) {
        const mid = Math.sqrt(lo * hi);
        if (miss(mid) > 0) lo = mid; else hi = mid;
    }
    const a = x[0] - Math.sqrt(lo * hi);
    const a1 = (y[0] - y[1]) / (g(a, x[0]) - g(a, x[1]));
    return (t) => y[0] + a1 * (g(a, t) - g(a, x[0]));
}

function hartmannAt(xs, ys, t) {
    let j = xs.findIndex(x => x >= t);
    j = Math.min(Math.max(j, 2), xs.length - 1);
    const pick = [j - 2, j - 1, j];
    const curve = hartmannCurve(pick.map(i => xs[i]), pick.map(i => ys[i]));
    return curve ? curve(t) : null;
}

// Second derivatives of the spline: the usual interior equations, and at each
// end the second derivative equal to its neighbour's. Thomas algorithm.
function splineMoments(xs, ys) {
    const n = xs.length;
    const h = xs.slice(1).map((x, i) => x - xs[i]);
    const lower = new Array(n).fill(0), diag = new Array(n).fill(1), upper = new Array(n).fill(0), rhs = new Array(n).fill(0);
    upper[0] = -1;
    lower[n - 1] = -1;
    for (let i = 1; i < n - 1; i++) {
        lower[i] = h[i - 1];
        diag[i] = 2 * (h[i - 1] + h[i]);
        upper[i] = h[i];
        rhs[i] = 6 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1]);
    }
    for (let i = 1; i < n; i++) {
        const f = lower[i] / diag[i - 1];
        diag[i] -= f * upper[i - 1];
        rhs[i] -= f * rhs[i - 1];
    }
    const m = new Array(n);
    m[n - 1] = rhs[n - 1] / diag[n - 1];
    for (let i = n - 2; i >= 0; i--) m[i] = (rhs[i] - upper[i] * m[i + 1]) / diag[i];
    return m;
}

function splineAt(xs, ys, t) {
    const m = splineMoments(xs, ys);
    let i = 0;
    while (i < xs.length - 2 && t > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const a = (xs[i + 1] - t) / h, b = (t - xs[i]) / h;
    return a * ys[i] + b * ys[i + 1] + ((a ** 3 - a) * m[i] + (b ** 3 - b) * m[i + 1]) * h * h / 6;
}

const falls = (ys) => ys.every((y, i) => i === 0 || y < ys[i - 1]);

/**
 * n of a MIC table at `lambdaNm`.
 * @param {Array<[number, number, number]>} rows  [λ_nm, n, k] in MWL order
 * @param {number} lambdaNm
 * @returns {number}
 */
export function micIndexAt(rows, lambdaNm) {
    const sorted = rows.slice().sort((p, q) => p[0] - q[0]);
    const xs = sorted.map(r => r[0]), ys = sorted.map(r => r[1]);
    const exact = xs.indexOf(lambdaNm);
    if (exact >= 0) return ys[exact];
    if (lambdaNm <= xs[0]) return ys[0];
    if (lambdaNm >= xs[xs.length - 1]) return ys[ys.length - 1];
    if (xs.length === 2) return ys[0] + (lambdaNm - xs[0]) / (xs[1] - xs[0]) * (ys[1] - ys[0]);
    const hartmann = falls(ys) ? hartmannAt(xs, ys, lambdaNm) : null;
    return hartmann ?? splineAt(xs, ys, lambdaNm);
}

/** Whether `lambdaNm` lies outside the MWL range of a MIC table. */
export function outsideMic(rows, lambdaNm) {
    const xs = rows.map(r => r[0]);
    return lambdaNm < Math.min(...xs) || lambdaNm > Math.max(...xs);
}
