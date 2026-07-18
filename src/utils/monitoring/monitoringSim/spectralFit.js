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
 * 1-D thickness fit by golden-section + parabolic refinement.
 *
 * Minimizes  f(d) = Σ_λ (T_meas[λ] − T_model(d, λ))²  over d ∈ [dLo, dHi].
 *
 * Bounded Brent-style search; ~20 evaluations typical, each evaluation is one
 * TMM sweep across the scan band. We don't need very high precision — sub-nm
 * is more than enough to drive a cut decision.
 */
export function fit1DThickness({
    sampleModel,
    T_meas,
    dLo, dHi, dGuess,
    maxIter = 14, tol = 0.05,    // 0.05 nm tolerance, ~14 golden steps for cut decision
}) {
    // Residual sum-of-squares at thickness d. `sampleModel(d)` returns the model
    // characteristic over the scan grid with the growing layer at thickness d —
    // an O(Nλ) incremental evaluation (the completed-stack matrix is cached by
    // the caller's evaluator) instead of a full-stack TMM sweep. Bit-identical to
    // the old sampleChar(... [completed…, currentMat], [prevThicks…, d]).
    const f = (d) => {
        const Tm = sampleModel(Math.max(0, d));
        let ss = 0;
        for (let i = 0; i < Tm.length; i++) {
            const r = T_meas[i] - Tm[i];
            ss += r * r;
        }
        return ss;
    };

    // Golden-section search, optionally seeded by dGuess.
    // We bracket the minimum by stepping out from dGuess in both directions
    // until f stops decreasing (or we hit the bounds), then golden-section
    // within the bracket.
    let a = dLo, b = dHi;
    if (dGuess != null && dGuess > dLo && dGuess < dHi) {
        // Try to tighten bracket around dGuess: step ±width
        const width = Math.max(2.0, (dHi - dLo) * 0.05);   // initial step ~ 2 nm or 5% of band
        let xL = Math.max(dLo, dGuess - width);
        let xR = Math.min(dHi, dGuess + width);
        let fL = f(xL), fM = f(dGuess), fR = f(xR);
        // If guess is best, tight bracket
        if (fM < fL && fM < fR) {
            a = xL; b = xR;
        } else if (fL < fM) {
            // Minimum likely to the left → expand left
            a = dLo; b = dGuess;
        } else {
            a = dGuess; b = dHi;
        }
    }

    // Golden-section search on [a, b]
    const phi = (Math.sqrt(5) - 1) / 2;          // ~0.618
    let x1 = b - phi * (b - a);
    let x2 = a + phi * (b - a);
    let f1 = f(x1), f2 = f(x2);
    for (let it = 0; it < maxIter; it++) {
        if (b - a < tol) break;
        if (f1 < f2) {
            b = x2; x2 = x1; f2 = f1;
            x1 = b - phi * (b - a);
            f1 = f(x1);
        } else {
            a = x1; x1 = x2; f1 = f2;
            x2 = a + phi * (b - a);
            f2 = f(x2);
        }
    }
    return 0.5 * (a + b);
}
