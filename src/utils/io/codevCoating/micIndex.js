/**
 * n and k of a Multilayer Index Catalog (MIC) material at any wavelength, from
 * its MWL points, as CODE V 11.2 computes them.
 *
 * The MUL help does not say how CODE V interpolates a MIC table. The rules
 * below are read off the n and k that CODE V 11.2 prints in MPR at the
 * analysis wavelengths, and reproduce them to the 6 decimals printed, past
 * the ends of a table included (CODE V warns there that the index "is being
 * extrapolated"), except the three cases below. The listings: Cr, SiO2 and
 * BK7 from 21-point tables at 41 wavelengths; the silver, gold, aluminium and
 * SiO tables of CODE V's sample coatings; a 16-point Ta2O5 table with a flat
 * run; probe tables of 2 to 5 points with n from 1.15 to 4 falling, rising
 * or steepening, and k absent, small or large, rising, falling, constant or
 * turning, sampled from 380 to 750 nm; and SiO2, glass and Al tables of 21
 * points from 400 to 460.61 nm, sampled up to 700 nm.
 *
 *  - k: straight lines between MWL points; outside the table the end value.
 *  - Two points: n too is a straight line, its end value held outside.
 *  - Where k/n is below 0.1 at every MWL point: the three-term Hartmann
 *    formula CODE V documents for private-catalog glasses (CODE V Lens System
 *    Setup Reference Manual, Defining Lens Materials, Using Private Catalog
 *    Glasses), n = A0 + A1 · |λ − A2|^−1.2, through three neighbouring MWL
 *    points: the first at or above λ and the two below it, the lowest three
 *    below the table and the highest three above it. A2 lies below the three
 *    points for a curve that flattens towards long wavelengths, above them for
 *    one that steepens. Three points that no such curve passes through take
 *    the parabola through them. Three points on a straight line, or of one n,
 *    give that line, and CODE V warns "Index data is linear with wavelength".
 *  - Otherwise: a cubic spline in λ whose end pieces have the second
 *    derivative of their neighbour, so each end piece is a parabola, and
 *    outside the table that parabola continued.
 *
 * That k/n decides is inferred. Every table whose k/n stayed at 0.080 or
 * below took the Hartmann curve (SiO, Ta2O5, probes with no k, probes with k
 * up to 0.12 rising, falling or constant, one with k 0.3 at n near 4), and
 * every table where it reached 0.103 took the spline (Cr, silver, gold,
 * aluminium, a probe with k 0.18 at n 1.75, one with k 0.15 at n near 1.2,
 * one with a single k of 0.3 and the rest 0). Probes with the same n (MWL 450
 * 550 650, n 1.9 1.8 1.75) differ only in k and show the switch. The limit
 * lies between 0.080 and 0.103 and is put at 0.1. k/n² separates the same
 * tables (Hartmann up to 0.039, spline from 0.059), so the listings do not
 * tell the two apart; a table with n near 1.4 and k near 0.12 would.
 *
 * Not reproduced: three points with a flat step and then a fall (n 2.1587,
 * 2.1587, 2.151057 at 480, 500, 520 nm) have no Hartmann curve; CODE V prints
 * 2.156753 at 510 nm, the parabola gives 2.155834. No listing has three
 * points where n turns back while k stays small, nor reaches the pole A2 of a
 * Hartmann curve, where the formula is used as it stands. For a table that
 * steepens, the curve CODE V prints misses its own MWL points by up to 6e-6
 * (n 1.93 printed as 1.929998) and sits up to 2e-5 from the one computed here.
 * Far past the end of a spline table CODE V's n leaves the spline computed
 * here: for the Al table, 21 points 3.03 nm apart, CODE V prints n 3.0e-4
 * higher at 700 nm, 240 nm past its end. Inferred: CODE V fits the spline in
 * single precision. The same spline fitted to the MWL points in µm and n and
 * k rounded to float32 meets CODE V's n there to 4.3e-7, and keeps every
 * other listed spline table within 7.5e-7 of CODE V's n, as the fit to the
 * values as entered does. The spline here is fitted to the values as entered.
 */

