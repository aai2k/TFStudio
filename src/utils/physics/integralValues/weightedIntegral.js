// ── Sampled-weighting helpers ────────────────────────────────────────────────

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
    let min = +Infinity, max = -Infinity, lamAtMin = NaN, lamAtMax = NaN;
    let nSamples = 0;
    if (!lambdas?.length || lambdas.length < 2) {
        return { num, den, min: NaN, max: NaN, lamAtMin, lamAtMax, nSamples: 0 };
    }

    let prevW   = null;
    let prevFw  = null;
    let prevLam = null;
    for (let i = 0; i < lambdas.length; i++) {
        const lam = lambdas[i];
        if (lam < lamMin || lam > lamMax) {
            prevW = prevFw = prevLam = null;
            continue;
        }
        const w  = weightFn(lam);
        const f  = fVals[i];
        const Fw = f * w;
        if (prevLam != null) {
            const dlam = lam - prevLam;
            num += 0.5 * (Fw + prevFw) * dlam;
            den += 0.5 * (w  + prevW)  * dlam;
        }
        if (f < min) { min = f; lamAtMin = lam; }
        if (f > max) { max = f; lamAtMax = lam; }
        nSamples++;
        prevW = w;
        prevFw = Fw;
        prevLam = lam;
    }
    if (nSamples === 0) { min = NaN; max = NaN; }
    return { num, den, min, max, lamAtMin, lamAtMax, nSamples };
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
