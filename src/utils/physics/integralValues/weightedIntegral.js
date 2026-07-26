// ── Sampled-weighting helpers ────────────────────────────────────────────────

function summarizeBandSamples(lambdas, fVals, lamMin, lamMax) {
    let min = +Infinity, max = -Infinity, lamAtMin = NaN, lamAtMax = NaN;
    let nSamples = 0;
    for (let i = 0; i < lambdas.length; i++) {
        const lam = lambdas[i];
        if (lam < lamMin || lam > lamMax) continue;
        const f = fVals[i];
        if (f < min) { min = f; lamAtMin = lam; }
        if (f > max) { max = f; lamAtMax = lam; }
        nSamples++;
    }
    if (nSamples === 0) { min = NaN; max = NaN; }
    return { min, max, lamAtMin, lamAtMax, nSamples };
}

/**
 * Trapezoidal integral ∫f(λ)·g(λ)·dλ over the shared λ grid.
 *
 * Both arrays are sampled on the same λ grid (the design's spectrum). g is
 * looked up via linear interpolation on its own table (`weightTable` is an
 * array of [λ_nm, value] tuples, sorted by λ). Out-of-range g is zero.
 *
 * Also tracks the unweighted min/max of f within the integration band (the
 * argmin/argmax wavelengths, picked from the design grid — no sub-sample
 * refinement, since the optimizer would only care about which design-grid
 * point is worst anyway).
 *
 * @returns { num, den, min, max, lamAtMin, lamAtMax, nSamples }
 */
export function trapezoidalWeighted(lambdas, fVals, weightFn, lamMin, lamMax) {
    let num = 0, den = 0;
    if (!lambdas?.length || lambdas.length < 2) {
        return { num, den, min: NaN, max: NaN, lamAtMin: NaN, lamAtMax: NaN, nSamples: 0 };
    }

    for (let i = 1; i < lambdas.length; i++) {
        const lam = lambdas[i];
        const f  = fVals[i];
        const leftLam = lambdas[i - 1];
        const rightLam = lam;
        const clippedLeft = Math.max(leftLam, lamMin);
        const clippedRight = Math.min(rightLam, lamMax);
        if (clippedRight <= clippedLeft || rightLam <= leftLam) continue;

        const intervalWidth = rightLam - leftLam;
        const leftFraction = (clippedLeft - leftLam) / intervalWidth;
        const rightFraction = (clippedRight - leftLam) / intervalWidth;
        const leftF = fVals[i - 1] * (1 - leftFraction) + f * leftFraction;
        const rightF = fVals[i - 1] * (1 - rightFraction) + f * rightFraction;
        const leftW = weightFn(clippedLeft);
        const rightW = weightFn(clippedRight);
        const dlam = clippedRight - clippedLeft;
        num += 0.5 * (leftF * leftW + rightF * rightW) * dlam;
        den += 0.5 * (leftW + rightW) * dlam;
    }
    return { num, den, ...summarizeBandSamples(lambdas, fVals, lamMin, lamMax) };
}

// Linear interpolation on a sorted [λ, value] table; out-of-range = 0.
export function makeTableLookup(table) {
    if (!table?.length) return () => 0;
    const lo = table[0][0], hi = table[table.length - 1][0];
    // Pre-extract for speed
    const lams = new Float64Array(table.length);
    const vals = new Float64Array(table.length);
    for (let i = 0; i < table.length; i++) { lams[i] = table[i][0]; vals[i] = table[i][1]; }
    return (lam) => {
        if (lam < lo || lam > hi) return 0;
        // Binary search since user tables may not have uniform spacing
        let l = 0, r = lams.length - 1;
        while (l + 1 < r) {
            const m = (l + r) >> 1;
            if (lams[m] <= lam) l = m; else r = m;
        }
        const t = (lam - lams[l]) / (lams[r] - lams[l] || 1);
        return vals[l] * (1 - t) + vals[r] * t;
    };
}