const HARTMANN_POWER = 1.2;
// Inferred, see above: a table whose k/n stays below this at every MWL point
// takes the Hartmann curve.
const HARTMANN_K_PER_N = 0.1;
// A2 is looked for from 1e-9 to 1e9 spans of the three points away. The
// Hartmann curve tends to the straight line through its points as A2 moves
// away, by about (span / distance) of its rise, so past 1e9 spans it differs
// from that line, and from the parabola through the points, by less than
// 1e-9 of the rise. Nearer than 1e-9 spans, the parabola is taken.
const FAR_POLE_SPANS = 1e9;

// The parabola through three points, a straight line when they lie on one.
function parabola(x, y) {
    const d1 = (y[1] - y[0]) / (x[1] - x[0]);
    const d2 = ((y[2] - y[1]) / (x[2] - x[1]) - d1) / (x[2] - x[0]);
    return {
        n: (t) => y[0] + (t - x[0]) * (d1 + (t - x[1]) * d2),
        bend: () => 2 * d2,
        pole: NaN,
    };
}

// The Hartmann curve through three points, or null when the search finds no
// A2: n does not fall or rise at both steps, or the three points lie too near
// a straight line, or A2 would lie too near a point. `pole` is A2.
function hartmannCurve(x, y) {
    const p = HARTMANN_POWER;
    const ratio = (y[0] - y[1]) / (y[1] - y[2]);
    if (!(ratio > 0 && Number.isFinite(ratio))) return null;
    const lineRatio = (x[1] - x[0]) / (x[2] - x[1]);
    const below = ratio > lineRatio;
    const poleAt = (s) => (below ? x[0] - s : x[2] + s);
    const g = (a, t) => Math.pow(Math.abs(t - a), -p);
    const fitRatio = (s) => {
        const a = poleAt(s);
        return (g(a, x[0]) - g(a, x[1])) / (g(a, x[1]) - g(a, x[2]));
    };
    // `s` is how far A2 lies from the nearest of the three points. The fit's
    // ratio runs from +∞ (A2 below) or 0 (A2 above) as s → 0 to the
    // straight-line ratio as s → ∞, so `miss` is positive while s is short.
    const miss = (s) => (below ? fitRatio(s) - ratio : ratio - fitRatio(s));
    const span = x[2] - x[0];
    let lo = span / FAR_POLE_SPANS, hi = span * FAR_POLE_SPANS;
    if (!(miss(lo) > 0 && miss(hi) < 0)) return null;
    for (let i = 0; i < 200 && hi / lo > 1 + 1e-15; i++) {
        const mid = Math.sqrt(lo * hi);
        if (miss(mid) > 0) lo = mid; else hi = mid;
    }
    const a = poleAt(Math.sqrt(lo * hi));
    const a1 = (y[0] - y[1]) / (g(a, x[0]) - g(a, x[1]));
    return {
        n: (t) => y[0] + a1 * (g(a, t) - g(a, x[0])),
        bend: (t) => a1 * p * (p + 1) * Math.pow(Math.abs(t - a), -p - 2),
        pole: a,
    };
}

// Second derivatives of the spline at the MWL points: the usual interior
// equations, and at each end the second derivative equal to its neighbour's.
// Thomas algorithm; at least three points.
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

// Piece i of the spline, between MWL points i and i + 1, continued past them.
function splinePiece(xs, ys, m, i) {
    const h = xs[i + 1] - xs[i];
    const left = (t) => (xs[i + 1] - t) / h;
    return {
        n: (t) => {
            const u = left(t), v = 1 - u;
            return u * ys[i] + v * ys[i + 1] + ((u ** 3 - u) * m[i] + (v ** 3 - v) * m[i + 1]) * h * h / 6;
        },
        bend: (t) => left(t) * m[i] + (1 - left(t)) * m[i + 1],
        pole: NaN,
    };
}

