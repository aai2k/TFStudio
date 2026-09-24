/**
 * Spectrum sampler at arbitrary wavelength array, and the 1-D thickness fit
 * used to turn a measured broadband scan into a monitor thickness estimate.
 */

import { tmmAvg } from '../../physics/thinFilmMath.js';

// Active (non-zero-thickness) layers as { mat, d } pairs, in storage order.
function buildActiveLayers(frontMats, frontThicks) {
    const layers = [];
    for (let i = 0; i < frontMats.length; i++) {
        if (frontThicks[i] > 0) layers.push({ mat: frontMats[i], d: frontThicks[i] });
    }
    return layers;
}

// Select T/R/A and s/p/avg from a tmmAvg() result.
function pickChar(res, char, pol) {
    if (char === 'T') return pol === 's' ? res.Ts : pol === 'p' ? res.Tp : res.T;
    if (char === 'R') return pol === 's' ? res.Rs : pol === 'p' ? res.Rp : res.R;
    return pol === 's' ? res.As : pol === 'p' ? res.Ap : res.A;
}

// One-λ TMM evaluation over the active layer stack. `ctx` = { theta, pol, char, incMat, subMat }.
function sampleCharAtLambda(lam, layers, ctx) {
    const { theta, pol, char, incMat, subMat } = ctx;
    const n0 = incMat.getNK(lam);
    const ns = subMat.getNK(lam);
    const lNDs = layers.map(l => ({ n: l.mat.getNK(lam), d: l.d }));
    const res = tmmAvg(lam, theta, n0, ns, lNDs);
    return pickChar(res, char, pol);
}

/**
 * Sample one spectral characteristic (T, R, or A) on an explicit λ array.
 * Returns a Float64Array of length lambdas.length.
 *
 * This bypasses evaluateSpectrum's auto-built grid because the monitoring scan
 * band has its own λ_min / λ_max / nPoints (linear in λ) that doesn't need to
 * align with the user's spectrum-display grid.
 */
export function sampleChar({ lambdas, theta, pol, char, incMat, subMat, frontMats, frontThicks }) {
    const layers = buildActiveLayers(frontMats, frontThicks);
    const ctx = { theta, pol, char, incMat, subMat };
    const out = new Float64Array(lambdas.length);
    for (let li = 0; li < lambdas.length; li++) {
        out[li] = sampleCharAtLambda(lambdas[li], layers, ctx);
    }
    return out;
}

/**
 * Grid step (nm) for the thickness fit's scan over a growing layer of `mat`.
 *
 * The signal of a growing layer repeats when its phase thickness
 * δ = 2πNd·cosθ/λ grows by π, a half-wave absentee layer (Macleod, Thin-Film
 * Optical Filters, 5th ed., Ch. 2, "Quarter- and Half-Wave Optical Thicknesses"),
 * so the fringe period in d is λ/(2N·cosθ). The shortest period over the scan
 * band, λ/(2|N|) with cosθ ≤ 1 dropped, bounds how narrow a valley of the
 * fit residual can be. |N| rather than n keeps an absorbing layer, whose
 * signal changes over the decay length λ/(4πk), on a fine grid too. The step
 * is an eighth of that period, so the grid point nearest any minimum is within
 * a sixteenth of a fringe of it: every valley of the residual is sampled
 * near its floor, and only minima of nearly equal depth can trade places.
 */
export function fitGridStep(mat, lambdas) {
    let period = Infinity;
    for (let li = 0; li < lambdas.length; li++) {
        const [n, k] = mat.getNK(lambdas[li]);
        const absN = Math.hypot(n, k);
        if (absN > 0) period = Math.min(period, lambdas[li] / (2 * absN));
    }
    return period / 8;
}

// Resolution of the thickness fit (nm): the refinement stops when the
// bracket is this narrow.
export const FIT_TOL_NM = 0.01;

function residualSS(Tm, T_meas) {
    let ss = 0;
    for (let i = 0; i < Tm.length; i++) {
        const r = T_meas[i] - Tm[i];
        ss += r * r;
    }
    return ss;
}

/**
 * Variance (nm²) of a fitted thickness d, from the fit itself: the
 * linearized least-squares estimate Var(d) = s² / Σ_λ J², with J = ∂T/∂d the
 * model's slope at d (central difference over ±h) and s² = SSE/(Nλ − 1) the
 * residual variance of the scan (Press et al., Numerical Recipes, 3rd ed.,
 * Ch. 15). A layer that barely changes the signal has a small ΣJ² and a
 * large variance. The floor is the fit's own resolution, a uniform error
 * over FIT_TOL_NM.
 */
export function fitVariance({ sampleModel, T_meas, d, h }) {
    const lo = Math.max(0, d - h);
    const hi = d + h;
    const T0 = sampleModel(d);
    const Tlo = sampleModel(lo);
    const Thi = sampleModel(hi);
    let JJ = 0;
    for (let i = 0; i < T0.length; i++) {
        const J = (Thi[i] - Tlo[i]) / (hi - lo);
        JJ += J * J;
    }
    const s2 = residualSS(T0, T_meas) / Math.max(1, T0.length - 1);
    return Math.max(FIT_TOL_NM * FIT_TOL_NM / 12, JJ > 0 ? s2 / JJ : Infinity);
}

/**
 * 1-D thickness fit: a scan of the residual over the whole allowed range,
 * then golden-section refinement between the neighbours of the best grid
 * point.
 *
 * Minimizes  f(d) = Σ_λ (T_meas[λ] − T_model(d, λ))²  over d ∈ [dLo, dHi].
 *
 * f oscillates in d with the fringes of the growing layer and has a local
 * minimum in nearly every fringe, so a search that starts from a guess ends in
 * whichever fringe it starts in. Scanning the range at `step` (fitGridStep)
 * finds the fringe of the global minimum without a guess; the refinement then
 * runs to `tol` nm, well below the growth between two scans, which is what the
 * cut prediction reads. Each evaluation is one O(Nλ) sample of the growing
 * layer on the caller's cached evaluator.
 */
export function fit1DThickness({ sampleModel, T_meas, dLo, dHi, step, tol = FIT_TOL_NM }) {
    const f = (d) => residualSS(sampleModel(Math.max(0, d)), T_meas);

    const nGrid = Math.max(2, Math.ceil((dHi - dLo) / step));
    const h = (dHi - dLo) / nGrid;
    let jBest = 0, fBest = Infinity;
    for (let j = 0; j <= nGrid; j++) {
        const v = f(dLo + j * h);
        if (v < fBest) { fBest = v; jBest = j; }
    }

    // Golden-section search in the bracket form: [a, b] holds the minimum
    // and x is the lowest point seen, starting from the best grid point. Each
    // probe goes a fraction (3 − √5)/2 into the larger side of x, and the
    // bracket shrinks to the side that keeps the lower point inside.
    let a = dLo + Math.max(0, jBest - 1) * h;
    let b = dLo + Math.min(nGrid, jBest + 1) * h;
    let x = dLo + jBest * h, fx = fBest;
    const g = (3 - Math.sqrt(5)) / 2;
    while (b - a > tol) {
        const u = x - a > b - x ? x - g * (x - a) : x + g * (b - x);
        const fu = f(u);
        if (fu < fx) {
            if (u < x) b = x; else a = x;
            x = u; fx = fu;
        } else if (u < x) {
            a = u;
        } else {
            b = u;
        }
    }
    return x;
}