// Index of the MWL interval holding λ; outside the table, the end interval.
function intervalOf(xs, t) {
    let i = 0;
    while (i < xs.length - 2 && t > xs[i + 1]) i++;
    return i;
}

function linearHeld(xs, ys, t) {
    if (t <= xs[0]) return ys[0];
    if (t >= xs[xs.length - 1]) return ys[ys.length - 1];
    const i = intervalOf(xs, t);
    return ys[i] + (t - xs[i]) / (xs[i + 1] - xs[i]) * (ys[i + 1] - ys[i]);
}

// The pieces n is made of, as a function giving the piece that holds λ.
function nPieces(xs, ys, ks) {
    if (xs.length < 3) {
        return () => ({ n: (t) => linearHeld(xs, ys, t), bend: () => 0, pole: NaN });
    }
    if (ks.every((k, i) => k < HARTMANN_K_PER_N * ys[i])) {
        const curves = xs.slice(2).map((_, i) => {
            const x = xs.slice(i, i + 3), y = ys.slice(i, i + 3);
            return hartmannCurve(x, y) ?? parabola(x, y);
        });
        return (t) => {
            const j = xs.findIndex(x => x >= t);
            return curves[j < 0 ? curves.length - 1 : Math.max(j - 2, 0)];
        };
    }
    const m = splineMoments(xs, ys);
    const pieces = xs.slice(1).map((_, i) => splinePiece(xs, ys, m, i));
    return (t) => pieces[intervalOf(xs, t)];
}

/**
 * CODE V's n and k of a MIC table as functions of λ in nm.
 *
 * `bendMax(lo, hi)` bounds |d²n/dλ²| over [lo, hi], an interval between two
 * neighbouring MWL points or outside the table: n'' of a spline piece is a
 * straight line in λ, that of a parabola constant, and that of a Hartmann
 * curve keeps one sign and grows towards its pole, so each is largest at an
 * end of the interval. It is Infinity when the pole lies inside, where n has
 * no bound.
 *
 * @param {Array<[number, number, number]>} rows  [λ_nm, n, k] in MWL order
 * @returns {{n: (λ:number)=>number, k: (λ:number)=>number,
 *   bendMax: (lo:number, hi:number)=>number, mwl: number[]}}  mwl ascending
 */
export function micCurve(rows) {
    const sorted = rows.slice().sort((p, q) => p[0] - q[0]);
    const xs = sorted.map(r => r[0]), ys = sorted.map(r => r[1]), ks = sorted.map(r => r[2]);
    const pieceAt = nPieces(xs, ys, ks);
    const n = (t) => {
        const exact = xs.indexOf(t);
        return exact >= 0 ? ys[exact] : pieceAt(t).n(t);
    };
    const bendMax = (lo, hi) => {
        const piece = pieceAt((lo + hi) / 2);
        if (piece.pole >= lo && piece.pole <= hi) return Infinity;
        return Math.max(Math.abs(piece.bend(lo)), Math.abs(piece.bend(hi)));
    };
    return { n, k: (t) => linearHeld(xs, ks, t), bendMax, mwl: xs };
}

/**
 * n of a MIC table at `lambdaNm`, as CODE V 11.2 computes it.
 * @param {Array<[number, number, number]>} rows  [λ_nm, n, k] in MWL order
 * @param {number} lambdaNm
 * @returns {number}
 */
export function micIndexAt(rows, lambdaNm) {
    return micCurve(rows).n(lambdaNm);
}

/**
 * k of a MIC table at `lambdaNm`, as CODE V 11.2 computes it.
 * @param {Array<[number, number, number]>} rows  [λ_nm, n, k] in MWL order
 * @param {number} lambdaNm
 * @returns {number}
 */
export function micExtinctionAt(rows, lambdaNm) {
    return micCurve(rows).k(lambdaNm);
}

/** Whether `lambdaNm` lies outside the MWL range of a MIC table. */
export function outsideMic(rows, lambdaNm) {
    const xs = rows.map(r => r[0]);
    return lambdaNm < Math.min(...xs) || lambdaNm > Math.max(...xs);
}
